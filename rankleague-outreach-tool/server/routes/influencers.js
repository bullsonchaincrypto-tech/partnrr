import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { findInfluencers } from '../services/anthropic.js';

const router = Router();

router.get('/foretag/:foretagId', (req, res) => {
  const rows = queryAll('SELECT * FROM influencers WHERE foretag_id = ? ORDER BY created_at DESC', [Number(req.params.foretagId)]);
  res.json(rows);
});

router.post('/find', async (req, res) => {
  try {
    const { foretagId } = req.body;
    const foretag = queryOne('SELECT * FROM foretag WHERE id = ?', [foretagId]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    const influencerList = await findInfluencers(foretag.namn, foretag.bransch);

    // Clear previous
    runSql('DELETE FROM influencers WHERE foretag_id = ?', [foretagId]);

    for (const inf of influencerList) {
      const referralKod = inf.kanalnamn.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      runSql(
        `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [foretagId, inf.namn, inf.kanalnamn, inf.plattform, inf.foljare, inf.nisch,
         inf.kontakt_epost || null, inf.kontakt_info || null, referralKod]
      );
    }

    const saved = queryAll('SELECT * FROM influencers WHERE foretag_id = ?', [foretagId]);
    res.json(saved);
  } catch (error) {
    console.error('Find influencers error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/toggle', (req, res) => {
  const inf = queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.id)]);
  if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });
  runSql('UPDATE influencers SET vald = ? WHERE id = ?', [inf.vald ? 0 : 1, Number(req.params.id)]);
  const updated = queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.id)]);
  res.json(updated);
});

router.put('/foretag/:foretagId/select-all', (req, res) => {
  const { selected } = req.body;
  runSql('UPDATE influencers SET vald = ? WHERE foretag_id = ?', [selected ? 1 : 0, Number(req.params.foretagId)]);
  const rows = queryAll('SELECT * FROM influencers WHERE foretag_id = ?', [Number(req.params.foretagId)]);
  res.json(rows);
});

export default router;
