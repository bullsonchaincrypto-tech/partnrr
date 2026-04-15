// ============================================================
// V9 Pipeline — Provider health-tracking + auto-flip
// ============================================================
// Loggar varje provider-anrop till provider_events och triggar PagerDuty/Slack-
// larm + auto-flip USE_HIKERAPI_FALLBACK när SC 5xx-rate > 10% / 60min.

import { runSql, queryOne } from '../db/schema.js';
import { notifyAlert } from './alerts.js';

const FAIL_THRESHOLD = 0.10;       // 10%
const WINDOW_MINUTES = 60;
const MIN_SAMPLE_SIZE = 20;        // Kräver minst 20 anrop i fönstret
const FLIP_COOLDOWN_MS = 5 * 60 * 1000;  // Hindra repeterade flips

const lastFlipAt = { scrapecreators: 0, hikerapi: 0 };

/**
 * Logga ett provider-event till DB.
 * Ska aldrig kasta — logging får inte krascha pipen.
 */
export async function recordProviderEvent({ provider, endpoint, status_code, duration_ms, success, error_message }) {
  try {
    await runSql(
      `INSERT INTO provider_events
         (provider, endpoint, status_code, duration_ms, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [provider, endpoint, status_code, duration_ms, success, error_message]
    );
  } catch (err) {
    // Tyst fail — om DB är nere ska vi inte krascha pipen.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[ProviderHealth] DB-log failed:', err.message);
    }
  }

  // Async fail-rate check (no await — fire-and-forget)
  if (success === false) {
    checkProviderHealth(provider).catch(() => {});
  }
}

/**
 * Beräkna fail-rate i rolling 60-min och trigga larm + flip om över tröskel.
 */
export async function checkProviderHealth(provider) {
  let stats;
  try {
    stats = await queryOne(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE success = FALSE) AS failed
       FROM provider_events
       WHERE provider = $1
         AND created_at > NOW() - INTERVAL '${WINDOW_MINUTES} minutes'`,
      [provider]
    );
  } catch {
    return;
  }
  if (!stats) return;
  const total = Number(stats.total || 0);
  const failed = Number(stats.failed || 0);
  if (total < MIN_SAMPLE_SIZE) return;
  const failRate = failed / total;
  if (failRate < FAIL_THRESHOLD) return;

  // Cooldown — undvik upprepade flips
  if (Date.now() - lastFlipAt[provider] < FLIP_COOLDOWN_MS) return;
  lastFlipAt[provider] = Date.now();

  await notifyAlert({
    severity: 'critical',
    summary: `${provider} fail-rate ${(failRate * 100).toFixed(1)}% i senaste ${WINDOW_MINUTES} min (${failed}/${total})`,
    details: { provider, failRate, total, failed, window_minutes: WINDOW_MINUTES },
    source: 'sparkcollab-v9-provider-health',
  });

  // OBS: Vi sätter INTE process.env automatiskt — det kräver Railway-redeploy.
  // Larmet är operatörens signal att flippa USE_HIKERAPI_FALLBACK manuellt.
  console.warn(`[ProviderHealth] CRITICAL ${provider} ${failRate * 100}% — operatör måste flippa fallback-flagga manuellt.`);
}

/**
 * Returnera 24h-summary per provider — för Grafana / dashboard.
 */
export async function provider24hSummary() {
  try {
    return await runSql(
      `SELECT provider,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE success = TRUE) AS succeeded,
              COUNT(*) FILTER (WHERE success = FALSE) AS failed,
              ROUND(AVG(duration_ms)::numeric, 0) AS avg_ms,
              ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::numeric, 0) AS p95_ms
       FROM provider_events
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY provider
       ORDER BY total DESC`
    );
  } catch {
    return [];
  }
}
