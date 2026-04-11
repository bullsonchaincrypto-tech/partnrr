/**
 * Routes: /api/admin
 *
 * Admin Dashboard — kostnadsövervakning, systemstatus, alerts.
 * Ej synligt för slutanvändare.
 */

import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { getCostSummary, checkCostAlerts } from '../services/cost-tracker.js';
import { testConnection as testApollo } from '../services/apollo.js';
import { testConnection as testApify } from '../services/social-enrichment.js';

const router = Router();

/**
 * GET /api/admin/costs — Kostnadssammanfattning
 * ?period=today|week|month|all
 */
router.get('/costs', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const summary = getCostSummary(period);
    res.json(summary);
  } catch (err) {
    console.error('[Admin] Cost summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/alerts — Kostnadsvarningar
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = checkCostAlerts();
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/system-status — Systemöversikt
 */
router.get('/system-status', async (req, res) => {
  try {
    // DB-storlek
    const tables = await queryAll(`
      SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) as exists_flag
      FROM sqlite_master m WHERE type='table'
    `);
    const tableStats = {};
    for (const t of tables) {
      try {
        const count = await queryOne(`SELECT COUNT(*) as cnt FROM ${t.name}`);
        tableStats[t.name] = count?.cnt || 0;
      } catch { tableStats[t.name] = 0; }
    }

    // Gmail-status
    const gmailState = await queryOne('SELECT * FROM gmail_watch_state WHERE id = 1');

    // Automation-log senaste
    const recentJobs = await queryAll(`
      SELECT * FROM automation_log ORDER BY started_at DESC LIMIT 5
    `);

    // Aktiva kontrakt
    const activeContracts = await queryOne(`
      SELECT COUNT(*) as cnt FROM kontrakt WHERE status IN ('aktivt', 'avtal_signerat')
    `);

    // Konversationer
    const activeConvs = await queryOne(`SELECT COUNT(*) as cnt FROM conversation_threads`);
    const unreadCount = await queryOne(`SELECT SUM(unread_count) as cnt FROM conversation_threads`);

    // API-kostnader idag
    const todayCost = await queryOne(`
      SELECT ROUND(SUM(cost_usd), 4) as usd, ROUND(SUM(cost_sek), 2) as sek, COUNT(*) as calls
      FROM api_costs WHERE date(created_at) = date('now')
    `);

    res.json({
      tables: tableStats,
      gmail: {
        history_id: gmailState?.history_id || null,
        last_checked: gmailState?.last_checked_at || null,
      },
      recent_jobs: recentJobs,
      active_contracts: activeContracts?.cnt || 0,
      conversations: {
        total: activeConvs?.cnt || 0,
        unread: unreadCount?.cnt || 0,
      },
      costs_today: {
        usd: todayCost?.usd || 0,
        sek: todayCost?.sek || 0,
        calls: todayCost?.calls || 0,
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/costs/daily — Daglig kostnadshistorik
 */
router.get('/costs/daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const daily = await queryAll(`
      SELECT
        date(created_at) as date,
        service,
        COUNT(*) as calls,
        SUM(tokens_input) as tokens_in,
        SUM(tokens_output) as tokens_out,
        ROUND(SUM(cost_usd), 4) as usd,
        ROUND(SUM(cost_sek), 2) as sek
      FROM api_costs
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at), service
      ORDER BY date DESC, usd DESC
    `);
    res.json(daily);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/env-check — Kolla vilka API-nycklar som är konfigurerade
 */
router.get('/env-check', async (req, res) => {
  res.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    youtube: !!process.env.YOUTUBE_API_KEY,
    apify: !!process.env.APIFY_API_TOKEN,
    apollo: !!process.env.APOLLO_API_KEY,
    serpapi: !!process.env.SERPAPI_KEY,
    gmail_client: !!process.env.GMAIL_CLIENT_ID,
    gmail_secret: !!process.env.GMAIL_CLIENT_SECRET,
  });
});

/**
 * GET /api/admin/apollo-test — Testa Apollo.io API
 */
router.get('/apollo-test', async (req, res) => {
  try {
    const result = await testApollo();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/admin/apify-test — Testa Apify-anslutningen
 */
router.get('/apify-test', async (req, res) => {
  try {
    const result = await testApify();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/admin/api-status — Alla API-anslutningar i en översikt
 */
router.get('/api-status', async (req, res) => {
  try {
    const [apollo, apify] = await Promise.allSettled([
      testApollo(),
      testApify(),
    ]);

    res.json({
      apify: apify.status === 'fulfilled' ? apify.value : { ok: false, error: apify.reason?.message },
      apollo: apollo.status === 'fulfilled' ? apollo.value : { ok: false, error: apollo.reason?.message },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/anthropic-test — Testa Anthropic API (vanlig + web search separat)
 * Visar exakt vad som funkar och vad som inte gör det.
 */
router.get('/anthropic-test', async (req, res) => {
  const results = { basic: null, web_search: null };

  // Steg 1: Testa vanlig Claude (utan web search)
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const t1 = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Svara med exakt ett ord: hej' }],
    });
    results.basic = {
      ok: true,
      ms: Date.now() - t1,
      model: response.model,
      tokens: response.usage,
      text: response.content?.[0]?.text || '',
    };
  } catch (err) {
    results.basic = { ok: false, error: err.message, status: err.status || null };
  }

  // Steg 2: Testa web search
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const t2 = Date.now();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Vad heter Sveriges huvudstad? Svara med ett ord.' }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
    });
    results.web_search = {
      ok: true,
      ms: Date.now() - t2,
      model: response.model,
      tokens: response.usage,
      stop_reason: response.stop_reason,
      content_types: response.content?.map(b => b.type) || [],
      text: response.content?.find(b => b.type === 'text')?.text || '',
    };
  } catch (err) {
    results.web_search = { ok: false, error: err.message, status: err.status || null };
  }

  res.json({
    api_key_set: !!process.env.ANTHROPIC_API_KEY,
    api_key_prefix: process.env.ANTHROPIC_API_KEY?.slice(0, 15) + '...',
    results,
  });
});

/**
 * GET /api/admin/serpapi-status — SerpAPI kontostatus + kvotanvändning
 */
router.get('/serpapi-status', async (req, res) => {
  try {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      return res.json({ configured: false, error: 'SERPAPI_KEY saknas i .env' });
    }

    // Hämta kontostatus via SerpAPI Account API
    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://serpapi.com/account.json?api_key=${apiKey}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.json({ configured: true, error: `SerpAPI svarade ${response.status}` });
    }

    const data = await response.json();

    // Intern kostnadsspårning
    const serpCosts = await queryOne(`
      SELECT COUNT(*) as calls_today,
        ROUND(SUM(cost_usd), 4) as cost_usd_today,
        ROUND(SUM(cost_sek), 2) as cost_sek_today
      FROM api_costs
      WHERE service = 'serpapi' AND date(created_at) = date('now')
    `);

    const serpCostsMonth = await queryOne(`
      SELECT COUNT(*) as calls_month,
        ROUND(SUM(cost_usd), 4) as cost_usd_month,
        ROUND(SUM(cost_sek), 2) as cost_sek_month
      FROM api_costs
      WHERE service = 'serpapi' AND created_at >= datetime('now', '-30 days')
    `);

    res.json({
      configured: true,
      account: {
        plan: data.plan_name || data.plan || 'Unknown',
        searches_this_month: data.this_month_usage || data.total_searches_left != null
          ? (data.plan_searches_left != null
            ? (data.searches_per_month - data.plan_searches_left)
            : data.this_month_usage)
          : null,
        searches_per_month: data.searches_per_month || null,
        searches_left: data.plan_searches_left ?? data.total_searches_left ?? null,
        extra_credits: data.extra_credits || 0,
        account_email: data.account_email || null,
      },
      usage: {
        today: serpCosts || { calls_today: 0, cost_usd_today: 0, cost_sek_today: 0 },
        month: serpCostsMonth || { calls_month: 0, cost_usd_month: 0, cost_sek_month: 0 },
      },
    });
  } catch (err) {
    res.status(500).json({ configured: true, error: err.message });
  }
});

/**
 * GET /api/admin/costs/realtime — Realtidskostnad (senaste sökningen + totalt idag)
 */
router.get('/costs/realtime', async (req, res) => {
  try {
    // Senaste 5 anrop
    const recent = await queryAll(`
      SELECT service, endpoint, cost_sek, cost_usd, tokens_input, tokens_output, model, created_at
      FROM api_costs ORDER BY created_at DESC LIMIT 5
    `);

    // Totalt idag per service
    const todayByService = await queryAll(`
      SELECT service,
        COUNT(*) as calls,
        ROUND(SUM(cost_usd), 4) as usd,
        ROUND(SUM(cost_sek), 2) as sek
      FROM api_costs
      WHERE date(created_at) = date('now')
      GROUP BY service
    `);

    // Totalt idag
    const todayTotal = await queryOne(`
      SELECT COUNT(*) as calls,
        ROUND(SUM(cost_usd), 4) as usd,
        ROUND(SUM(cost_sek), 2) as sek
      FROM api_costs
      WHERE date(created_at) = date('now')
    `);

    // Senaste sökningen (full pipeline-kostnad)
    const lastSearch = await queryAll(`
      SELECT service, endpoint, cost_sek, cost_usd, created_at
      FROM api_costs
      WHERE created_at >= datetime('now', '-5 minutes')
      ORDER BY created_at DESC
    `);

    const lastSearchTotal = lastSearch.reduce((acc, r) => ({
      usd: acc.usd + (r.cost_usd || 0),
      sek: acc.sek + (r.cost_sek || 0),
      calls: acc.calls + 1,
    }), { usd: 0, sek: 0, calls: 0 });

    res.json({
      recent,
      today: {
        by_service: todayByService,
        total: todayTotal || { calls: 0, usd: 0, sek: 0 },
      },
      last_search: {
        items: lastSearch,
        total: lastSearchTotal,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
