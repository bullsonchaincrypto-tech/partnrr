// ============================================================
// V9 Pipeline — Metrics endpoint för Grafana / admin dashboard
// ============================================================
// GET /api/v9/metrics/summary   → 24h overall
// GET /api/v9/metrics/providers → provider health 24h
// GET /api/v9/metrics/recent    → senaste 50 search_metrics-rader
// GET /api/v9/status            → rollout state + flag-overview

import { Router } from 'express';
import { v9Enabled, foretagBucket, v9Summary24h } from '../services/v9-rollout.js';
import { provider24hSummary } from '../services/provider-health.js';
import { queryAll } from '../db/schema.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({
    enabled: v9Enabled(),
    rollout_pct: parseInt(process.env.V9_SEARCH_ROLLOUT_PCT || '0'),
    hikerapi_fallback: process.env.USE_HIKERAPI_FALLBACK === 'true',
    flags: {
      query_refinement: process.env.USE_QUERY_REFINEMENT === 'true',
      hashtag_discovery: process.env.USE_HASHTAG_DISCOVERY === 'true',
      long_tail_queries: process.env.USE_LONG_TAIL_QUERIES === 'true',
      comment_discovery: process.env.USE_COMMENT_DISCOVERY === 'true',
      bio_harvest: process.env.USE_BIO_HARVEST === 'true',
      list_discovery: process.env.USE_LIST_DISCOVERY === 'true',
      lookalike_expansion: process.env.USE_LOOKALIKE_EXPANSION === 'true',
      fof_lookalike: process.env.USE_FOF_LOOKALIKE === 'true',
      obscurity_validation: process.env.USE_OBSCURITY_VALIDATION === 'true',
    },
    caps: {
      target_min: parseInt(process.env.V9_TARGET_MIN_RESULTS || '20'),
      final_cap_max: parseInt(process.env.V9_FINAL_CAP_MAX || '40'),
    },
    providers: {
      scrapecreators: !!process.env.SCRAPECREATORS_API_KEY,
      hikerapi: !!process.env.HIKERAPI_TOKEN,
      serper: !!process.env.SERPER_API_KEY,
    },
    alerts: {
      pagerduty: !!process.env.PAGERDUTY_INTEGRATION_KEY,
      slack: !!process.env.SLACK_WEBHOOK_URL,
    },
  });
});

router.get('/metrics/summary', async (req, res) => {
  try {
    const summary = await v9Summary24h();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/metrics/providers', async (req, res) => {
  try {
    const rows = await provider24hSummary();
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/metrics/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = await queryAll(`
      SELECT
        id, foretag_id, duration_ms, cost_usd, raw_candidates,
        after_swedish_gate, after_brand_filter, after_haiku, final_count,
        multi_platform_count, reserve_used, cache_hit,
        hashtag_triggered, lookalike_triggered, obscurity_validation_run,
        query_refinement_triggered, created_at
      FROM search_metrics
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bucket/:foretag_id', (req, res) => {
  const id = Number(req.params.foretag_id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid foretag_id' });
  const bucket = foretagBucket(id);
  const pct = parseInt(process.env.V9_SEARCH_ROLLOUT_PCT || '0');
  res.json({
    foretag_id: id,
    bucket,
    rollout_pct: pct,
    would_use_v9: v9Enabled() && pct > 0 && (pct >= 100 || bucket < pct),
  });
});

export default router;
