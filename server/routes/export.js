import { Router } from 'express';
import { queryAll, queryOne } from '../db/schema.js';
import { generateKontraktPdf } from '../services/pdf.js';

const router = Router();

// Export outreach data as CSV
router.get('/csv/outreach', async (req, res) => {
  const rows = await queryAll(`
    SELECT om.id, i.namn as influencer, i.kanalnamn as kanal, i.plattform, i.foljare,
           i.kontakt_epost as epost, om.amne, om.status, om.typ,
           om.kontrakt_bifogat, om.skickat_datum, om.created_at,
           f.namn as foretag
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    JOIN foretag f ON om.foretag_id = f.id
    ORDER BY om.created_at DESC
  `);

  const headers = ['ID', 'Influencer', 'Kanal', 'Plattform', 'Foljare', 'E-post', 'Amne', 'Status', 'Typ', 'Kontrakt', 'Skickat', 'Skapad', 'Foretag'];
  const csvRows = rows.map(r => [
    r.id, r.influencer, r.kanal, r.plattform, r.foljare, r.epost || '',
    `"${(r.amne || '').replace(/"/g, '""')}"`, r.status, r.typ,
    r.kontrakt_bifogat ? 'Ja' : 'Nej', r.skickat_datum || '', r.created_at, r.foretag
  ].join(','));

  const csv = [headers.join(','), ...csvRows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="outreach_export.csv"');
  // BOM for Excel UTF-8 support
  res.send('\uFEFF' + csv);
});

// Export sponsor outreach as CSV
router.get('/csv/sponsors', async (req, res) => {
  const rows = await queryAll(`
    SELECT so.id, sp.namn as prospect, sp.bransch, sp.epost, sp.instagram_handle,
           so.amne, so.kanal, so.status, so.skickat_datum, so.created_at,
           f.namn as foretag
    FROM sponsor_outreach so
    JOIN sponsor_prospects sp ON so.prospect_id = sp.id
    JOIN foretag f ON so.foretag_id = f.id
    ORDER BY so.created_at DESC
  `);

  const headers = ['ID', 'Prospect', 'Bransch', 'E-post', 'Instagram', 'Amne', 'Kanal', 'Status', 'Skickat', 'Skapad', 'Foretag'];
  const csvRows = rows.map(r => [
    r.id, r.prospect, r.bransch, r.epost || '', r.instagram_handle || '',
    `"${(r.amne || '').replace(/"/g, '""')}"`, r.kanal, r.status,
    r.skickat_datum || '', r.created_at, r.foretag
  ].join(','));

  const csv = [headers.join(','), ...csvRows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sponsor_export.csv"');
  res.send('\uFEFF' + csv);
});

// Export influencer ranking as CSV
router.get('/csv/ranking', async (req, res) => {
  const rows = await queryAll(`
    SELECT i.namn, i.kanalnamn, i.plattform, i.foljare, i.referral_kod,
           COALESCE(s.antal_signups, 0) as signups,
           COUNT(om.id) as total_outreach,
           SUM(CASE WHEN om.status = 'avtal_signerat' THEN 1 ELSE 0 END) as avtal
    FROM influencers i
    LEFT JOIN influencer_signups s ON i.id = s.influencer_id
    LEFT JOIN outreach_meddelanden om ON i.id = om.influencer_id
    GROUP BY i.id
    ORDER BY signups DESC, avtal DESC
  `);

  const headers = ['Namn', 'Kanal', 'Plattform', 'Foljare', 'Referral-kod', 'Signups', 'Outreach', 'Avtal'];
  const csvRows = rows.map(r => [
    r.namn, r.kanalnamn, r.plattform, r.foljare, r.referral_kod,
    r.signups, r.total_outreach, r.avtal
  ].join(','));

  const csv = [headers.join(','), ...csvRows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="influencer_ranking.csv"');
  res.send('\uFEFF' + csv);
});

// Re-generate / download contract PDF
router.get('/pdf/kontrakt/:outreachId', async (req, res) => {
  try {
    const msg = await queryOne(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.referral_kod, i.kontakt_epost
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.id = ?
    `, [Number(req.params.outreachId)]);

    if (!msg) return res.status(404).json({ error: 'Meddelande hittades inte' });

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [msg.foretag_id]);
    const kontrakt = await queryOne('SELECT * FROM kontrakt WHERE outreach_id = ?', [msg.id]);

    const pdfBuffer = await generateKontraktPdf({
      foretag,
      influencer: {
        namn: msg.influencer_namn,
        kanalnamn: msg.kanalnamn,
        plattform: msg.plattform,
        referral_kod: msg.referral_kod,
        kontakt_epost: msg.kontakt_epost,
      },
      kontaktperson: kontrakt?.kontaktperson || foretag.kontaktperson || foretag.namn,
      datum: kontrakt?.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kontrakt_${msg.influencer_namn.replace(/\s/g, '_')}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Export PDF error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
