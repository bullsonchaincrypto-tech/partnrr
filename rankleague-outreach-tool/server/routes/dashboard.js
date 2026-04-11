import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { analyzeConversion, deepAnalyzeOutreach } from '../services/anthropic.js';

const router = Router();

router.get('/stats', (req, res) => {
  const total = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'")?.count || 0;
  const skickat = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'skickat'")?.count || 0;
  const svarat = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'")?.count || 0;
  const avtal = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'")?.count || 0;
  const avbojt = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'")?.count || 0;
  const misslyckat = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'misslyckat'")?.count || 0;
  const kontraktCount = queryOne("SELECT COUNT(*) as count FROM kontrakt")?.count || 0;
  const svarsfrekvens = total > 0 ? parseFloat(((svarat + avtal + avbojt) / total * 100).toFixed(1)) : 0;

  // Email tracking stats
  const totalTracked = queryOne('SELECT COUNT(*) as count FROM email_tracking')?.count || 0;
  const totalOpened = queryOne('SELECT COUNT(*) as count FROM email_tracking WHERE oppnad = 1')?.count || 0;
  const oppningsfrekvens = totalTracked > 0 ? parseFloat(((totalOpened / totalTracked) * 100).toFixed(1)) : 0;

  const perPlatform = queryAll(`
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

  const perMonth = queryAll(`
    SELECT strftime('%Y-%m', skickat_datum) as manad, COUNT(*) as count
    FROM outreach_meddelanden
    WHERE skickat_datum IS NOT NULL
    GROUP BY manad
    ORDER BY manad DESC
    LIMIT 12
  `);

  // Per week stats
  const perWeek = queryAll(`
    SELECT strftime('%Y-W%W', skickat_datum) as vecka, COUNT(*) as count
    FROM outreach_meddelanden
    WHERE skickat_datum IS NOT NULL
    GROUP BY vecka
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
  const sponsorTotal = queryOne("SELECT COUNT(*) as count FROM sponsor_outreach WHERE status != 'utkast'")?.count || 0;
  const sponsorSkickat = queryOne("SELECT COUNT(*) as count FROM sponsor_outreach WHERE status = 'skickat'")?.count || 0;

  res.json({
    total, skickat, svarat, avtal, avbojt, misslyckat, kontraktCount, svarsfrekvens,
    totalTracked, totalOpened, oppningsfrekvens,
    perPlatform, platformResponseRates, perMonth, perWeek, funnel,
    sponsorTotal, sponsorSkickat,
  });
});

// Influencer ranking
router.get('/ranking', (req, res) => {
  const rows = queryAll(`
    SELECT i.id, i.namn, i.kanalnamn, i.plattform, i.foljare, i.referral_kod,
           COALESCE(s.antal_signups, 0) as antal_signups,
           COUNT(om.id) as total_outreach,
           SUM(CASE WHEN om.status = 'avtal_signerat' THEN 1 ELSE 0 END) as avtal,
           SUM(CASE WHEN om.status IN ('svarat','avtal_signerat') THEN 1 ELSE 0 END) as svar
    FROM influencers i
    LEFT JOIN influencer_signups s ON i.id = s.influencer_id
    LEFT JOIN outreach_meddelanden om ON i.id = om.influencer_id AND om.status != 'utkast'
    GROUP BY i.id
    HAVING total_outreach > 0
    ORDER BY antal_signups DESC, avtal DESC, svar DESC
  `);

  const ranked = rows.map((r, idx) => ({
    ...r,
    rank: idx + 1,
    konverteringsrate: r.total_outreach > 0 ? parseFloat(((r.avtal / r.total_outreach) * 100).toFixed(1)) : 0,
  }));

  res.json(ranked);
});

// Update influencer signups manually
router.post('/ranking/:influencerId/signups', (req, res) => {
  const { antal } = req.body;
  const existing = queryOne('SELECT * FROM influencer_signups WHERE influencer_id = ?', [Number(req.params.influencerId)]);
  if (existing) {
    runSql('UPDATE influencer_signups SET antal_signups = ?, senast_uppdaterad = datetime(\'now\') WHERE influencer_id = ?',
      [antal, Number(req.params.influencerId)]);
  } else {
    runSql('INSERT INTO influencer_signups (influencer_id, referral_kod, antal_signups) VALUES (?, (SELECT referral_kod FROM influencers WHERE id = ?), ?)',
      [Number(req.params.influencerId), Number(req.params.influencerId), antal]);
  }
  res.json({ success: true });
});

router.get('/followups', (req, res) => {
  const rows = queryAll(`
    SELECT om.*, i.namn as influencer_namn, i.kanalnamn, i.plattform, i.kontakt_epost, f.namn as foretag_namn
    FROM outreach_meddelanden om
    JOIN influencers i ON om.influencer_id = i.id
    JOIN foretag f ON om.foretag_id = f.id
    WHERE om.status = 'skickat'
      AND om.skickat_datum IS NOT NULL
      AND julianday('now') - julianday(om.skickat_datum) >= 5
    ORDER BY om.skickat_datum ASC
  `);
  res.json(rows);
});

// Basic AI analysis
router.post('/analyze', async (req, res) => {
  try {
    const total = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'")?.count || 0;
    const svarat = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'")?.count || 0;
    const avtal = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'")?.count || 0;
    const avbojt = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'")?.count || 0;
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
    const total = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status != 'utkast'")?.count || 0;
    const svarat = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'svarat'")?.count || 0;
    const avtal = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avtal_signerat'")?.count || 0;
    const avbojt = queryOne("SELECT COUNT(*) as count FROM outreach_meddelanden WHERE status = 'avbojt'")?.count || 0;
    const svarsfrekvens = total > 0 ? ((svarat + avtal + avbojt) / total * 100).toFixed(1) : 0;

    const totalTracked = queryOne('SELECT COUNT(*) as count FROM email_tracking')?.count || 0;
    const totalOpened = queryOne('SELECT COUNT(*) as count FROM email_tracking WHERE oppnad = 1')?.count || 0;
    const oppningsfrekvens = totalTracked > 0 ? ((totalOpened / totalTracked) * 100).toFixed(1) : 0;

    const perPlatform = queryAll(`
      SELECT i.plattform, COUNT(*) as count,
        SUM(CASE WHEN om.status IN ('svarat','avtal_signerat') THEN 1 ELSE 0 END) as svar
      FROM outreach_meddelanden om
      JOIN influencers i ON om.influencer_id = i.id
      WHERE om.status != 'utkast'
      GROUP BY i.plattform
    `);

    const topInfluencers = queryAll(`
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

export default router;
