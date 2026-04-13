import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { analyzeConversion, deepAnalyzeOutreach } from '../services/anthropic.js';
import { generateDailySummary, sendDailySummary } from '../services/daily-summary.js';

const router = Router();

router.get('/stats', async (req, res) => {
  try {
  // Kontaktade = alla som inte är utkast
  const total = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'"))?.count || 0;
  // Skickade = alla som skickats (inkl. de som sedan blivit svarat/avtal/etc)
  const skickat = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast' AND skickat_datum IS NOT NULL"))?.count || 0;
  const svarat = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'"))?.count || 0;
  const avtal = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'"))?.count || 0;
  const avbojt = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'"))?.count || 0;
  const misslyckat = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'misslyckat'"))?.count || 0;
  const kontraktCount = (await queryOne("SELECT COUNT(*) as count FROM kontrakt"))?.count || 0;
  const svarsfrekvens = total > 0 ? parseFloat(((svarat + avtal + avbojt) / total * 100).toFixed(1)) : 0;

  // Email tracking stats
  const totalTracked = (await queryOne('SELECT COUNT(*) as count FROM email_tracking'))?.count || 0;
  const totalOpened = (await queryOne('SELECT COUNT(*) as count FROM email_tracking WHERE oppnad = 1'))?.count || 0;
  const oppningsfrekvens = totalTracked > 0 ? parseFloat(((totalOpened / totalTracked) * 100).toFixed(1)) : 0;

  const perPlatform = await queryAll(`
    SELECT i.plattform, COUNT(*) as count,
      SUM(CASE WHEN om.status = 'svarat' OR om.status = 'avtal_signerat' THEN 1 ELSE 0 END) as svar
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    WHERE om.status != 'utkast'
    GROUP BY i.plattform
  `);

  // Per platform response rates
  const platformResponseRates = perPlatform.map(p => ({
    plattform: p.plattform,
    total: p.count,
    svar: p.svar,
    svarsfrekvens: p.count > 0 ? parseFloat(((p.svar / p.count) * 100).toFixed(1)) : 0,
  }));

  const perMonth = await queryAll(`
    SELECT TO_CHAR(skickat_datum, 'YYYY-MM') as manad, COUNT(*) as count
    FROM outreach_meddelanden
    WHERE skickat_datum IS NOT NULL
    GROUP BY TO_CHAR(skickat_datum, 'YYYY-MM')
    ORDER BY manad DESC
    LIMIT 12
  `);

  // Per week stats
  const perWeek = await queryAll(`
    SELECT TO_CHAR(skickat_datum, 'IYYY-"W"IW') as vecka, COUNT(*) as count
    FROM outreach_meddelanden
    WHERE skickat_datum IS NOT NULL
    GROUP BY TO_CHAR(skickat_datum, 'IYYY-"W"IW')
    ORDER BY vecka DESC
    LIMIT 12
  `);

  // Conversion funnel
  const funnel = [
    { steg: 'Kontaktade', antal: total },
    { steg: 'Oppnade', antal: totalOpened },
    { steg: 'Svarade', antal: svarat + avtal },
    { steg: 'Avtal', antal: avtal },
  ];

  // Sponsor stats
  const sponsorTotal = (await queryOne("SELECT COUNT(*) as count FROM sponsor_outreach WHERE status != 'utkast'"))?.count || 0;
  const sponsorSkickat = (await queryOne("SELECT COUNT(*) as count FROM sponsor_outreach WHERE status = 'skickat'"))?.count || 0;
  const sponsorSvarat = (await queryOne("SELECT COUNT(*) as count FROM sponsor_outreach WHERE status = 'svarat'"))?.count || 0;

  // Kombinerade siffror (influencer + sponsor)
  const totalKombinerat = total + sponsorTotal;
  const skickatKombinerat = skickat + sponsorSkickat;

  res.json({
    total: totalKombinerat, skickat: skickatKombinerat, svarat, avtal: kontraktCount, avtal_signerat_outreach: avtal, avbojt, misslyckat, kontraktCount, svarsfrekvens,
    totalTracked, totalOpened, oppningsfrekvens,
    perPlatform, platformResponseRates, perMonth, perWeek, funnel,
    sponsorTotal, sponsorSkickat, sponsorSvarat,
    influencerTotal: total, influencerSkickat: skickat,
  });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Influencer ranking
router.get('/ranking', async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT i.id, i.namn, i.kanalnamn, i.plattform, i.foljare, i.referral_kod,
             COALESCE(s.antal_signups, 0) as antal_signups,
             COUNT(om.id) as total_outreach,
             SUM(CASE WHEN om.status = 'avtal_signerat' THEN 1 ELSE 0 END) as avtal,
             SUM(CASE WHEN om.status IN ('svarat','avtal_signerat') THEN 1 ELSE 0 END) as svar
      FROM influencers i
      LEFT JOIN influencer_signups s ON i.id = s.influencer_id
      LEFT JOIN outreach_meddelanden om ON i.id = om.influencer_id AND om.status != 'utkast'
      GROUP BY i.id, i.namn, i.kanalnamn, i.plattform, i.foljare, i.referral_kod, s.antal_signups
      HAVING COUNT(om.id) > 0
      ORDER BY COALESCE(s.antal_signups, 0) DESC, SUM(CASE WHEN om.status = 'avtal_signerat' THEN 1 ELSE 0 END) DESC, SUM(CASE WHEN om.status IN ('svarat','avtal_signerat') THEN 1 ELSE 0 END) DESC
    `);

    const ranked = rows.map((r, idx) => ({
      ...r,
      rank: idx + 1,
      konverteringsrate: r.total_outreach > 0 ? parseFloat(((r.avtal / r.total_outreach) * 100).toFixed(1)) : 0,
    }));

    res.json(ranked);
  } catch (error) {
    console.error('Dashboard ranking error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update influencer signups manually
router.post('/ranking/:influencerId/signups', async (req, res) => {
  const { antal } = req.body;
  const existing = await queryOne('SELECT * FROM influencer_signups WHERE influencer_id = ?', [Number(req.params.influencerId)]);
  if (existing) {
    await runSql("UPDATE influencer_signups SET antal_signups = ?, senast_uppdaterad = datetime('now') WHERE influencer_id = ?",
      [antal, Number(req.params.influencerId)]);
  } else {
    await runSql('INSERT INTO influencer_signups (influencer_id, referral_kod, antal_signups) VALUES (?, (SELECT referral_kod FROM influencers WHERE id = ?), ?)',
      [Number(req.params.influencerId), Number(req.params.influencerId), antal]);
  }
  res.json({ success: true });
});

router.get('/followups', async (req, res) => {
  try {
    const rows = await queryAll(`
      SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, f.namn as foretag_namn
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      JOIN foretag f ON om.foretag_id = f.id
      WHERE om.status = 'skickat'
        AND om.skickat_datum IS NOT NULL
        AND julianday('now') - julianday(om.skickat_datum) >= 5
        AND COALESCE(om.dismissed_followup, 0) = 0
      ORDER BY om.skickat_datum ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Dashboard followups error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Dismiss follow-up (hide from list without changing status)
router.post('/followups/:id/dismiss', async (req, res) => {
  try {
    // Add column if not exists (safe migration)
    try { await runSql('ALTER TABLE outreach_meddelanden ADD COLUMN dismissed_followup INTEGER DEFAULT 0'); } catch (e) {}
    await runSql('UPDATE outreach_meddelanden SET dismissed_followup = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Basic AI analysis
router.post('/analyze', async (req, res) => {
  try {
    const total = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'"))?.count || 0;
    const svarat = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'"))?.count || 0;
    const avtal = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'"))?.count || 0;
    const avbojt = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'"))?.count || 0;
    const svarsfrekvens = total > 0 ? ((svarat + avtal + avbojt) / total * 100).toFixed(1) : 0;

    const analysis = await analyzeConversion({ total, svarat, avtal, avbojt, svarsfrekvens });
    res.json({ analysis });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Deep AI analysis with full data
router.post('/deep-analyze', async (req, res) => {
  try {
    const total = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'"))?.count || 0;
    const svarat = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'"))?.count || 0;
    const avtal = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'"))?.count || 0;
    const avbojt = (await queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'"))?.count || 0;
    const svarsfrekvens = total > 0 ? ((svarat + avtal + avbojt) / total * 100).toFixed(1) : 0;

    const totalTracked = (await queryOne('SELECT COUNT(*) as count FROM email_tracking'))?.count || 0;
    const totalOpened = (await queryOne('SELECT COUNT(*) as count FROM email_tracking WHERE oppnad = 1'))?.count || 0;
    const oppningsfrekvens = totalTracked > 0 ? ((totalOpened / totalTracked) * 100).toFixed(1) : 0;

    const perPlatform = await queryAll(`
      SELECT i.plattform, COUNT(*) as count,
        SUM(CASE WHEN om.status IN ('svarat','avtal_signerat') THEN 1 ELSE 0 END) as svar
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.status != 'utkast'
      GROUP BY i.plattform
    `);

    const topInfluencers = await queryAll(`
      SELECT i.namn, i.plattform, COALESCE(s.antal_signups, 0) as antal_signups
      FROM influencers i
      LEFT JOIN influencer_signups s ON i.id = s.influencer_id
      WHERE s.antal_signups > 0
      ORDER BY s.antal_signups DESC
      LIMIT 10
    `);

    const analysis = await deepAnalyzeOutreach({
      total, svarat, avtal, avbojt, svarsfrekvens,
      oppnade: totalOpened, oppningsfrekvens,
      perPlatform, topInfluencers,
    });

    res.json({ analysis });
  } catch (error) {
    console.error('Deep analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/daily-summary — Hämta daglig sammanfattning (för "Idag"-vyn)
router.get('/daily-summary', async (req, res) => {
  try {
    const summary = generateDailySummary();
    res.json(summary);
  } catch (error) {
    console.error('Daily summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/dashboard/daily-summary/send — Skicka daglig sammanfattning via email
router.post('/daily-summary/send', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await sendDailySummary(email);
    res.json(result);
  } catch (error) {
    console.error('Send daily summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
