import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { findSponsorProspects, generateSponsorPitch } from '../services/anthropic.js';
import { sendEmail } from '../services/gmail.js';

const router = Router();

// Get prospects for a företag
router.get('/prospects/:foretagId', (req, res) => {
  const rows = queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ? ORDER BY created_at DESC', [Number(req.params.foretagId)]);
  res.json(rows);
});

// AI: Find sponsor prospects
router.post('/prospects/find', async (req, res) => {
  try {
    const { foretagId } = req.body;
    const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Foretag hittades inte' });

    const prospects = await findSponsorProspects(foretag.namn, foretag.bransch);

    runSql('DELETE FROM sponsor_prospects WHERE foretag_id = ?', [foretagId]);

    for (const p of prospects) {
      runSql(
        `INSERT INTO sponsor_prospects (foretag_id, namn, kontaktperson, epost, bransch, instagram_handle, hemsida)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [foretagId, p.namn, p.kontaktperson || null, p.epost || null, p.bransch, p.instagram_handle || null, p.hemsida || null]
      );
    }

    const saved = queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ?', [foretagId]);
    res.json(saved);
  } catch (error) {
    console.error('Find sponsors error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle selection
router.put('/prospects/:id/toggle', (req, res) => {
  const p = queryOne('SELECT * FROM sponsor_prospects WHERE id = ?', [Number(req.params.id)]);
  if (!p) return res.status(404).json({ error: 'Prospect hittades inte' });
  runSql('UPDATE sponsor_prospects SET vald = ? WHERE id = ?', [p.vald ? 0 : 1, Number(req.params.id)]);
  const updated = queryOne('SELECT * FROM sponsor_prospects WHERE id = ?', [Number(req.params.id)]);
  res.json(updated);
});

router.put('/prospects/:foretagId/select-all', (req, res) => {
  const { selected } = req.body;
  runSql('UPDATE sponsor_prospects SET vald = ? WHERE foretag_id = ?', [selected ? 1 : 0, Number(req.params.foretagId)]);
  const rows = queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ?', [Number(req.params.foretagId)]);
  res.json(rows);
});

// Generate sponsor pitches
router.post('/outreach/generate', async (req, res) => {
  try {
    const { foretagId, kanal } = req.body;
    const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Foretag hittades inte' });

    const selected = queryAll('SELECT * FROM sponsor_prospects WHERE foretag_id = ? AND vald = 1', [foretagId]);
    if (selected.length === 0) return res.status(400).json({ error: 'Inga prospects valda' });

    const messages = [];
    for (const prospect of selected) {
      const raw = await generateSponsorPitch(prospect, foretag, kanal || 'email');

      let amne = `Sponsorsamarbete - ${foretag.namn} x ${prospect.namn}`;
      let meddelande = raw;

      const parts = raw.split('---');
      if (parts.length >= 2) {
        const amneLine = parts[0].trim();
        amne = amneLine.replace(/^ÄMNE:\s*/i, '').trim();
        meddelande = parts.slice(1).join('---').trim();
      }

      const { lastId } = runSql(`
        INSERT INTO sponsor_outreach (prospect_id, foretag_id, meddelande, amne, kanal, status)
        VALUES (?, ?, ?, ?, ?, 'utkast')
      `, [prospect.id, foretagId, meddelande, amne, kanal || 'email']);

      const msg = queryOne(`
        SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
        FROM sponsor_outreach so
        JOIN sponsor_prospects sp ON so.prospect_id = sp.id
        WHERE so.id = ?
      `, [lastId]);

      messages.push(msg);
    }

    res.json(messages);
  } catch (error) {
    console.error('Generate sponsor pitch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all sponsor outreach
router.get('/outreach/:foretagId', (req, res) => {
  const rows = queryAll(`
    SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE so.foretag_id = ?
    ORDER BY so.created_at DESC
  `, [Number(req.params.foretagId)]);
  res.json(rows);
});

// Update sponsor outreach message
router.put('/outreach/:id', (req, res) => {
  const { meddelande, amne, status } = req.body;
  const sets = [];
  const vals = [];
  if (meddelande !== undefined) { sets.push('meddelande = ?'); vals.push(meddelande); }
  if (amne !== undefined) { sets.push('amne = ?'); vals.push(amne); }
  if (status !== undefined) { sets.push('status = ?'); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ error: 'Inget att uppdatera' });

  vals.push(Number(req.params.id));
  runSql(`UPDATE sponsor_outreach SET ${sets.join(', ')} WHERE id = ?`, vals);

  const msg = queryOne(`
    SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost, sp.bransch as prospect_bransch, sp.instagram_handle
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    WHERE so.id = ?
  `, [Number(req.params.id)]);
  res.json(msg);
});

// Send sponsor outreach
router.post('/outreach/send', async (req, res) => {
  try {
    const { messageIds } = req.body;
    const results = [];

    for (const msgId of messageIds) {
      const msg = queryOne(`
        SELECT so.*, sp.namn as prospect_namn, sp.epost as prospect_epost
        FROM sponsor_outreach so
        JOIN sponsor_prospects sp ON so.prospect_id = sp.id
        WHERE so.id = ?
      `, [msgId]);

      if (!msg || !msg.prospect_epost) {
        results.push({ id: msgId, status: 'misslyckat', error: 'Ingen e-post' });
        runSql("UPDATE sponsor_outreach SET status = 'misslyckat' WHERE id = ?", [msgId]);
        continue;
      }

      try {
        await sendEmail({ to: msg.prospect_epost, subject: msg.amne, body: msg.meddelande });
        runSql("UPDATE sponsor_outreach SET status = 'skickat', skickat_datum = datetime('now') WHERE id = ?", [msgId]);
        results.push({ id: msgId, status: 'skickat' });
      } catch (sendErr) {
        runSql("UPDATE sponsor_outreach SET status = 'misslyckat' WHERE id = ?", [msgId]);
        results.push({ id: msgId, status: 'misslyckat', error: sendErr.message });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
