import { Router } from 'express';
import { queryAll, queryOne } from '../db/schema.js';

const router = Router();


// ============================================================
// KAMPANJ-ROI ÖVERSIKT
// ============================================================

router.get('/roi/overview', async (req, res) => {
  try {
    // Totala kostnader & intäkter
    const totals = await queryOne(`
      SELECT
        COUNT(DISTINCT k.id) as antal_kontrakt,
        COUNT(DISTINCT k.influencer_id) as antal_influencers,
        SUM(k.videos_delivered) as total_videos,
        SUM(k.total_signups) as total_signups,
        SUM(k.videos_delivered * 300) as total_video_kostnad,
        SUM(k.total_signups * 10) as total_signup_kostnad,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as total_kostnad,
        SUM(k.total_payout_sek) as total_utbetalt
      FROM kontrakt k
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
    `);

    // CPA (Cost Per Acquisition / signup)
    const totalSignups = totals?.total_signups || 0;
    const totalKostnad = totals?.total_kostnad || 0;
    const cpa = totalSignups > 0 ? Math.round(totalKostnad / totalSignups) : 0;

    // Genomsnittlig kostnad per influencer
    const antalInfluencers = totals?.antal_influencers || 0;
    const kostnadPerInfluencer = antalInfluencers > 0 ? Math.round(totalKostnad / antalInfluencers) : 0;

    // Videos per signup (konverteringseffektivitet)
    const totalVideos = totals?.total_videos || 0;
    const signupsPerVideo = totalVideos > 0 ? (totalSignups / totalVideos).toFixed(1) : 0;

    // Konverteringsrate (signups / videos)
    const konverteringsrate = totalVideos > 0
      ? ((totalSignups / totalVideos) * 100).toFixed(1)
      : 0;

    res.json({
      total_kontrakt: totals?.antal_kontrakt || 0,
      total_influencers: antalInfluencers,
      total_videos: totalVideos,
      total_signups: totalSignups,
      total_kostnad: totalKostnad,
      total_video_kostnad: totals?.total_video_kostnad || 0,
      total_signup_kostnad: totals?.total_signup_kostnad || 0,
      total_utbetalt: totals?.total_utbetalt || 0,
      cpa,
      kostnad_per_influencer: kostnadPerInfluencer,
      signups_per_video: Number(signupsPerVideo),
      konverteringsrate: Number(konverteringsrate),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// INFLUENCER ROI-RANKING
// ============================================================

router.get('/roi/ranking', async (req, res) => {
  try {
    const ranking = await queryAll(`
      SELECT
        k.id as kontrakt_id,
        k.influencer_id,
        i.namn as influencer_namn,
        i.kanalnamn,
        i.plattform,
        i.foljare,
        k.videos_delivered,
        k.videos_required,
        k.total_signups,
        k.total_payout_sek,
        (k.videos_delivered * 300) as video_kostnad,
        (k.total_signups * 10) as signup_kostnad,
        (k.videos_delivered * 300 + k.total_signups * 10) as total_kostnad,
        k.status,
        k.activated_at,
        k.expires_at
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
        AND (k.videos_delivered > 0 OR k.total_signups > 0)
      ORDER BY k.total_signups DESC, k.videos_delivered DESC
    `);

    // Beräkna extra metrics per influencer
    const avgSignups = ranking.length > 0
      ? ranking.reduce((sum, r) => sum + (r.total_signups || 0), 0) / ranking.length
      : 0;

    const enriched = ranking.map((r, idx) => {
      const signups = r.total_signups || 0;
      const videos = r.videos_delivered || 0;
      const totalKostnad = r.total_kostnad || 0;

      const cpa = signups > 0 ? Math.round(totalKostnad / signups) : null;
      const signupsPerVideo = videos > 0 ? (signups / videos).toFixed(1) : 0;
      const roi_score = signups > 0 ? (signups / Math.max(videos, 1)).toFixed(2) : 0;
      const vs_average = avgSignups > 0 ? ((signups / avgSignups) * 100).toFixed(0) : 100;

      return {
        ...r,
        rank: idx + 1,
        cpa,
        signups_per_video: Number(signupsPerVideo),
        roi_score: Number(roi_score),
        vs_average: Number(vs_average),
        is_top_performer: signups > avgSignups * 1.5,
        is_underperformer: signups < avgSignups * 0.5 && videos > 0,
      };
    });

    res.json({
      ranking: enriched,
      avg_signups: Math.round(avgSignups),
      avg_cpa: enriched.length > 0
        ? Math.round(enriched.filter(r => r.cpa !== null).reduce((s, r) => s + r.cpa, 0) / enriched.filter(r => r.cpa !== null).length)
        : 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// KAMPANJJÄMFÖRELSE ÖVER TID
// ============================================================

router.get('/roi/timeline', async (req, res) => {
  try {
    // Per månad: hur mycket spenderat, hur många signups
    const monthly = await queryAll(`
      SELECT
        strftime('%Y-%m', k.activated_at) as manad,
        COUNT(DISTINCT k.id) as antal_kontrakt,
        COUNT(DISTINCT k.influencer_id) as antal_influencers,
        SUM(k.videos_delivered) as videos,
        SUM(k.total_signups) as signups,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as kostnad
      FROM kontrakt k
      WHERE k.activated_at IS NOT NULL
        AND k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
      GROUP BY strftime('%Y-%m', k.activated_at)
      ORDER BY manad ASC
    `);

    // Beräkna CPA per månad
    const enriched = monthly.map(m => ({
      ...m,
      cpa: (m.signups || 0) > 0 ? Math.round((m.kostnad || 0) / m.signups) : null,
      signups_per_video: (m.videos || 0) > 0 ? Number(((m.signups || 0) / m.videos).toFixed(1)) : 0,
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// PER-PLATTFORM ROI
// ============================================================

router.get('/roi/by-platform', async (req, res) => {
  try {
    const platforms = await queryAll(`
      SELECT
        i.plattform,
        COUNT(DISTINCT k.id) as antal_kontrakt,
        SUM(k.videos_delivered) as videos,
        SUM(k.total_signups) as signups,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as kostnad
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
        AND (k.videos_delivered > 0 OR k.total_signups > 0)
      GROUP BY i.plattform
      ORDER BY signups DESC
    `);

    const enriched = platforms.map(p => ({
      ...p,
      cpa: (p.signups || 0) > 0 ? Math.round((p.kostnad || 0) / p.signups) : null,
      signups_per_video: (p.videos || 0) > 0 ? Number(((p.signups || 0) / p.videos).toFixed(1)) : 0,
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// LÖNSAMHET / PROFIT — Intäkter vs Kostnader
// ============================================================

router.get('/roi/profitability', async (req, res) => {
  try {
    // Totala kostnader (influencer-kontrakt)
    const costs = await queryOne(`
      SELECT
        COALESCE(SUM(k.videos_delivered * 300), 0) as video_kostnad,
        COALESCE(SUM(k.total_signups * 10), 0) as signup_kostnad,
        COALESCE(SUM(k.videos_delivered * 300 + k.total_signups * 10), 0) as total_kostnad,
        COALESCE(SUM(k.total_payout_sek), 0) as total_utbetalt,
        COUNT(DISTINCT k.id) as antal_kontrakt,
        COUNT(DISTINCT k.influencer_id) as antal_influencers,
        COALESCE(SUM(k.total_signups), 0) as total_signups
      FROM kontrakt k
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
    `);

    // Totala intäkter (sponsor-betalningar)
    const revenue = await queryOne(`
      SELECT
        COALESCE(SUM(CASE WHEN status != 'makulerad' THEN belopp_sek ELSE 0 END), 0) as total_avtalat,
        COALESCE(SUM(CASE WHEN fakturerad = 1 THEN belopp_sek ELSE 0 END), 0) as total_fakturerat,
        COALESCE(SUM(CASE WHEN betald = 1 THEN belopp_sek ELSE 0 END), 0) as total_inbetalt,
        COUNT(DISTINCT CASE WHEN status != 'makulerad' THEN id END) as antal_intakter
    FROM intakter
    `);

    const totalKostnad = costs.total_kostnad || 0;
    const totalInbetalt = revenue.total_inbetalt || 0;
    const totalAvtalat = revenue.total_avtalat || 0;

    // Profit (bekräftad = inbetalt - kostnad, potentiell = avtalat - kostnad)
    const profit_confirmed = totalInbetalt - totalKostnad;
    const profit_potential = totalAvtalat - totalKostnad;
    const margin_pct = totalInbetalt > 0 ? ((profit_confirmed / totalInbetalt) * 100).toFixed(1) : 0;

    // Värde per signup
    const totalSignups = costs.total_signups || 0;
    const value_per_signup = totalSignups > 0 ? Math.round(totalInbetalt / totalSignups) : 0;
    const cpa = totalSignups > 0 ? Math.round(totalKostnad / totalSignups) : 0;
    const ltv_to_cpa = cpa > 0 ? (value_per_signup / cpa).toFixed(1) : 0;

    // Bransch-benchmarks (svenska influencer-marknaden)
    const benchmarks = {
      avg_cpa_gaming: 45,       // SEK per signup, gaming-nisch
      avg_cpa_lifestyle: 80,    // SEK per signup, lifestyle-nisch
      avg_cpa_tech: 60,         // SEK per signup, tech-nisch
      avg_response_rate: 15,    // % svarsfrekvens
      avg_contract_rate: 5,     // % av kontaktade som signerar
      avg_margin: 35,           // % vinstmarginal
    };

    const my_cpa_vs_benchmark = benchmarks.avg_cpa_gaming > 0 && cpa > 0
      ? ((1 - cpa / benchmarks.avg_cpa_gaming) * 100).toFixed(0)
      : 0;

    res.json({
      costs: {
        video_kostnad: costs.video_kostnad,
        signup_kostnad: costs.signup_kostnad,
        total_kostnad: totalKostnad,
        total_utbetalt: costs.total_utbetalt,
        antal_kontrakt: costs.antal_kontrakt,
        antal_influencers: costs.antal_influencers,
        total_signups: totalSignups,
      },
      revenue: {
        total_avtalat: totalAvtalat,
        total_fakturerat: revenue.total_fakturerat,
        total_inbetalt: totalInbetalt,
        antal_intakter: revenue.antal_intakter,
      },
      profitability: {
        profit_confirmed,
        profit_potential,
        margin_pct: Number(margin_pct),
        cpa,
        value_per_signup,
        ltv_to_cpa: Number(ltv_to_cpa),
      },
      benchmarks,
      my_cpa_vs_benchmark: Number(my_cpa_vs_benchmark),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// PROFIT-TREND ÖVER TID (månad för månad)
// ============================================================

router.get('/roi/profit-trend', async (req, res) => {
  try {
    // Kostnader per månad (baserat på kontrakt activated_at)
    const monthlyCosts = await queryAll(`
      SELECT
        strftime('%Y-%m', k.activated_at) as manad,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as kostnad,
        SUM(k.total_signups) as signups,
        COUNT(DISTINCT k.id) as kontrakt
      FROM kontrakt k
      WHERE k.activated_at IS NOT NULL
        AND k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
      GROUP BY strftime('%Y-%m', k.activated_at)
    `);

    // Intäkter per månad (baserat på avtalsdatum)
    const monthlyRevenue = await queryAll(`
      SELECT
        strftime('%Y-%m', avtalsdatum) as manad,
        SUM(belopp_sek) as intakt,
        SUM(CASE WHEN betald = 1 THEN belopp_sek ELSE 0 END) as inbetalt
      FROM intakter
      WHERE status != 'makulerad' AND avtalsdatum IS NOT NULL
      GROUP BY strftime('%Y-%m', avtalsdatum)
    `);

    // Merge månader
    const months = new Set([
      ...monthlyCosts.map(c => c.manad),
      ...monthlyRevenue.map(r => r.manad),
    ]);

    const costMap = Object.fromEntries(monthlyCosts.map(c => [c.manad, c]));
    const revMap = Object.fromEntries(monthlyRevenue.map(r => [r.manad, r]));

    const trend = [...months].sort().map(manad => {
      const c = costMap[manad] || { kostnad: 0, signups: 0, kontrakt: 0 };
      const r = revMap[manad] || { intakt: 0, inbetalt: 0 };
      return {
        manad,
        kostnad: c.kostnad || 0,
        intakt: r.intakt || 0,
        inbetalt: r.inbetalt || 0,
        profit: (r.inbetalt || 0) - (c.kostnad || 0),
        signups: c.signups || 0,
        kontrakt: c.kontrakt || 0,
        cpa: (c.signups || 0) > 0 ? Math.round((c.kostnad || 0) / c.signups) : null,
      };
    });

    res.json(trend);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// INFLUENCER ROI JÄMFÖRELSE (bäst vs sämst)
// ============================================================

router.get('/roi/comparison', async (req, res) => {
  try {
    const all = await queryAll(`
      SELECT
        k.influencer_id, i.namn, i.kanalnamn, i.plattform, i.foljare,
        SUM(k.videos_delivered) as videos,
        SUM(k.total_signups) as signups,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as kostnad,
        COUNT(k.id) as antal_kontrakt
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
        AND (k.videos_delivered > 0 OR k.total_signups > 0)
      GROUP BY k.influencer_id
      ORDER BY signups DESC
    `);

    if (all.length === 0) return res.json({ top: [], bottom: [], avg: {} });

    const avgSignups = all.reduce((s, r) => s + (r.signups || 0), 0) / all.length;
    const avgCPA = all.filter(r => r.signups > 0).length > 0
      ? all.filter(r => r.signups > 0).reduce((s, r) => s + r.kostnad / r.signups, 0) / all.filter(r => r.signups > 0).length
      : 0;
    const avgVideos = all.reduce((s, r) => s + (r.videos || 0), 0) / all.length;

    const enrich = (r) => ({
      ...r,
      cpa: r.signups > 0 ? Math.round(r.kostnad / r.signups) : null,
      signups_per_video: r.videos > 0 ? Number((r.signups / r.videos).toFixed(1)) : 0,
      vs_avg_signups: avgSignups > 0 ? Math.round(((r.signups || 0) / avgSignups) * 100) : 100,
      kostnad_per_video: r.videos > 0 ? Math.round(r.kostnad / r.videos) : 0,
    });

    const top = all.slice(0, 5).map(enrich);
    const bottom = all.length > 5 ? all.slice(-3).map(enrich) : [];

    res.json({
      top,
      bottom,
      avg: {
        signups: Math.round(avgSignups),
        cpa: Math.round(avgCPA),
        videos: Math.round(avgVideos),
      },
      total_influencers: all.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// AI-REKOMMENDATIONER
// ============================================================

router.post('/roi/ai-recommendations', async (req, res) => {
  try {
    // Samla all data
    const ranking = await queryAll(`
      SELECT
        i.namn, i.kanalnamn, i.plattform, i.foljare,
        k.videos_delivered, k.total_signups, k.status,
        k.videos_required,
        (k.videos_delivered * 300 + k.total_signups * 10) as total_kostnad,
        k.expires_at
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
    `);

    const overview = await queryOne(`
      SELECT
        SUM(k.videos_delivered) as total_videos,
        SUM(k.total_signups) as total_signups,
        SUM(k.videos_delivered * 300 + k.total_signups * 10) as total_kostnad,
        AVG(k.total_signups) as avg_signups
      FROM kontrakt k
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
    `);

    const byPlatform = await queryAll(`
      SELECT i.plattform, SUM(k.total_signups) as signups, SUM(k.videos_delivered) as videos,
             COUNT(*) as kontrakt
      FROM kontrakt k
      JOIN influencers i ON k.influencer_id = i.id
      WHERE k.status IN ('aktivt', 'utgånget', 'avslutat', 'signerat')
      GROUP BY i.plattform
    `);

    if (ranking.length === 0) {
      return res.json({ recommendations: 'Ingen data tillgänglig ännu. Skapa och aktivera kontrakt för att få AI-rekommendationer.' });
    }

    // Anropa Claude API
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const prompt = `Du är en expert på influencer-marknadsföring och ROI-analys. Analysera följande kampanjdata för RankLeague och ge konkreta, actionable rekommendationer på svenska.

ÖVERGRIPANDE DATA:
- Totalt spenderat: ${overview.total_kostnad || 0} SEK
- Totala signups: ${overview.total_signups || 0}
- Totala videos: ${overview.total_videos || 0}
- Genomsnittlig CPA: ${(overview.total_signups || 0) > 0 ? Math.round((overview.total_kostnad || 0) / overview.total_signups) : 'N/A'} SEK
- Genomsnittliga signups per influencer: ${Math.round(overview.avg_signups || 0)}

PER PLATTFORM:
${byPlatform.map(p => `- ${p.plattform}: ${p.signups} signups, ${p.videos} videos, ${p.kontrakt} kontrakt`).join('\n')}

PER INFLUENCER:
${ranking.map(r => `- ${r.namn} (@${r.kanalnamn}, ${r.plattform}, ${r.foljare} följare): ${r.videos_delivered}/${r.videos_required} videos, ${r.total_signups} signups, ${r.total_kostnad} SEK, status: ${r.status}${r.expires_at ? ', utgår: ' + r.expires_at.split('T')[0] : ''}`).join('\n')}

Ge 4-6 specifika rekommendationer. Inkludera:
1. Vilka influencers som presterar bäst och bör förlängas
2. Vilka som underpresterar och vad man kan göra
3. Vilken plattform som ger bäst ROI
4. Konkreta förslag på hur CPA kan sänkas
5. Budgetrekommendation för nästa period

Var direkt och specifik — namnge influencers och ge siffror. Skriv på svenska.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const recommendations = message.content[0]?.text || 'Kunde inte generera rekommendationer.';

    res.json({ recommendations });
  } catch (error) {
    console.error('[Analytics] AI recommendations error:', error);
    res.status(500).json({ error: error.message });
  }
});


export default router;
