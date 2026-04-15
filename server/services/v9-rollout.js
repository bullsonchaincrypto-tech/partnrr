// ============================================================
// V9 Pipeline — Rollout control + runtime cost-guard
// ============================================================
// Central plats för:
//   - shouldUseV9(foretag_id) — deterministisk bucket baserat på foretag_id
//   - costGuard — hard/soft ceilings, triggar PagerDuty-larm
//   - v9Enabled() — snabb check om flaggan är på

import crypto from 'node:crypto';
import { queryOne, runSql } from '../db/schema.js';
import { notifyAlert } from './alerts.js';

const HARD_CEILING_24H_AVG = parseFloat(process.env.V9_HARD_CEILING_AVG || '0.80');
const SOFT_CEILING_24H_AVG = parseFloat(process.env.V9_SOFT_CEILING_AVG || '0.60');
const HARD_CEILING_24H_P95 = parseFloat(process.env.V9_HARD_CEILING_P95 || '0.80');
const LOW_FINAL_FLOOR     = parseInt(process.env.V9_LOW_FINAL_FLOOR || '15');
const MIN_SAMPLE_24H      = 10;

/**
 * Är V9 globalt aktiverad?
 */
export function v9Enabled() {
  return process.env.USE_V9_PIPELINE === 'true';
}

/**
 * Deterministisk bucket: hash(foretag_id) → 0-99.
 * Ger stabil rollout (samma foretag hamnar alltid i samma bucket).
 */
export function foretagBucket(foretag_id) {
  const h = crypto.createHash('sha256').update(String(foretag_id)).digest();
  // Ta första byte som 0-255, mod 100 → 0-99
  return h[0] % 100;
}

/**
 * Beslutar om denna foretag_id ska rutas till V9 baserat på
 * USE_V9_PIPELINE + V9_SEARCH_ROLLOUT_PCT.
 */
export function shouldUseV9(foretag_id) {
  if (!v9Enabled()) return false;
  const pct = parseInt(process.env.V9_SEARCH_ROLLOUT_PCT || '0');
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return foretagBucket(foretag_id) < pct;
}

/**
 * Runtime cost-guard — körs EFTER varje V9-sökning.
 * Beräknar 24h avg + p95 cost och triggar larm om över tröskel.
 * Returnerar { hardCeilingBreached: boolean } så caller kan stänga ner V9.
 */
export async function costGuard() {
  let stats;
  try {
    stats = await queryOne(`
      SELECT
        COUNT(*) AS cnt,
        AVG(cost_usd) AS avg_cost,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cost_usd) AS p95_cost,
        AVG(final_count) AS avg_final
      FROM search_metrics
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
  } catch (err) {
    console.warn(`[V9 CostGuard] DB query failed: ${err.message}`);
    return { hardCeilingBreached: false };
  }
  if (!stats) return { hardCeilingBreached: false };
  const cnt = Number(stats.cnt || 0);
  if (cnt < MIN_SAMPLE_24H) return { hardCeilingBreached: false };

  const avgCost = Number(stats.avg_cost || 0);
  const p95Cost = Number(stats.p95_cost || 0);
  const avgFinal = Number(stats.avg_final || 0);

  let hardBreach = false;

  if (avgCost > HARD_CEILING_24H_AVG) {
    hardBreach = true;
    await notifyAlert({
      severity: 'critical',
      summary: `V9 HARD CEILING — avg cost $${avgCost.toFixed(3)} > $${HARD_CEILING_24H_AVG} (24h, n=${cnt})`,
      details: { avgCost, HARD_CEILING_24H_AVG, cnt, p95Cost, avgFinal },
      source: 'sparkcollab-v9-cost-guard',
    }).catch(() => {});
  } else if (avgCost > SOFT_CEILING_24H_AVG) {
    await notifyAlert({
      severity: 'warning',
      summary: `V9 SOFT CEILING — avg cost $${avgCost.toFixed(3)} > $${SOFT_CEILING_24H_AVG} (24h, n=${cnt})`,
      details: { avgCost, SOFT_CEILING_24H_AVG, cnt, p95Cost },
      source: 'sparkcollab-v9-cost-guard',
    }).catch(() => {});
  }

  if (p95Cost > HARD_CEILING_24H_P95) {
    hardBreach = true;
    await notifyAlert({
      severity: 'critical',
      summary: `V9 p95 cost $${p95Cost.toFixed(3)} > $${HARD_CEILING_24H_P95} (24h, n=${cnt})`,
      details: { p95Cost, HARD_CEILING_24H_P95, cnt },
      source: 'sparkcollab-v9-cost-guard',
    }).catch(() => {});
  }

  if (avgFinal < LOW_FINAL_FLOOR && cnt >= MIN_SAMPLE_24H) {
    await notifyAlert({
      severity: 'warning',
      summary: `V9 final_count avg ${avgFinal.toFixed(1)} < ${LOW_FINAL_FLOOR} (24h, n=${cnt})`,
      details: { avgFinal, LOW_FINAL_FLOOR, cnt },
      source: 'sparkcollab-v9-cost-guard',
    }).catch(() => {});
  }

  return { hardCeilingBreached: hardBreach, avgCost, p95Cost, avgFinal, cnt };
}

/**
 * 24h summary-data för Grafana / admin dashboard.
 */
export async function v9Summary24h() {
  try {
    const overall = await queryOne(`
      SELECT
        COUNT(*) AS searches_24h,
        AVG(cost_usd) AS avg_cost,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY cost_usd) AS p50_cost,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cost_usd) AS p95_cost,
        AVG(duration_ms) AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
        AVG(final_count) AS avg_final_count,
        AVG(multi_platform_count) AS avg_multi_platform,
        AVG(raw_candidates) AS avg_raw,
        SUM(CASE WHEN cache_hit THEN 1 ELSE 0 END) AS cache_hits,
        SUM(CASE WHEN hashtag_triggered THEN 1 ELSE 0 END) AS hashtag_runs,
        SUM(CASE WHEN lookalike_triggered THEN 1 ELSE 0 END) AS lookalike_runs,
        SUM(CASE WHEN obscurity_validation_run THEN 1 ELSE 0 END) AS obscurity_runs,
        SUM(CASE WHEN query_refinement_triggered THEN 1 ELSE 0 END) AS query_refine_runs
      FROM search_metrics
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    return overall || {};
  } catch (err) {
    console.warn(`[V9 Summary] query failed: ${err.message}`);
    return {};
  }
}

export const __test__ = { HARD_CEILING_24H_AVG, SOFT_CEILING_24H_AVG };
