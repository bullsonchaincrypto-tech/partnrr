import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db/schema.js';
import {
  getSettings,
  getDueFollowups,
  processFollowup,
  runAutoFollowups,
  startScheduler,
  stopScheduler,
} from '../services/followup-scheduler.js';

const router = Router();

// GET /api/followup-sequence/settings — Hämta inställningar
router.get('/settings', async (req, res) => {
  try {
    const settings = getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/followup-sequence/settings — Uppdatera inställningar
router.put('/settings', async (req, res) => {
  try {
    const { enabled, step1_days, step2_days, step3_days, max_steps, auto_send } = req.body;

    await runSql(`
      UPDATE followup_sequence_settings SET
        enabled = COALESCE(?, enabled),
        step1_days = COALESCE(?, step1_days),
        step2_days = COALESCE(?, step2_days),
        step3_days = COALESCE(?, step3_days),
        max_steps = COALESCE(?, max_steps),
        auto_send = COALESCE(?, auto_send),
        updated_at = datetime('now')
      WHERE id = 1
    `, [
      enabled !== undefined ? (enabled ? 1 : 0) : null,
      step1_days || null,
      step2_days || null,
      step3_days || null,
      max_steps || null,
      auto_send !== undefined ? (auto_send ? 1 : 0) : null,
    ]);
    saveDb();

    // Starta/stoppa scheduler baserat på enabled
    const newSettings = getSettings();
    if (newSettings.enabled) {
      startScheduler();
    } else {
      stopScheduler();
    }

    res.json(newSettings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/followup-sequence/due — Visa vilka outreach som behöver uppföljning
router.get('/due', async (req, res) => {
  try {
    const due = getDueFollowups();
    res.json(due);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/followup-sequence/process/:id — Generera+skicka uppföljning för en specifik outreach
router.post('/process/:id', async (req, res) => {
  try {
    const { forceSend } = req.body || {};
    const result = await processFollowup(Number(req.params.id), forceSend);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/followup-sequence/run — Kör auto-uppföljning manuellt
router.post('/run', async (req, res) => {
  try {
    const result = await runAutoFollowups();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/followup-sequence/status — Översikt av alla aktiva sekvenser
router.get('/status', async (req, res) => {
  try {
    const settings = getSettings();

    // Alla skickade outreach med sekvens-info
    const outreachWithSteps = await queryAll(`
      SELECT om.id, om.amne, om.status, om.skickat_datum, om.followup_step, om.followup_paused,
             om.last_followup_at, om.kontakt_epost,
             i.namn as influencer_namn, i.kanalnamn, i.plattform,
             f.namn as foretag_namn
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      JOIN foretag f ON om.foretag_id = f.id
      WHERE om.status = 'skickat'
        AND om.skickat_datum IS NOT NULL
      ORDER BY om.skickat_datum DESC
    `);

    // Historik från followup_log
    const recentFollowups = await queryAll(`
      SELECT fl.*, i.namn as influencer_namn
      FROM followup_log fl
      LEFT JOIN influencers i ON fl.influencer_id = i.id
      ORDER BY fl.created_at DESC
      LIMIT 20
    `);

    // Statistik
    const totalActive = outreachWithSteps.filter(o => (o.followup_step || 0) < settings.max_steps && !o.followup_paused).length;
    const totalPaused = outreachWithSteps.filter(o => o.followup_paused).length;
    const totalCompleted = outreachWithSteps.filter(o => (o.followup_step || 0) >= settings.max_steps).length;
    const totalSent = (await queryOne('SELECT COUNT(*) as count FROM followup_log WHERE status = \'sent\''))?.count || 0;

    res.json({
      settings,
      stats: { totalActive, totalPaused, totalCompleted, totalFollowupsSent: totalSent },
      sequences: outreachWithSteps,
      recentFollowups,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/followup-sequence/pause/:id — Pausa/återuppta sekvens
router.put('/pause/:id', async (req, res) => {
  try {
    const { paused } = req.body;
    await runSql('UPDATE outreach_meddelanden SET followup_paused = ? WHERE id = ?', [paused ? 1 : 0, Number(req.params.id)]);
    saveDb();
    res.json({ id: Number(req.params.id), paused: !!paused });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
