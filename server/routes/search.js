import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { getLockedSearchQueries, NISCH_GROUPS } from '../services/anthropic.js';
import { searchYouTubeChannels } from '../services/youtube.js';
import { findEmailsForChannels } from '../services/email-finder.js';
import { searchSponsors, searchContacts, isApolloConfigured } from '../services/apollo.js';
import { enrichInfluencers, enrichSingleProfile, isApifyConfigured } from '../services/social-enrichment.js';
import { scoreAndRankInfluencers, scoreInfluencer } from '../services/scoring.js';
import { searchInfluencersAI } from '../services/ai-search.js';

const router = Router();

/**
 * POST /api/search/influencers — HUVUDENDPOINT
 *
 * Intelligent sökning som kombinerar alla datakällor:
 * 1. Phyllo API (engagement, demografi, fake followers) — primär
 * 2. YouTube Data API (verifierad kanaldata) — komplement
 * 3. SerpAPI (e-postadresser)
 *
 * Resultaten körs sedan genom scoring-pipeline och rankas.
 */
router.post('/influencers', async (req, res) => {
  try {
    const { company_profile_id, platforms, filters } = req.body;

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(company_profile_id)]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    // Hämta company profile (enrichment + brief-svar)
    let companyProfile;
    try {
      companyProfile = foretag.company_profile ? JSON.parse(foretag.company_profile) : {};
    } catch { companyProfile = {}; }

    // Komplettera med foretag-data — beskrivningen är KRITISK för scoring
    companyProfile.namn = foretag.namn;
    companyProfile.bransch = foretag.bransch || foretag.beskrivning || '';
    companyProfile.niches = foretag.bransch || foretag.beskrivning || '';
    companyProfile.beskrivning = foretag.beskrivning || '';

    const selectedPlatforms = platforms || ['youtube'];
    const nischLabels = getNischLabels(foretag.bransch, foretag.beskrivning);

    console.log(`[Search] Söker influencers för ${foretag.namn} på ${selectedPlatforms.join(', ')}`);
    console.log(`[Search] Nischer: ${nischLabels.join(', ')}`);
    console.log(`[Search] Datakällor: YouTube=AKTIV, AI-sökning=AKTIV, Apify=AKTIV, SerpAPI=AKTIV`);

    let allResults = [];
    const sources = {};

    // ============================================================
    // FAS 1: Hämta data från alla källor parallellt
    // ============================================================
    const searchPromises = [];

    for (const platform of selectedPlatforms) {
      // YouTube Data API (alltid för YouTube-specifik data)
      if (platform === 'youtube') {
        searchPromises.push(
          searchYouTube(foretag, nischLabels)
            .then(results => {
              sources.youtube_api = results.length;
              return results;
            })
            .catch(err => {
              console.error('[Search] YouTube error:', err.message);
              sources.youtube_api = 0;
              return [];
            })
        );
      }
    }

    const searchResults = await Promise.all(searchPromises);

    // Samla alla resultat
    for (const results of searchResults) {
      allResults.push(...results);
    }

    // ============================================================
    // FAS 1.5: AI-sökning (fallback för plattformar utan API-resultat)
    // Om Influencers.club + Phyllo inte returnerade något, använd AI web search
    // ============================================================
    const nonYoutubePlatforms = selectedPlatforms.filter(p => p !== 'youtube');
    const hasNonYoutubeResults = allResults.some(r =>
      ['instagram', 'tiktok'].includes((r.platform || r.plattform || '').toLowerCase())
    );

    if (nonYoutubePlatforms.length > 0 && !hasNonYoutubeResults) {
      console.log(`[Search] Inga API-resultat för ${nonYoutubePlatforms.join(', ')} — kör AI-sökning...`);
      try {
        const aiInfluencers = await searchInfluencersAI({
          companyName: foretag.namn,
          industry: foretag.bransch || null,
          beskrivning: foretag.beskrivning || null,
          erbjudande_typ: foretag.erbjudande_typ || null,
          syfte: foretag.syfte || null,
          nischer: nischLabels,
          platforms: nonYoutubePlatforms,
        });
        if (aiInfluencers?.length > 0) {
          // Normalisera AI-resultat till samma format som pipeline
          const normalized = aiInfluencers.map(inf => ({
            name: inf.namn || inf.name,
            handle: (inf.kanalnamn || '').replace(/^@+/, ''),
            platform: (inf.plattform || inf.platform || 'instagram').toLowerCase(),
            followers: inf.foljare || null,
            bio: inf.profil_beskrivning || inf.bio || '',
            kontakt_epost: inf.kontakt_epost || null,
            kontakt_info: inf.kontakt_metod || null,
            nisch: inf.nisch || '',
            datakalla: 'ai_web_search',
            verifierad: false,
            ai_score: inf.ai_score || 50,
            ai_motivation: inf.ai_motivation || '',
            engagement_rate: null,
            avatar_url: null,
            estimated_price_sek: inf.estimerad_kostnad_sek || null,
          }));
          allResults.push(...normalized);
          sources.ai_web_search = normalized.length;
          console.log(`[Search] AI-sökning hittade ${normalized.length} profiler`);
        }
      } catch (aiErr) {
        console.error(`[Search] AI-sökning misslyckades:`, aiErr.message);
        sources.ai_web_search = 0;
        // Om ALLA källor misslyckades, kasta ett tydligare fel
        if (allResults.length === 0) {
          throw new Error(`Sökningen kunde inte hitta influencers. AI-sökning misslyckades: ${aiErr.message}`);
        }
      }
    }

    // ============================================================
    // FAS 2: Merge & deduplicate
    // ============================================================
    allResults = mergeAndDeduplicate(allResults);
    console.log(`[Search] ${allResults.length} unika profiler efter merge`);

    // ============================================================
    // FAS 2.5: Apify Enrichment — verifiera followers + bio
    // AI-hittade profiler (Instagram/TikTok) berikas med riktig data
    // ============================================================
    if (isApifyConfigured()) {
      const needsEnrichment = allResults.filter(
        r => (r.datakalla === 'ai_estimated' || !r.verifierad) &&
             ['instagram', 'tiktok'].includes((r.platform || r.plattform || '').toLowerCase())
      );
      if (needsEnrichment.length > 0) {
        console.log(`[Search] Enrichar ${needsEnrichment.length} profiler via Apify...`);
        try {
          allResults = await enrichInfluencers(allResults);
          sources.apify_enriched = allResults.filter(r => r.datakalla?.startsWith('apify_')).length;
        } catch (err) {
          console.error('[Search] Enrichment error:', err.message);
          sources.apify_enriched = 0;
        }
      }
    }

    // ============================================================
    // FAS 3: Sök e-post (för ALLA profiler utan e-post)
    // ============================================================
    const needEmail = allResults.filter(r => !r.kontakt_epost);
    if (needEmail.length > 0) {
      console.log(`[Search] Söker e-post för ${needEmail.length} profiler (alla plattformar)...`);
      try {
        const emailResults = await findEmailsForChannels(
          needEmail.map(r => ({
            kanalnamn: r.handle || r.kanalnamn,
            namn: r.name || r.namn || '',
            beskrivning: r.bio || r.beskrivning || '',
            kontakt_info: '',
            plattform: r.platform || r.plattform || '',
          })),
          Math.min(needEmail.length, 15)
        );

        let emailsFound = 0;
        for (let i = 0; i < needEmail.length; i++) {
          if (emailResults[i]?.email) {
            const idx = allResults.findIndex(r => r === needEmail[i]);
            if (idx >= 0) {
              allResults[idx].kontakt_epost = emailResults[i].email;
              emailsFound++;
            }
          }
        }
        console.log(`[Search] E-post hittade: ${emailsFound}/${needEmail.length}`);
      } catch (err) {
        console.error('[Search] Email search error:', err.message);
      }
    }

    // ============================================================
    // FAS 4: Scoring pipeline
    // ============================================================
    console.log(`[Search] Kör scoring-pipeline...`);
    const scored = await scoreAndRankInfluencers(allResults, companyProfile, {
      generateMotivations: true,
      topN: 5,
    });

    // ============================================================
    // FAS 5: Filtrera bort irrelevanta resultat (under 70% matchning)
    // ============================================================
    const MIN_SCORE = 20;
    let finalResults = scored.filter(r => (r.match_score || 0) >= MIN_SCORE);
    console.log(`[Search] Score-filter: ${scored.length} → ${finalResults.length} (≥${MIN_SCORE}%)`);

    // Fallback: om inga resultat klarar tröskeln, returnera topp 20 sorterade efter score
    if (finalResults.length === 0 && scored.length > 0) {
      finalResults = scored.slice(0, 20);
      console.log(`[Search] Fallback: returnerar topp ${finalResults.length} resultat utan tröskel`);
    }

    if (filters) {
      if (filters.min_engagement) {
        finalResults = finalResults.filter(r => (r.engagement_rate || 0) >= filters.min_engagement);
      }
      if (filters.max_price) {
        finalResults = finalResults.filter(r => !r.estimated_price_sek || r.estimated_price_sek <= filters.max_price);
      }
      if (filters.has_email) {
        finalResults = finalResults.filter(r => r.kontakt_epost);
      }
      if (filters.min_score) {
        finalResults = finalResults.filter(r => r.match_score >= filters.min_score);
      }
    }

    // ============================================================
    // FAS 6: Spara till DB
    // ============================================================
    await runSql('DELETE FROM influencers WHERE foretag_id = ?', [foretag.id]);

    for (const inf of finalResults) {
      const referralKod = ((inf.handle || inf.kanalnamn || 'UNKNOWN')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      await runSql(
        `INSERT INTO influencers (foretag_id, namn, kanalnamn, plattform, foljare, nisch, kontakt_epost, kontakt_info, referral_kod)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          foretag.id,
          inf.name || inf.namn,
          inf.handle || inf.kanalnamn,
          inf.platform || inf.plattform || 'youtube',
          (inf.followers || inf.foljare_exakt || 0).toString(),
          (inf.niches || []).join(', ') || inf.nisch || '',
          inf.kontakt_epost || null,
          inf.bio || inf.kontakt_info || null,
          referralKod,
        ]
      );
    }

    // Hämta tillbaka med DB-ids
    const saved = await queryAll('SELECT * FROM influencers WHERE foretag_id = ? ORDER BY id ASC', [foretag.id]);

    // Enricha med score-data
    const enriched = saved.map((row, i) => {
      const inf = finalResults[i] || {};
      return {
        ...row,
        foljare_exakt: inf.followers || inf.foljare_exakt || parseInt(row.foljare) || 0,
        match_score: inf.match_score || 0,
        score_details: inf.score_details || null,
        score_breakdown: inf.score_breakdown || null,
        ai_motivation: inf.ai_motivation || null,
        engagement_rate: inf.engagement_rate || null,
        avg_views: inf.avg_views || null,
        estimated_price_sek: inf.estimated_price_sek || null,
        sweden_audience_pct: inf.sweden_audience_pct || null,
        fake_follower_pct: inf.fake_follower_pct || null,
        growth_rate_30d: inf.growth_rate_30d || null,
        audience_demographics: inf.audience_demographics || null,
        thumbnail: inf.avatar_url || inf.thumbnail || null,
        beskrivning: inf.bio || inf.beskrivning || null,
        datakalla: inf.datakalla || 'youtube_api',
        verifierad: inf.verifierad ?? (inf.datakalla === 'youtube_api'),
        videoCount: inf.videoCount || inf.posts_count || 0,
        viewCount: inf.viewCount || 0,
      };
    });

    enriched.sort((a, b) => b.match_score - a.match_score);

    console.log(`[Search] Klar! ${enriched.length} resultat, sources:`, sources);

    res.json({
      results: enriched,
      total: enriched.length,
      sources,
      filters_applied: filters || null,
    });
  } catch (error) {
    console.error('[Search] Error:', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * POST /api/search/influencers/filter — filtrera befintliga resultat
 */
router.post('/influencers/filter', async (req, res) => {
  try {
    const { company_profile_id, min_engagement, max_price, platforms, has_email, min_score } = req.body;

    let sql = 'SELECT * FROM influencers WHERE foretag_id = ?';
    const params = [Number(company_profile_id)];

    if (platforms?.length) {
      sql += ` AND LOWER(plattform) IN (${platforms.map(() => '?').join(',')})`;
      params.push(...platforms.map(p => p.toLowerCase()));
    }

    if (has_email) {
      sql += ' AND kontakt_epost IS NOT NULL AND kontakt_epost != ""';
    }

    sql += ' ORDER BY id ASC';
    const rows = await queryAll(sql, params);

    res.json({ results: rows, total: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * GET /api/search/influencer/:id/profile — detaljerad profil
 */
router.get('/influencer/:id/profile', async (req, res) => {
  try {
    const inf = await queryOne(`
      SELECT i.*, f.namn as foretag_namn, f.bransch, f.company_profile
      FROM influencers i
      JOIN foretag f ON i.foretag_id = f.id
      WHERE i.id = ?
    `, [Number(req.params.id)]);

    if (!inf) return res.status(404).json({ error: 'Influencer hittades inte' });

    // Försök hämta verifierad profildata via Apify (Instagram/TikTok)
    let enrichedProfile = null;
    if (isApifyConfigured() && inf.kanalnamn && ['instagram', 'tiktok'].includes((inf.plattform || '').toLowerCase())) {
      enrichedProfile = await enrichSingleProfile(inf.kanalnamn, inf.plattform);
    }

    // Beräkna score med company profile
    let companyProfile = {};
    try {
      companyProfile = inf.company_profile ? JSON.parse(inf.company_profile) : {};
    } catch { }
    companyProfile.namn = inf.foretag_namn;
    companyProfile.bransch = inf.bransch;

    const scoreData = scoreInfluencer(inf, companyProfile);

    res.json({
      ...inf,
      enriched_data: enrichedProfile,
      score: scoreData,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// SPONSOR-SÖKNING (Apollo.io)
// ============================================================

/**
 * POST /api/search/sponsors — Sök potentiella sponsorer/företag
 */
router.post('/sponsors', async (req, res) => {
  try {
    const { keyword, category, limit, page } = req.body;

    if (!isApolloConfigured()) {
      return res.status(400).json({
        error: 'Apollo.io API ej konfigurerad. Lägg till APOLLO_API_KEY i .env',
        apollo_active: false,
      });
    }

    console.log(`[Search] Sponsor-sökning: keyword="${keyword}", category="${category}"`);

    const result = await searchSponsors({ keyword, category, limit, page });

    res.json({
      ...result,
      apollo_active: true,
    });
  } catch (error) {
    console.error('[Search] Sponsor error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/search/sponsors/contacts — Hitta kontaktpersoner på ett företag
 */
router.post('/sponsors/contacts', async (req, res) => {
  try {
    const { companyName, companyDomain, titles } = req.body;

    if (!isApolloConfigured()) {
      return res.status(400).json({ error: 'Apollo.io API ej konfigurerad' });
    }

    const result = await searchContacts({ companyName, companyDomain, titles });
    res.json(result);
  } catch (error) {
    console.error('[Search] Contact search error:', error);
    res.status(500).json({ error: error.message });
  }
});


// ============================================================
// HELPERS
// ============================================================

/**
 * Sök YouTube via befintlig pipeline
 */
async function searchYouTube(foretag, nischLabels) {
  let searchQueries = getLockedSearchQueries(foretag.bransch);

  // Om bransch saknas, bygg söktermer från nischLabels (som inkluderar beskrivning)
  if (!foretag.bransch && nischLabels.length > 0) {
    searchQueries = nischLabels.flatMap(label => [
      `${label} youtube sverige`,
      `${label} svensk youtuber`,
      `${label} svenska tips`,
    ]);
  }

  const channels = await searchYouTubeChannels(searchQueries, 10);

  return channels
    .filter(ch => ch.foljare_exakt >= 1000)
    .map(ch => ({
      name: ch.namn,
      handle: ch.kanalnamn,
      platform: 'youtube',
      followers: ch.foljare_exakt,
      bio: ch.beskrivning,
      avatar_url: ch.thumbnail,
      nisch: ch.nisch,
      kontakt_epost: ch.kontakt_epost,
      kontakt_info: ch.kontakt_info,
      videoCount: ch.videoCount,
      viewCount: ch.viewCount,
      datakalla: 'youtube_api',
      verifierad: true,
      // YouTube API ger inte engagement/demografi — Phyllo kompletterar
      engagement_rate: null,
      audience_demographics: null,
      estimated_price_sek: null,
    }));
}

/**
 * Hämta nisch-labels från bransch-strängen
 */
function getNischLabels(bransch, beskrivning) {
  const ids = (bransch || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const labels = [];
  for (const group of NISCH_GROUPS) {
    for (const nisch of group.nischer) {
      if (ids.includes(nisch.id)) labels.push(nisch.label);
    }
  }

  // Om inga nisch-labels hittades, extrahera nyckelord från beskrivningen
  if (labels.length === 0 && beskrivning) {
    const desc = beskrivning.toLowerCase();
    // Prioritera specifika termer från beskrivningen
    const keywords = [];
    if (desc.includes('fantasy') || desc.includes('allsvenskan')) keywords.push('fantasy fotboll');
    if (desc.includes('fotboll') || desc.includes('soccer')) keywords.push('fotboll');
    if (desc.includes('sport') || desc.includes('idrott')) keywords.push('sport');
    if (desc.includes('esport') || desc.includes('e-sport')) keywords.push('esport');
    if (desc.includes('gaming') || desc.includes('spel')) keywords.push('gaming');
    if (desc.includes('tävling') || desc.includes('competition')) keywords.push('tävling');
    if (desc.includes('tips') || desc.includes('analys')) keywords.push('tips');
    if (keywords.length > 0) return keywords;
  }

  return labels.length > 0 ? labels : ['gaming'];
}

/**
 * Merge och deduplicate influencers från flera källor
 */
function mergeAndDeduplicate(results) {
  const byHandle = new Map();

  for (const inf of results) {
    const key = `${(inf.handle || inf.kanalnamn || '').toLowerCase()}_${(inf.platform || '').toLowerCase()}`;

    if (!byHandle.has(key)) {
      byHandle.set(key, inf);
    } else {
      // Merge: behåll den med mest data
      const existing = byHandle.get(key);

      // Komplettera med data från andra källor
      existing.kontakt_epost = existing.kontakt_epost || inf.kontakt_epost;
      existing.videoCount = existing.videoCount || inf.videoCount;
      existing.viewCount = existing.viewCount || inf.viewCount;
    }
  }

  return [...byHandle.values()];
}

export default router;
