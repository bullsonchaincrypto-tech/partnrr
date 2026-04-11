/**
 * cost-tracker.js — Centraliserad API-kostnads-tracking
 *
 * Loggar alla externa API-anrop med kostnad i USD och SEK.
 * Importeras i alla services som anropar externa API:er.
 */

import { runSql, queryAll, queryOne } from '../db/schema.js';

// Prismodeller (uppdatera vid behov)
const PRICING = {
  // Anthropic — per 1M tokens
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  // YouTube Data API — per 1 unit (10K units/dag gratis)
  'youtube_data_v3': { per_unit: 0.0 }, // Gratis inom kvot
  // Phyllo
  'phyllo_search': { per_call: 0.05 },
  'phyllo_profile': { per_call: 0.02 },
  // SerpAPI — Starter plan: $25/1000 sökningar = $0.025/sökning
  'serpapi': { per_call: 0.025 },
  // Gmail API — gratis
  'gmail_api': { per_call: 0.0 },
  // Apify — ~$0.01-0.05 per actor run (beroende på plan)
  'apify': { per_call: 0.02 },
};

// USD → SEK (uppdatera regelbundet)
const USD_TO_SEK = 10.5;

/**
 * Logga ett API-anrop med kostnad
 */
export async function trackApiCost({
  service,         // t.ex. 'anthropic', 'phyllo', 'youtube', 'serpapi', 'gmail'
  endpoint = '',   // t.ex. '/v1/messages', 'search', 'channels.list'
  tokens_input = 0,
  tokens_output = 0,
  model = null,
  details = null,
}) {
  let cost_usd = 0;

  if (service === 'anthropic' && model) {
    const pricing = PRICING[model] || PRICING['claude-sonnet-4-6'];
    cost_usd = (tokens_input / 1_000_000) * pricing.input + (tokens_output / 1_000_000) * pricing.output;
  } else if (service === 'phyllo') {
    const pricing = PRICING[endpoint] || PRICING['phyllo_search'];
    cost_usd = pricing.per_call || 0;
  } else if (service === 'serpapi') {
    cost_usd = PRICING.serpapi.per_call;
  } else if (service === 'youtube') {
    cost_usd = 0; // Gratis inom daglig kvot
  } else if (service === 'gmail') {
    cost_usd = 0;
  } else if (service === 'apify') {
    cost_usd = PRICING.apify.per_call;
  }

  const cost_sek = cost_usd * USD_TO_SEK;

  try {
    await runSql(
      `INSERT INTO api_costs (service, endpoint, tokens_input, tokens_output, cost_usd, cost_sek, model, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [service, endpoint, tokens_input, tokens_output, cost_usd, cost_sek, model, details]
    );
  } catch (err) {
    console.error('[CostTracker] Failed to log cost:', err.message);
  }
}

/**
 * Hämta kostnadssammanfattning
 */
export async function getCostSummary(period = 'today') {
  let dateFilter;
  switch (period) {
    case 'today':
      dateFilter = "date(created_at) = date('now')";
      break;
    case 'week':
      dateFilter = "created_at >= datetime('now', '-7 days')";
      break;
    case 'month':
      dateFilter = "created_at >= datetime('now', '-30 days')";
      break;
    case 'all':
      dateFilter = '1=1';
      break;
    default:
      dateFilter = "date(created_at) = date('now')";
  }

  // Totaler per service
  const byService = await queryAll(`
    SELECT service,
      COUNT(*) as calls,
      SUM(tokens_input) as total_tokens_input,
      SUM(tokens_output) as total_tokens_output,
      ROUND(SUM(cost_usd), 4) as total_usd,
      ROUND(SUM(cost_sek), 2) as total_sek
    FROM api_costs
    WHERE ${dateFilter}
    GROUP BY service
    ORDER BY total_usd DESC
  `);

  // Totalt
  const totals = await queryOne(`
    SELECT
      COUNT(*) as total_calls,
      ROUND(SUM(cost_usd), 4) as total_usd,
      ROUND(SUM(cost_sek), 2) as total_sek,
      SUM(tokens_input) as total_tokens_input,
      SUM(tokens_output) as total_tokens_output
    FROM api_costs
    WHERE ${dateFilter}
  `);

  // Per dag (senaste 30 dagarna)
  const dailyCosts = await queryAll(`
    SELECT date(created_at) as date,
      COUNT(*) as calls,
      ROUND(SUM(cost_usd), 4) as total_usd,
      ROUND(SUM(cost_sek), 2) as total_sek
    FROM api_costs
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date DESC
  `);

  // Senaste 10 anrop
  const recent = await queryAll(`
    SELECT * FROM api_costs
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return {
    period,
    by_service: byService,
    totals: totals || { total_calls: 0, total_usd: 0, total_sek: 0 },
    daily: dailyCosts,
    recent,
  };
}

/**
 * Kolla om kostnaden överstiger gränsen
 */
export async function checkCostAlerts() {
  const alerts = [];

  // Daglig gräns: 5 USD
  const todayTotal = await queryOne(`
    SELECT ROUND(SUM(cost_usd), 4) as total
    FROM api_costs WHERE date(created_at) = date('now')
  `);
  if (todayTotal?.total > 5) {
    alerts.push({
      level: 'warning',
      message: `Daglig API-kostnad: $${todayTotal.total} (gräns: $5)`,
      cost: todayTotal.total,
    });
  }
  if (todayTotal?.total > 15) {
    alerts.push({
      level: 'critical',
      message: `KRITISK: Daglig API-kostnad: $${todayTotal.total} — överskrider $15!`,
      cost: todayTotal.total,
    });
  }

  // Anthropic tokens per dag: 500K
  const todayTokens = await queryOne(`
    SELECT SUM(tokens_input + tokens_output) as total
    FROM api_costs WHERE date(created_at) = date('now') AND service = 'anthropic'
  `);
  if (todayTokens?.total > 500000) {
    alerts.push({
      level: 'warning',
      message: `Hög token-användning: ${(todayTokens.total / 1000).toFixed(0)}K tokens idag`,
      tokens: todayTokens.total,
    });
  }

  return alerts;
}
