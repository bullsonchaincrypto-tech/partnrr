/**
 * Routes: /api/reports
 * Generera PDF-rapporter med ROI-sammanfattning för chef/styrelse
 */

import { Router } from 'express';
import { queryAll, queryOne } from '../db/schema.js';
import PDFDocument from 'pdfkit';

const router = Router();

/**
 * GET /api/reports/roi-summary
 * Generera en PDF-rapport med komplett ROI-sammanfattning
 */
router.get('/roi-summary', async (req, res) => {
  try {
    const foretagId = req.query.foretag_id;

    // Hämta företagsdata
    const foretag = foretagId
      ? await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(foretagId)])
      : await queryOne('SELECT * FROM foretag ORDER BY id DESC LIMIT 1');

    if (!foretag) return res.status(404).json({ error: 'Inget företag hittat' });

    // Samla all data
    const data = gatherReportData(foretag.id);

    // Skapa PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: `ROI-rapport — ${foretag.namn}`,
        Author: 'SparkCollab Outreach CRM',
        Subject: 'Influencer Marketing ROI',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ROI-rapport_${foretag.namn.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    buildReportPDF(doc, foretag, data);
    doc.end();

  } catch (err) {
    console.error('[Reports] ROI error:', err.message);
    res.status(500).json({ error: 'Kunde inte generera rapport' });
  }
});

/**
 * GET /api/reports/roi-data
 * Hämta rapportdata som JSON (för frontend-preview)
 */
router.get('/roi-data', async (req, res) => {
  try {
    const foretagId = req.query.foretag_id;
    const foretag = foretagId
      ? await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(foretagId)])
      : await queryOne('SELECT * FROM foretag ORDER BY id DESC LIMIT 1');

    if (!foretag) return res.json({});

    const data = gatherReportData(foretag.id);
    res.json({ foretag, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DATA GATHERING
// ============================================================

async function gatherReportData(foretagId) {
  // Outreach-statistik
  const outreachStats = await queryOne(`
    SELECT
      COUNT(*) as total_kontaktade,
      SUM(CASE WHEN status = 'skickat' THEN 1 ELSE 0 END) as skickade,
      SUM(CASE WHEN status = 'svarat' THEN 1 ELSE 0 END) as svarade,
      SUM(CASE WHEN status = 'avtal_signerat' THEN 1 ELSE 0 END) as avtal_signerade,
      SUM(CASE WHEN status = 'avbojd' THEN 1 ELSE 0 END) as avbojda
    FROM outreach_meddelanden WHERE foretag_id = ?
  `, [foretagId]) || {};

  // Kontrakt
  const contracts = await queryAll(`
    SELECT k.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.foljare
    FROM kontrakt k
    JOIN influencers i ON k.influencer_id = i.id
    WHERE k.foretag_id = ?
    ORDER BY k.created_at DESC
  `, [foretagId]);

  const activeContracts = contracts.filter(k => k.status === 'aktivt' || k.status === 'signerat');

  // Content tracking
  const contentStats = await queryOne(`
    SELECT
      COUNT(*) as total_videos,
      SUM(CASE WHEN has_cta = 1 THEN 1 ELSE 0 END) as med_cta,
      SUM(view_count) as total_views,
      SUM(like_count) as total_likes,
      SUM(comment_count) as total_comments
    FROM content_tracking WHERE foretag_id = ?
  `, [foretagId]) || {};

  // Signups per influencer
  const signups = await queryAll(`
    SELECT is2.*, i.namn as influencer_namn, i.kanalnamn
    FROM influencer_signups is2
    JOIN influencers i ON is2.influencer_id = i.id
    WHERE i.foretag_id = ?
  `, [foretagId]);

  const totalSignups = signups.reduce((sum, s) => sum + (s.antal_signups || 0), 0);

  // Kostnader (fakturor)
  const costStats = await queryOne(`
    SELECT
      SUM(total_amount_sek) as total_kostnad,
      SUM(video_amount_sek) as video_kostnad,
      SUM(signup_amount_sek) as signup_kostnad
    FROM fakturor WHERE foretag_id = ?
  `, [foretagId]) || {};

  // Beräkna estimerad kostnad från kontrakt om inga fakturor
  let totalKostnad = costStats.total_kostnad || 0;
  if (!totalKostnad && contracts.length > 0) {
    for (const k of contracts) {
      totalKostnad += (k.videos_delivered || 0) * 300;
      totalKostnad += (k.total_signups || 0) * 10;
    }
  }

  // Intäkter
  const intakterStats = await queryOne(`
    SELECT SUM(belopp_sek) as total_intakter
    FROM intakter WHERE foretag_id = ? AND status IN ('avtalat', 'fakturerad', 'betald')
  `, [foretagId]) || {};

  // Top-presterande influencers
  const topInfluencers = await queryAll(`
    SELECT i.namn, i.kanalnamn, i.plattform, i.foljare,
      k.videos_delivered, k.total_signups, k.total_payout_sek,
      (SELECT SUM(ct.view_count) FROM content_tracking ct WHERE ct.influencer_id = i.id) as total_views,
      (SELECT COUNT(*) FROM content_tracking ct WHERE ct.influencer_id = i.id AND ct.has_cta = 1) as cta_videos
    FROM influencers i
    LEFT JOIN kontrakt k ON k.influencer_id = i.id
    WHERE i.foretag_id = ?
    ORDER BY COALESCE(k.total_signups, 0) DESC, COALESCE(k.videos_delivered, 0) DESC
    LIMIT 10
  `, [foretagId]);

  // Followup-stats
  const followupStats = await queryOne(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as skickade
    FROM followup_log
    WHERE influencer_id IN (SELECT id FROM influencers WHERE foretag_id = ?)
  `, [foretagId]) || {};

  return {
    outreachStats,
    contracts,
    activeContracts,
    contentStats,
    signups,
    totalSignups,
    costStats: { ...costStats, total_kostnad: totalKostnad },
    intakterStats,
    topInfluencers,
    followupStats,
  };
}

// ============================================================
// PDF GENERATION
// ============================================================

function buildReportPDF(doc, foretag, data) {
  const pageW = doc.page.width - 100; // margin-left + margin-right

  // ─── COVER ───
  doc.rect(0, 0, doc.page.width, 200).fill('#1a1a2e');
  doc.fontSize(28).fillColor('#a855f7').text('SparkCollab', 50, 60);
  doc.fontSize(10).fillColor('#6b7280').text('INFLUENCER MARKETING ROI-RAPPORT', 50, 95);
  doc.fontSize(20).fillColor('#ffffff').text(foretag.namn, 50, 130);
  doc.fontSize(10).fillColor('#9ca3af').text(
    `Genererad: ${new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    50, 160
  );

  doc.moveDown(4);

  // ─── EXECUTIVE SUMMARY ───
  sectionTitle(doc, 'Sammanfattning');

  const svarsfrekvens = data.outreachStats.skickade > 0
    ? Math.round(((data.outreachStats.svarade || 0) / data.outreachStats.skickade) * 100)
    : 0;
  const konvFrekvens = data.outreachStats.svarade > 0
    ? Math.round(((data.outreachStats.avtal_signerade || 0) / data.outreachStats.svarade) * 100)
    : 0;
  const costPerSignup = data.totalSignups > 0
    ? Math.round(data.costStats.total_kostnad / data.totalSignups)
    : null;

  doc.fontSize(10).fillColor('#374151');

  const summaryLines = [
    `Under rapportperioden har ${foretag.namn} kontaktat ${data.outreachStats.total_kontaktade || 0} influencers via SparkCollab.`,
    `Av dessa svarade ${data.outreachStats.svarade || 0} st (${svarsfrekvens}% svarsfrekvens) och ${data.outreachStats.avtal_signerade || 0} avtal signerades (${konvFrekvens}% konvertering).`,
    data.totalSignups > 0
      ? `Totalt genererades ${data.totalSignups} signups via referral-koder.${costPerSignup ? ` Kostnad per signup: ${costPerSignup} SEK.` : ''}`
      : 'Inga signups har rapporterats ännu.',
  ];
  for (const line of summaryLines) {
    doc.text(line, { width: pageW, lineGap: 4 });
  }

  doc.moveDown(1.5);

  // ─── NYCKELTAL ───
  sectionTitle(doc, 'Nyckeltal');

  const kpis = [
    ['Kontaktade influencers', String(data.outreachStats.total_kontaktade || 0)],
    ['Svarsfrekvens', `${svarsfrekvens}%`],
    ['Aktiva avtal', String(data.activeContracts.length)],
    ['Publicerade videos', String(data.contentStats.total_videos || 0)],
    ['Totala visningar', formatSEK(data.contentStats.total_views || 0)],
    ['Totala signups', String(data.totalSignups)],
    ['Total kostnad', `${formatSEK(data.costStats.total_kostnad)} SEK`],
    ['Kostnad per signup', costPerSignup ? `${costPerSignup} SEK` : '—'],
  ];

  const colW = pageW / 4;
  let x = 50;
  let y = doc.y;

  for (let i = 0; i < kpis.length; i++) {
    if (i > 0 && i % 4 === 0) {
      x = 50;
      y += 50;
    }

    doc.rect(x, y, colW - 8, 42).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
    doc.fontSize(14).fillColor('#1f2937').text(kpis[i][1], x + 8, y + 6, { width: colW - 16 });
    doc.fontSize(7).fillColor('#6b7280').text(kpis[i][0], x + 8, y + 26, { width: colW - 16 });

    x += colW;
  }

  doc.y = y + 60;
  doc.moveDown(1);

  // ─── TOP INFLUENCERS ───
  if (data.topInfluencers.length > 0) {
    sectionTitle(doc, 'Toppresultat per influencer');

    // Table header
    const tableX = 50;
    let tY = doc.y;
    const cols = [140, 70, 55, 60, 55, 80];

    doc.fontSize(7).fillColor('#6b7280');
    doc.text('Influencer', tableX, tY);
    doc.text('Plattform', tableX + cols[0], tY);
    doc.text('Videos', tableX + cols[0] + cols[1], tY);
    doc.text('Signups', tableX + cols[0] + cols[1] + cols[2], tY);
    doc.text('Visningar', tableX + cols[0] + cols[1] + cols[2] + cols[3], tY);
    doc.text('Utbetalat', tableX + cols[0] + cols[1] + cols[2] + cols[3] + cols[4], tY);

    tY += 14;
    doc.moveTo(tableX, tY).lineTo(tableX + pageW, tY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
    tY += 6;

    for (const inf of data.topInfluencers.slice(0, 10)) {
      if (tY > doc.page.height - 80) {
        doc.addPage();
        tY = 50;
      }

      doc.fontSize(8).fillColor('#1f2937');
      doc.text(inf.namn || '—', tableX, tY, { width: cols[0] - 5, ellipsis: true });
      doc.fillColor('#6b7280');
      doc.text(inf.plattform || '—', tableX + cols[0], tY);
      doc.text(String(inf.videos_delivered || 0), tableX + cols[0] + cols[1], tY);
      doc.text(String(inf.total_signups || 0), tableX + cols[0] + cols[1] + cols[2], tY);
      doc.text(formatSEK(inf.total_views || 0), tableX + cols[0] + cols[1] + cols[2] + cols[3], tY);
      doc.text(`${formatSEK(inf.total_payout_sek || 0)} SEK`, tableX + cols[0] + cols[1] + cols[2] + cols[3] + cols[4], tY);

      tY += 16;
    }

    doc.y = tY + 10;
    doc.moveDown(1);
  }

  // ─── AVTALSSTATUS ───
  if (data.contracts.length > 0) {
    if (doc.y > doc.page.height - 200) doc.addPage();

    sectionTitle(doc, 'Avtalsstatus');

    const statusCount = {};
    for (const k of data.contracts) {
      const s = k.status || 'okänd';
      statusCount[s] = (statusCount[s] || 0) + 1;
    }

    doc.fontSize(9).fillColor('#374151');
    for (const [status, count] of Object.entries(statusCount)) {
      doc.text(`${statusLabel(status)}: ${count} st`, { indent: 10 });
    }

    doc.moveDown(1);
  }

  // ─── UPPFÖLJNING ───
  if (data.followupStats.total > 0) {
    sectionTitle(doc, 'Uppföljningar');
    doc.fontSize(9).fillColor('#374151');
    doc.text(`Totalt genererade: ${data.followupStats.total}`, { indent: 10 });
    doc.text(`Skickade: ${data.followupStats.skickade || 0}`, { indent: 10 });
    doc.moveDown(1);
  }

  // ─── REKOMMENDATIONER ───
  if (doc.y > doc.page.height - 200) doc.addPage();

  sectionTitle(doc, 'Rekommendationer');

  doc.fontSize(9).fillColor('#374151');

  const recs = [];
  if (svarsfrekvens < 20) {
    recs.push('Svarsfrekvensen är under 20%. Överväg att justera outreach-meddelanden — testa olika ämnesrader via A/B-testning.');
  }
  if (svarsfrekvens >= 20 && konvFrekvens < 30) {
    recs.push('Svarsfrekvensen är bra men konverteringen till avtal är låg. Förbättra erbjudandet eller förhandlingsprocessen.');
  }
  if (data.contentStats.total_videos > 0 && data.contentStats.med_cta < data.contentStats.total_videos * 0.7) {
    recs.push(`Bara ${data.contentStats.med_cta} av ${data.contentStats.total_videos} videos innehåller CTA. Betona vikten av tydlig call-to-action i briefing.`);
  }
  if (data.totalSignups > 0 && costPerSignup && costPerSignup > 100) {
    recs.push(`Kostnad per signup (${costPerSignup} SEK) är hög. Fokusera på influencers med bevisad konvertering.`);
  }
  if (data.activeContracts.length > 0) {
    recs.push(`${data.activeContracts.length} aktiva avtal — säkerställ att alla levererar inom deadline.`);
  }
  if (recs.length === 0) {
    recs.push('Data är för begränsad för specifika rekommendationer. Fortsätt samla in resultat.');
  }

  for (let i = 0; i < recs.length; i++) {
    doc.text(`${i + 1}. ${recs[i]}`, { width: pageW, indent: 10, lineGap: 3 });
  }

  // ─── FOOTER ───
  doc.moveDown(3);
  doc.fontSize(7).fillColor('#9ca3af');
  doc.text('Rapporten genererades automatiskt av SparkCollab Outreach CRM.', { align: 'center' });
  doc.text(`${foretag.namn} • ${new Date().toLocaleDateString('sv-SE')}`, { align: 'center' });
}

// ─── HELPERS ───

function sectionTitle(doc, title) {
  doc.fontSize(13).fillColor('#7c3aed').text(title);
  doc.moveTo(50, doc.y + 2).lineTo(250, doc.y + 2).strokeColor('#7c3aed').lineWidth(1).stroke();
  doc.moveDown(0.5);
}

function formatSEK(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('sv-SE');
}

function statusLabel(status) {
  const labels = {
    'genererat': 'Genererat',
    'skickat_for_signering': 'Skickat för signering',
    'signerat': 'Signerat',
    'aktivt': 'Aktivt',
    'utgånget': 'Utgånget',
    'avböjt': 'Avböjt',
  };
  return labels[status] || status;
}

export default router;
