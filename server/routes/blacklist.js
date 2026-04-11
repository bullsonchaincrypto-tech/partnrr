/**
 * Routes: /api/blacklist
 * Influencer-blacklist, favoriter, och sparade sökningar
 */

import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// ─── BLACKLIST ──────────────────────────────────────

// GET /api/blacklist — Hämta alla blacklistade
router.get('/', async (req, res) => {
  const list = await queryAll('SELECT * FROM influencer_blacklist ORDER BY created_at DESC');
  res.json(list);
});

// POST /api/blacklist — Lägg till i blacklist
router.post('/', async (req, res) => {
  const { namn, kanalnamn, plattform, kontakt_epost, anledning } = req.body;
  if (!kanalnamn && !kontakt_epost) {
    return res.status(400).json({ error: 'kanalnamn eller kontakt_epost krävs' });
  }
  const { lastId } = await runSql(
    `INSERT INTO influencer_blacklist (namn, kanalnamn, plattform, kontakt_epost, anledning)
     VALUES (?, ?, ?, ?, ?)`,
    [namn || null, kanalnamn || null, plattform || null, kontakt_epost || null, anledning || 'manuell']
  );
  res.json({ id: lastId, success: true });
});

// DELETE /api/blacklist/:id — Ta bort från blacklist
router.delete('/:id', async (req, res) => {
  await runSql('DELETE FROM influencer_blacklist WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// GET /api/blacklist/check — Kolla om en influencer är blacklistad
router.get('/check', async (req, res) => {
  const { kanalnamn, kontakt_epost } = req.query;
  let blocked = null;
  if (kanalnamn) {
    blocked = await queryOne(
      'SELECT * FROM influencer_blacklist WHERE LOWER(kanalnamn) = LOWER(?)',
      [kanalnamn.replace(/^@/, '')]
    );
  }
  if (!blocked && kontakt_epost) {
    blocked = await queryOne(
      'SELECT * FROM influencer_blacklist WHERE LOWER(kontakt_epost) = LOWER(?)',
      [kontakt_epost]
    );
  }
  res.json({ blacklisted: !!blocked, entry: blocked || null });
});

// POST /api/blacklist/from-outreach/:influencerId — Blacklista från outreach (avböjt)
router.post('/from-outreach/:influencerId', async (req, res) => {
  const inf = await queryOne('SELECT * FROM influencers WHERE id = ?', [Number(req.params.influencerId)]);
  if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });

  const exists = await queryOne(
    'SELECT id FROM influencer_blacklist WHERE LOWER(kanalnamn) = LOWER(?) OR LOWER(kontakt_epost) = LOWER(?)',
    [(inf.kanalnamn || '').toLowerCase(), (inf.kontakt_epost || '').toLowerCase()]
  );
  if (exists) return res.json({ already: true, id: exists.id });

  const { lastId } = await runSql(
    `INSERT INTO influencer_blacklist (namn, kanalnamn, plattform, kontakt_epost, anledning)
     VALUES (?, ?, ?, ?, ?)`,
    [inf.namn, inf.kanalnamn, inf.plattform, inf.kontakt_epost, req.body.anledning || 'avbojd']
  );
  res.json({ id: lastId, success: true });
});

// ─── FAVORITER ──────────────────────────────────────

// GET /api/blacklist/favorites — Hämta favoriter
router.get('/favorites', async (req, res) => {
  const foretag_id = req.query.foretag_id;
  let sql = 'SELECT * FROM influencer_favorites ORDER BY created_at DESC';
  let params = [];
  if (foretag_id) {
    sql = 'SELECT * FROM influencer_favorites WHERE foretag_id = ? ORDER BY created_at DESC';
    params = [Number(foretag_id)];
  }
  res.json(await queryAll(sql, params));
});

// POST /api/blacklist/favorites — Spara som favorit
router.post('/favorites', async (req, res) => {
  const { influencer_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, notering, foretag_id } = req.body;
  if (!namn && !kanalnamn) return res.status(400).json({ error: 'namn eller kanalnamn krävs' });

  // Kolla dubbletter
  const exists = await queryOne(
    'SELECT id FROM influencer_favorites WHERE LOWER(kanalnamn) = LOWER(?) AND plattform = ?',
    [(kanalnamn || '').toLowerCase(), plattform || 'youtube']
  );
  if (exists) return res.json({ already: true, id: exists.id });

  const { lastId } = await runSql(
    `INSERT INTO influencer_favorites (influencer_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, notering, foretag_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [influencer_id || null, namn, kanalnamn || null, plattform || null, foljare || null, nisch || null, kontakt_epost || null, notering || null, foretag_id || null]
  );
  res.json({ id: lastId, success: true });
});

// PUT /api/blacklist/favorites/:id — Uppdatera notering
router.put('/favorites/:id', async (req, res) => {
  const { notering } = req.body;
  await runSql('UPDATE influencer_favorites SET notering = ? WHERE id = ?', [notering, Number(req.params.id)]);
  res.json({ success: true });
});

// DELETE /api/blacklist/favorites/:id — Ta bort favorit
router.delete('/favorites/:id', async (req, res) => {
  await runSql('DELETE FROM influencer_favorites WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// ─── SPARADE SÖKNINGAR ─────────────────────────────

// GET /api/blacklist/searches — Hämta sparade sökningar
router.get('/searches', async (req, res) => {
  res.json(await queryAll('SELECT * FROM saved_searches ORDER BY created_at DESC'));
});

// POST /api/blacklist/searches — Spara en sökning
router.post('/searches', async (req, res) => {
  const { namn, foretag_id, sok_parametrar, resultat_count } = req.body;
  if (!namn || !sok_parametrar) return res.status(400).json({ error: 'namn och sok_parametrar krävs' });

  const { lastId } = await runSql(
    `INSERT INTO saved_searches (namn, foretag_id, sok_parametrar, resultat_count, senast_kord)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [namn, foretag_id || null, typeof sok_parametrar === 'string' ? sok_parametrar : JSON.stringify(sok_parametrar), resultat_count || 0]
  );
  res.json({ id: lastId, success: true });
});

// DELETE /api/blacklist/searches/:id — Ta bort sparad sökning
router.delete('/searches/:id', async (req, res) => {
  await runSql('DELETE FROM saved_searches WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// PUT /api/blacklist/searches/:id/run — Markera sökning som körd
router.put('/searches/:id/run', async (req, res) => {
  const { resultat_count } = req.body;
  await runSql(
    'UPDATE saved_searches SET senast_kord = datetime(\'now\'), resultat_count = COALESCE(?, resultat_count) WHERE id = ?',
    [resultat_count || null, Number(req.params.id)]
  );
  res.json({ success: true });
});

export default router;
