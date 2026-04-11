import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { generateOutreachMessage } from '../services/anthropic.js';

const router = Router();

// ============================================================
// KAMPANJER — CRUD + statistik
// ============================================================

// GET /api/kampanjer — lista alla kampanjer med live-statistik
router.get('/', async (req, res) => {
  try {
    const { foretag_id, status } = req.query;
    let sql = `
      SELECT k.*, f.namn as foretag_namn
      FROM kampanjer k
      LEFT JOIN foretag f ON k.foretag_id = f.id
      WHERE 1=1
    `;
    const params = [];
    if (foretag_id) { sql += ' AND k.foretag_id = ?'; params.push(Number(foretag_id)); }
    if (status) { sql += ' AND k.status = ?'; params.push(status); }
    sql += ' ORDER BY k.created_at DESC';

    const kampanjer = await queryAll(sql, params);

    const enriched = kampanjer.map(k => {
      const stats = getKampanjStats(k.id);
      return { ...k, ...stats };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kampanjer — skapa ny kampanj
router.post('/', async (req, res) => {
  try {
    const { foretag_id, namn, beskrivning, nisch, budget_sek } = req.body;
    if (!foretag_id || !namn) return res.status(400).json({ error: 'foretag_id och namn krävs' });

    const { lastId } = await runSql(
      'INSERT INTO kampanjer (foretag_id, namn, beskrivning, nisch, budget_sek) VALUES (?, ?, ?, ?, ?)',
      [foretag_id, namn, beskrivning || null, nisch || null, budget_sek || null]
    );
    res.json({ status: 'created', id: lastId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kampanjer/:id — detaljer med alla outreach
router.get('/:id', async (req, res) => {
  try {
    const kampanj = await queryOne(`
      SELECT k.*, f.namn as foretag_namn, f.epost as foretag_epost, f.kontaktperson
      FROM kampanjer k LEFT JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ?
    `, [Number(req.params.id)]);
    if (!kampanj) return res.status(404).json({ error: 'Kampanj hittades inte' });

    const stats = getKampanjStats(kampanj.id);

    const outreach = await queryAll(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, i.foljare
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.kampanj_id = ?
      ORDER BY om.created_at DESC
    `, [kampanj.id]);

    res.json({ ...kampanj, ...stats, outreach });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/kampanjer/:id — uppdatera kampanj
router.put('/:id', async (req, res) => {
  try {
    const { namn, beskrivning, nisch, budget_sek, status } = req.body;
    const kampanj = await queryOne('SELECT * FROM kampanjer WHERE id = ?', [Number(req.params.id)]);
    if (!kampanj) return res.status(404).json({ error: 'Kampanj hittades inte' });

    await runSql(`
      UPDATE kampanjer SET
        namn = COALESCE(?, namn), beskrivning = COALESCE(?, beskrivning),
        nisch = COALESCE(?, nisch), budget_sek = COALESCE(?, budget_sek),
        status = COALESCE(?, status)
      WHERE id = ?
    `, [namn || null, beskrivning || null, nisch || null, budget_sek || null, status || null, Number(req.params.id)]);

    // Om status ändras till active, sätt started_at
    if (status === 'active' && !kampanj.started_at) {
      await runSql("UPDATE kampanjer SET started_at = datetime('now') WHERE id = ?", [Number(req.params.id)]);
    }
    if (status === 'completed' && !kampanj.completed_at) {
      await runSql("UPDATE kampanjer SET completed_at = datetime('now') WHERE id = ?", [Number(req.params.id)]);
    }

    res.json({ status: 'updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/kampanjer/:id
router.delete('/:id', async (req, res) => {
  try {
    await runSql('UPDATE outreach_meddelanden SET kampanj_id = NULL WHERE kampanj_id = ?', [Number(req.params.id)]);
    await runSql('DELETE FROM kampanjer WHERE id = ?', [Number(req.params.id)]);
    res.json({ status: 'deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// BULK-GENERERING — Generera outreach för många influencers på en gång
// ============================================================

// POST /api/kampanjer/:id/bulk-generate — AI-generera outreach för valda influencers
router.post('/:id/bulk-generate', async (req, res) => {
  try {
    const { influencer_ids } = req.body;
    if (!influencer_ids || influencer_ids.length === 0) {
      return res.status(400).json({ error: 'influencer_ids krävs' });
    }

    const kampanj = await queryOne(`
      SELECT k.*, f.* FROM kampanjer k
      JOIN foretag f ON k.foretag_id = f.id
      WHERE k.id = ?
    `, [Number(req.params.id)]);
    if (!kampanj) return res.status(404).json({ error: 'Kampanj hittades inte' });

    const foretag = { id: kampanj.foretag_id, namn: kampanj.namn_1 || kampanj.foretag_namn, epost: kampanj.epost, kontaktperson: kampanj.kontaktperson };

    const messages = [];
    const errors = [];

    for (const infId of influencer_ids) {
      try {
        const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [infId]);
        if (!inf) { errors.push({ id: infId, error: 'Influencer hittades inte' }); continue; }

        // Kolla om det redan finns outreach i denna kampanj för denna influencer
        const existing = await queryOne('SELECT id FROM outreach_meddelanden WHERE kampanj_id = ? AND influencer_id = ?', [kampanj.id, infId]);
        if (existing) { errors.push({ id: infId, error: 'Outreach finns redan' }); continue; }

        const raw = await generateOutreachMessage(inf, { namn: kampanj.foretag_namn || kampanj.namn, epost: kampanj.epost, kontaktperson: kampanj.kontaktperson });

        let amne = `Samarbete med ${kampanj.foretag_namn || kampanj.namn}`;
        let meddelande = raw;
        const parts = raw.split('---');
        if (parts.length >= 2) {
          amne = parts[0].trim().replace(/^ÄMNE:\s*/i, '').trim();
          meddelande = parts.slice(1).join('---').trim();
        }

        const { lastId } = await runSql(`
          INSERT INTO outreach_meddelanden (influencer_id, foretag_id, meddelande, amne, typ, status, kampanj_id)
          VALUES (?, ?, ?, ?, 'initial', 'utkast', ?)
        `, [infId, kampanj.foretag_id, meddelande, amne, kampanj.id]);

        const msg = await queryOne(`
          SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost
          FROM outreach_meddelanden om JOIN influencers i ON om.influencer_id = i.id
          WHERE om.id = ?
        `, [lastId]);
        messages.push(msg);
      } catch (err) {
        errors.push({ id: infId, error: err.message });
      }
    }

    // Uppdatera kampanj-statistik
    updateKampanjCounts(kampanj.id);

    res.json({ generated: messages.length, errors: errors.length, messages, errors_detail: errors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kampanjer/:id/bulk-send — skicka alla osända outreach i kampanjen
router.post('/:id/bulk-send', async (req, res) => {
  try {
    const kampanj = await queryOne('SELECT * FROM kampanjer WHERE id = ?', [Number(req.params.id)]);
    if (!kampanj) return res.status(404).json({ error: 'Kampanj hittades inte' });

    const unsent = await queryAll(`
      SELECT om.*, i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.kampanj_id = ? AND om.status = 'utkast' AND i.kontakt_epost IS NOT NULL
    `, [kampanj.id]);

    if (unsent.length === 0) return res.json({ sent: 0, message: 'Inga meddelanden att skicka' });

    const { sendEmail } = await import('../services/email-service.js');
    let sentCount = 0;
    const errors = [];

    for (const msg of unsent) {
      try {
        await sendEmail({ to: msg.kontakt_epost, subject: msg.amne, body: msg.meddelande });
        await runSql("UPDATE outreach_meddelanden SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [msg.id]);
        sentCount++;
      } catch (err) {
        errors.push({ id: msg.id, error: err.message });
      }
    }

    // Uppdatera kampanj-status
    if (kampanj.status === 'draft') {
      await runSql("UPDATE kampanjer SET status = 'active', started_at = datetime('now') WHERE id = ?", [kampanj.id]);
    }
    updateKampanjCounts(kampanj.id);

    res.json({ sent: sentCount, errors: errors.length, total: unsent.length, errors_detail: errors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/kampanjer/:id/available-influencers — influencers som inte redan är i kampanjen
router.get('/:id/available-influencers', async (req, res) => {
  try {
    const kampanj = await queryOne('SELECT * FROM kampanjer WHERE id = ?', [Number(req.params.id)]);
    if (!kampanj) return res.status(404).json({ error: 'Kampanj hittades inte' });

    const available = await queryAll(`
      SELECT i.* FROM influencers i
      WHERE i.foretag_id = ?
        AND i.id NOT IN (
          SELECT influencer_id FROM outreach_meddelanden WHERE kampanj_id = ?
        )
      ORDER BY i.namn ASC
    `, [kampanj.foretag_id, kampanj.id]);

    res.json(available);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// HJÄLPFUNKTIONER
// ============================================================

async function getKampanjStats(kampanjId) {
  const sent = (await queryOne("SELECT COUNT(*) as c FROM outreach_meddelanden WHERE kampanj_id = ? AND status != 'utkast'", [kampanjId]))?.c || 0;
  const total = (await queryOne("SELECT COUNT(*) as c FROM outreach_meddelanden WHERE kampanj_id = ?", [kampanjId]))?.c || 0;
  const replied = (await queryOne("SELECT COUNT(*) as c FROM outreach_meddelanden WHERE kampanj_id = ? AND status IN ('svarat', 'avtal_signerat')", [kampanjId]))?.c || 0;
  const contracts = (await queryOne("SELECT COUNT(*) as c FROM outreach_meddelanden WHERE kampanj_id = ? AND status = 'avtal_signerat'", [kampanjId]))?.c || 0;
  const drafts = (await queryOne("SELECT COUNT(*) as c FROM outreach_meddelanden WHERE kampanj_id = ? AND status = 'utkast'", [kampanjId]))?.c || 0;

  return {
    live_total: total,
    live_sent: sent,
    live_replied: replied,
    live_contracts: contracts,
    live_drafts: drafts,
    live_response_rate: sent > 0 ? Number(((replied / sent) * 100).toFixed(1)) : 0,
  };
}

async function updateKampanjCounts(kampanjId) {
  const stats = getKampanjStats(kampanjId);
  await runSql(`
    UPDATE kampanjer SET total_influencers = ?, total_sent = ?, total_replied = ?, total_contracts = ?
    WHERE id = ?
  `, [stats.live_total, stats.live_sent, stats.live_replied, stats.live_contracts, kampanjId]);
}

export default router;
