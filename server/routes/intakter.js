import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';

const router = Router();

// Översikt — totala intäkter, per status, per kampanj
router.get('/overview', async (req, res) => {
  const total_avtalat = (await queryOne("SELECT COALESCE(SUM(belopp_sek), 0) as v FROM intakter WHERE status != 'makulerad'"))?.v || 0;
  const total_fakturerat = (await queryOne("SELECT COALESCE(SUM(belopp_sek), 0) as v FROM intakter WHERE fakturerad = 1"))?.v || 0;
  const total_betalt = (await queryOne("SELECT COALESCE(SUM(belopp_sek), 0) as v FROM intakter WHERE betald = 1"))?.v || 0;
  const total_obetalt = total_fakturerat - total_betalt;
  const antal_avtal = (await queryOne("SELECT COUNT(*) as v FROM intakter WHERE status != 'makulerad'"))?.v || 0;
  const antal_sponsorer = (await queryOne("SELECT COUNT(DISTINCT sponsor_namn) as v FROM intakter WHERE status != 'makulerad'"))?.v || 0;

  // Per kampanj
  const per_kampanj = await queryAll(`
    SELECT kampanj_namn,
           COUNT(*) as antal_sponsorer,
           SUM(belopp_sek) as total_belopp,
           SUM(CASE WHEN betald = 1 THEN belopp_sek ELSE 0 END) as betalt_belopp
    FROM intakter
    WHERE status != 'makulerad' AND kampanj_namn IS NOT NULL AND kampanj_namn != ''
    GROUP BY kampanj_namn
    ORDER BY total_belopp DESC
  `);

  // Per status
  const per_status = await queryAll(`
    SELECT status, COUNT(*) as antal, SUM(belopp_sek) as belopp
    FROM intakter
    GROUP BY status
  `);

  res.json({
    total_avtalat, total_fakturerat, total_betalt, total_obetalt,
    antal_avtal, antal_sponsorer, per_kampanj, per_status
  });
});

// Lista alla intäkter
router.get('/', async (req, res) => {
  const { status, kampanj } = req.query;
  let sql = `
    SELECT i.*, sp.namn as prospect_namn, sp.bransch as prospect_bransch
    FROM intakter i
    LEFT JOIN sponsor_prospects sp ON i.sponsor_prospect_id = sp.id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== 'alla') {
    sql += ' AND i.status = ?';
    params.push(status);
  }
  if (kampanj) {
    sql += ' AND i.kampanj_namn = ?';
    params.push(kampanj);
  }
  sql += ' ORDER BY i.created_at DESC';
  res.json(await queryAll(sql, params));
});

// Hämta en intäkt
router.get('/:id', async (req, res) => {
  const row = await queryOne('SELECT * FROM intakter WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Intäkt hittades inte' });
  res.json(row);
});

// Skapa ny intäkt (manuellt eller kopplad till sponsor-prospect)
router.post('/', async (req, res) => {
  const { sponsor_namn, belopp_sek, kampanj_namn, beskrivning, kontaktperson, typ,
          sponsor_prospect_id, sponsor_outreach_id, foretag_id, avtalsdatum, forfallodag, notes } = req.body;

  if (!sponsor_namn || !belopp_sek) {
    return res.status(400).json({ error: 'sponsor_namn och belopp_sek krävs' });
  }

  const { lastId } = await runSql(`
    INSERT INTO intakter (foretag_id, sponsor_prospect_id, sponsor_outreach_id, kampanj_namn, sponsor_namn,
                          kontaktperson, beskrivning, belopp_sek, typ, avtalsdatum, forfallodag, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    foretag_id || null, sponsor_prospect_id || null, sponsor_outreach_id || null,
    kampanj_namn || null, sponsor_namn, kontaktperson || null, beskrivning || null,
    belopp_sek, typ || 'sponsoravtal', avtalsdatum || new Date().toISOString().split('T')[0],
    forfallodag || null, notes || null
  ]);

  const row = await queryOne('SELECT * FROM intakter WHERE id = ?', [lastId]);
  res.json(row);
});

// Uppdatera intäkt
router.put('/:id', async (req, res) => {
  const { sponsor_namn, belopp_sek, kampanj_namn, beskrivning, kontaktperson,
          typ, status, fakturerad, betald, avtalsdatum, forfallodag, betald_datum, notes } = req.body;

  const existing = await queryOne('SELECT * FROM intakter WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Intäkt hittades inte' });

  await runSql(`
    UPDATE intakter SET
      sponsor_namn = COALESCE(?, sponsor_namn),
      belopp_sek = COALESCE(?, belopp_sek),
      kampanj_namn = COALESCE(?, kampanj_namn),
      beskrivning = COALESCE(?, beskrivning),
      kontaktperson = COALESCE(?, kontaktperson),
      typ = COALESCE(?, typ),
      status = COALESCE(?, status),
      fakturerad = COALESCE(?, fakturerad),
      betald = COALESCE(?, betald),
      avtalsdatum = COALESCE(?, avtalsdatum),
      forfallodag = COALESCE(?, forfallodag),
      betald_datum = COALESCE(?, betald_datum),
      notes = COALESCE(?, notes)
    WHERE id = ?
  `, [
    sponsor_namn, belopp_sek, kampanj_namn, beskrivning, kontaktperson,
    typ, status, fakturerad, betald, avtalsdatum, forfallodag, betald_datum, notes,
    req.params.id
  ]);

  res.json(await queryOne('SELECT * FROM intakter WHERE id = ?', [req.params.id]));
});

// Uppdatera status (snabbväxling)
router.put('/:id/status', async (req, res) => {
  const { status, fakturerad, betald } = req.body;
  const existing = await queryOne('SELECT * FROM intakter WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Intäkt hittades inte' });

  if (status) await runSql('UPDATE intakter SET status = ? WHERE id = ?', [status, req.params.id]);
  if (fakturerad !== undefined) await runSql('UPDATE intakter SET fakturerad = ? WHERE id = ?', [fakturerad ? 1 : 0, req.params.id]);
  if (betald !== undefined) {
    await runSql('UPDATE intakter SET betald = ?, betald_datum = ? WHERE id = ?', [
      betald ? 1 : 0,
      betald ? new Date().toISOString() : null,
      req.params.id
    ]);
  }

  res.json(await queryOne('SELECT * FROM intakter WHERE id = ?', [req.params.id]));
});

// Ta bort (makulera)
router.delete('/:id', async (req, res) => {
  await runSql("UPDATE intakter SET status = 'makulerad' WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

// Lista unika kampanjnamn (för filter)
router.get('/meta/kampanjer', async (req, res) => {
  const rows = await queryAll("SELECT DISTINCT kampanj_namn FROM intakter WHERE kampanj_namn IS NOT NULL AND kampanj_namn != '' ORDER BY kampanj_namn");
  res.json(rows.map(r => r.kampanj_namn));
});

export default router;
