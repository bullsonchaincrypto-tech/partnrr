import { Router } from 'express';
import { queryAll, queryOne, runSql } from '../db/schema.js';
import { getLockedSearchQueries, NISCH_GROUPS } from '../services/anthropic.js';
import { searchYouTubeChannels } from '../services/youtube.js';
import { findEmailsForChannels } from '../services/email-finder.js';
import { searchSponsors, searchContacts, isApolloConfigured } from '../services/apollo.js';
import { enrichInfluencers, enrichSingleProfile, isApifyConfigured } from '../services/social-enrichment.js';
import { scoreAndRankInfluencers, scoreInfluencer } from '../services/scoring.js';
import { searchInfluencersAI, generateNischKeywords, buildSearchQueries } from '../services/ai-search.js';
import { discoverInfluencers, isApifyConfigured as isApifyDiscoveryConfigured } from '../services/apify-discovery.js';

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
    const { company_profile_id, platforms, filters, exclude_handles } = req.body;

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

    // Steg 0: Hämta nisch-labels — AI-genererade om möjligt, annars statiska
    let nischLabels = getNischLabels(foretag.bransch, foretag.beskrivning);
    try {
      if (foretag.beskrivning) {
        const aiLabels = await generateNischKeywords(foretag.beskrivning, foretag.namn);
        if (aiLabels.length > 0) {
          nischLabels = aiLabels;
          console.log(`[Search] AI-genererade nisch-labels: ${aiLabels.join(', ')}`);
        }
      }
    } catch (err) {
      console.warn(`[Search] AI nisch-generering misslyckades, använder statiska: ${err.message}`);
    }

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
    // FAS 1.5: AI-genererade hashtags + Apify Discovery
    // Steg 0 genererar svenska hashtags → Apify söker med dem
    // ============================================================
    const nonYoutubePlatforms = selectedPlatforms.filter(p => p !== 'youtube');
    let apifyDiscoveryData = { instagram: [], tiktok: [] };
    let aiSearchQueries = null;

    if (nonYoutubePlatforms.length > 0) {
      // Kör Steg 0 tidigt så vi får AI-hashtags till Apify Discovery
      try {
        aiSearchQueries = await buildSearchQueries({
          companyName: foretag.namn,
          beskrivning: foretag.beskrivning,
          nischer: nischLabels,
          platforms: nonYoutubePlatforms,
        });
      } catch (err) {
        console.warn(`[Search] buildSearchQueries misslyckades: ${err.message}`);
      }
    }

    if (nonYoutubePlatforms.length > 0 && isApifyDiscoveryConfigured()) {
      console.log(`[Search] Steg 2: Apify Discovery — söker via AI-genererade hashtags...`);
      try {
        // Använd AI-genererade hashtags (svenska + nisch-specifika)
        const aiHashtags = aiSearchQueries?.discoveryHashtags || [];
        // Fallback: bygg från nisch-labels om AI inte gav hashtags
        const fallbackHashtags = nischLabels.slice(0, 2).map(label =>
          `svensk${label.split(' ')[0].toLowerCase()}`
        );
        const allHashtags = aiHashtags.length > 0
          ? aiHashtags.slice(0, 5)
          : [...new Set(fallbackHashtags)].slice(0, 4);
        console.log(`[Search] Discovery hashtags (${aiHashtags.length > 0 ? 'AI' : 'fallback'}): ${allHashtags.join(', ')}`);

        apifyDiscoveryData = await discoverInfluencers(
          allHashtags,
          nonYoutubePlatforms,
          { maxResultsPerHashtag: 10, timeoutSecs: 120 }
        );
        sources.apify_ig_discovery = apifyDiscoveryData.instagram?.length || 0;
        sources.apify_tt_discovery = apifyDiscoveryData.tiktok?.length || 0;
        console.log(`[Search] Apify Discovery: ${sources.apify_ig_discovery} IG + ${sources.apify_tt_discovery} TT creators`);
      } catch (err) {
        console.error(`[Search] Apify Discovery misslyckades:`, err.message);
        sources.apify_ig_discovery = 0;
        sources.apify_tt_discovery = 0;
      }
    }

    // ============================================================
    // FAS 2: AI-sökning (Steg 1+3) — SerpAPI + Apify → Claude Sonnet
    // Nu med Apify discovery-data inkluderat
    // ============================================================
    const hasNonYoutubeResults = allResults.some(r =>
      ['instagram', 'tiktok'].includes((r.platform || r.plattform || '').toLowerCase())
    );

    if (nonYoutubePlatforms.length > 0 && !hasNonYoutubeResults) {
      console.log(`[Search] Steg 1+3: AI-sökning (SerpAPI + Apify Discovery → Claude)...`);
      try {
        const aiInfluencers = await searchInfluencersAI({
          companyName: foretag.namn,
          industry: foretag.bransch || null,
          beskrivning: foretag.beskrivning || null,
          erbjudande_typ: foretag.erbjudande_typ || null,
          syfte: foretag.syfte || null,
          nischer: nischLabels,
          platforms: nonYoutubePlatforms,
          apifyDiscoveryData,
          excludeHandles: exclude_handles || [],
          prebuiltQueries: aiSearchQueries,
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
    // FAS 3: Merge & deduplicate
    // ============================================================
    allResults = mergeAndDeduplicate(allResults);
    console.log(`[Search] ${allResults.length} unika profiler efter merge`);

    // ============================================================
    // FAS 3.5: Begränsa till max 25 profiler FÖRE enrichment
    // Sortera på ai_score (bäst först) så enrichment bara körs på toppen
    // ============================================================
    const MAX_PROFILES = 25;
    if (allResults.length > MAX_PROFILES) {
      allResults.sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
      console.log(`[Search] Klipper ${allResults.length} → ${MAX_PROFILES} profiler (topp AI-score behålls)`);
      allResults = allResults.slice(0, MAX_PROFILES);
    }

    // ============================================================
    // FAS 4: Apify Enrichment — verifiera followers + bio
    // Körs på allResults som redan är Claudes urval (~30 profiler)
    // ============================================================
    if (isApifyConfigured()) {
      const needsEnrichment = allResults.filter(
        r => !r.verifierad &&
             ['instagram', 'tiktok'].includes((r.platform || r.plattform || '').toLowerCase())
      );
      if (needsEnrichment.length > 0) {
        console.log(`[Search] Enrichar ${needsEnrichment.length} profiler via Apify...`);
        console.log(`[Search] Handles: ${needsEnrichment.map(r => `@${r.handle || r.kanalnamn} (${r.platform})`).join(', ')}`);
        try {
          allResults = await enrichInfluencers(allResults);
          const enriched = allResults.filter(r => r.datakalla?.startsWith('apify_'));
          sources.apify_enriched = enriched.length;
          console.log(`[Search] Apify enrichade ${enriched.length}/${needsEnrichment.length} profiler`);
          enriched.forEach(r => console.log(`[Search]   @${r.handle || r.kanalnamn}: ${r.followers || 0} followers, bio: ${r.bio ? 'JA' : 'NEJ'}`));
        } catch (err) {
          console.error('[Search] Enrichment error:', err.message);
          sources.apify_enriched = 0;
        }
      } else {
        console.log(`[Search] Ingen enrichment behövs`);
      }
    } else {
      console.log(`[Search] ⚠️ APIFY_API_TOKEN ej konfigurerat — profiler enrichas INTE`);
    }

    // ============================================================
    // FAS 4.5: Filtrera bort profiler med helt tom Apify-data
    // Om Apify returnerade undefined på ALLT → profilen kunde inte verifieras
    // ============================================================
    const beforeGarbageFilter = allResults.length;
    allResults = allResults.filter(r => {
      // Gäller bara Apify-discovery-profiler (IG/TT) som enrichats
      const platform = (r.platform || r.plattform || '').toLowerCase();
      if (!['instagram', 'tiktok'].includes(platform)) return true;

      // Om profilen har verifierad data (YouTube API, etc), behåll alltid
      if (r.verifierad) return true;

      // Om Apify enrichade profilen men returnerade ALLT som undefined/null/0
      // → profilen finns inte eller är privat → filtrera bort
      const hasFollowers = r.followers != null && r.followers > 0;
      const hasBio = !!r.bio && r.bio !== 'undefined';
      const hasPosts = (r.posts_count || r.videoCount || 0) > 0;
      const hasName = !!r.full_name || (!!r.name && r.name !== r.handle);

      // Om INGEN av dessa finns → garbage profile
      if (!hasFollowers && !hasBio && !hasPosts && !hasName) {
        console.log(`[Search] ⛔ Filtrerar bort @${r.handle || r.kanalnamn} (${platform}) — all Apify-data undefined`);
        return false;
      }

      return true;
    });
    if (beforeGarbageFilter !== allResults.length) {
      console.log(`[Search] Garbage-filter: ${beforeGarbageFilter} → ${allResults.length} (${beforeGarbageFilter - allResults.length} borttagna)`);
    }

    // ============================================================
    // FAS 5: Scoring pipeline (med riktig followers-data)
    // E-postsökning EFTER scoring — SerpAPI bara på utvalda profiler
    // ============================================================
    console.log(`[Search] Kör scoring-pipeline...`);
    const scored = await scoreAndRankInfluencers(allResults, companyProfile, {
      generateMotivations: true,
      topN: 5,
      nischLabels: nischLabels || [],
    });

    // ============================================================
    // FAS 6: Filtrera bort irrelevanta resultat
    // ============================================================
    const MIN_SCORE = 20;
    let finalResults = scored.filter(r => (r.match_score || 0) >= MIN_SCORE);
    console.log(`[Search] Score-filter: ${scored.length} → ${finalResults.length} (≥${MIN_SCORE}%)`);

    if (finalResults.length === 0 && scored.length > 0) {
      finalResults = scored.slice(0, 30);
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
    // FAS 7: Sök e-post via SerpAPI (BARA på profiler som klarat scoring + filter)
    // ============================================================
    const needEmail = finalResults.filter(r => !r.kontakt_epost);
    if (needEmail.length > 0) {
      console.log(`[Search] Söker e-post för ${needEmail.length}/${finalResults.length} profiler (efter scoring)...`);
      try {
        const emailResults = await findEmailsForChannels(
          needEmail.map(r => ({
            kanalnamn: r.handle || r.kanalnamn,
            namn: r.name || r.namn || '',
            beskrivning: r.bio || r.beskrivning || '',
            kontakt_info: '',
            plattform: r.platform || r.plattform || '',
          })),
          needEmail.length
        );

        let emailsFound = 0;
        for (let i = 0; i < needEmail.length; i++) {
          if (emailResults[i]?.email) {
            const idx = finalResults.findIndex(r => r === needEmail[i]);
            if (idx >= 0) {
              finalResults[idx].kontakt_epost = emailResults[i].email;
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
    // FAS 8: Spara till DB
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
        enrichment_kalla: inf.enrichment_kalla || null,
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
 * POST /api/search/rescore — Re-scora ALLA influencers i en enda Claude-batch
 *
 * Anropas efter "Hitta fler" för att ge konsistenta scores
 * när gamla + nya resultat blandas.
 */
router.post('/rescore', async (req, res) => {
  try {
    const { company_profile_id, influencers: infData } = req.body;

    if (!infData?.length) {
      return res.status(400).json({ error: 'Inga influencers att re-scora' });
    }

    const foretag = await queryOne('SELECT * FROM foretag WHERE id = ?', [Number(company_profile_id)]);
    if (!foretag) return res.status(404).json({ error: 'Företag hittades inte' });

    let companyProfile;
    try {
      companyProfile = foretag.company_profile ? JSON.parse(foretag.company_profile) : {};
    } catch { companyProfile = {}; }

    const nischLabels = companyProfile.nisch_labels || [];

    // Konvertera frontend-data till scoring-format
    const forScoring = infData.map(inf => ({
      name: inf.namn || inf.name,
      handle: (inf.kanalnamn || inf.handle || '').replace(/^@+/, ''),
      platform: inf.plattform || inf.platform || '',
      followers: inf.foljare_exakt || parseInt(inf.foljare) || 0,
      niches: inf.nisch ? inf.nisch.split(',').map(s => s.trim()) : [],
      nisch: inf.nisch || '',
      bio: inf.beskrivning || inf.bio || '',
      datakalla: inf.datakalla || '',
      enrichment_kalla: inf.enrichment_kalla || null,
      kontakt_epost: inf.kontakt_epost || null,
      ai_score: inf.ai_score || null,
      _frontendId: inf.id, // behåll frontend-id för mapping
    }));

    console.log(`[Rescore] Re-scorear ${forScoring.length} influencers för ${foretag.namn}...`);

    const scored = await scoreAndRankInfluencers(forScoring, companyProfile, {
      generateMotivations: true,
      topN: 5,
      nischLabels,
    });

    // Mappa tillbaka scores till frontend-ids
    const scoreMap = scored.map(inf => ({
      id: inf._frontendId,
      match_score: inf.match_score || 0,
      ai_motivation: inf.ai_motivation || null,
    }));

    console.log(`[Rescore] ✅ Klar — ${scoreMap.length} influencers re-scorade`);

    res.json({ scores: scoreMap });
  } catch (error) {
    console.error('[Rescore] Error:', error);
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
    // Bred mappning av nyckelord → söktermer
    const keywordMap = [
      { terms: ['fantasy', 'allsvenskan'], label: 'fantasy fotboll' },
      { terms: ['fotboll', 'soccer', 'football'], label: 'fotboll' },
      { terms: ['sport', 'idrott'], label: 'sport' },
      { terms: ['esport', 'e-sport'], label: 'esport' },
      { terms: ['gaming', 'spel', 'gamer'], label: 'gaming' },
      { terms: ['tävling', 'competition'], label: 'tävling' },
      { terms: ['tips', 'analys'], label: 'tips' },
      // Fitness & hälsa
      { terms: ['fitness', 'träning', 'gym', 'styrketräning', 'workout'], label: 'fitness träning' },
      { terms: ['kost', 'kosttillskott', 'protein', 'supplement'], label: 'kosttillskott fitness' },
      { terms: ['hälsa', 'wellness', 'välmående'], label: 'hälsa wellness' },
      { terms: ['yoga', 'meditation', 'mindfulness'], label: 'yoga wellness' },
      // Mat & dryck
      { terms: ['mat', 'food', 'recept', 'matlagning', 'restaurang'], label: 'mat recept' },
      { terms: ['kaffe', 'te', 'dryck', 'brygg'], label: 'mat dryck' },
      { terms: ['energidryck', 'energy drink'], label: 'energidryck' },
      // Tech & digital & elektronik
      { terms: ['hemelektronik', 'smart hem', 'smarta hem', 'smart home', 'iot', 'hemautomation'], label: 'tech hemelektronik gadgets' },
      { terms: ['elektronik', 'gadget', 'pryl', 'tillbehör', 'hörlurar', 'högtalare', 'smartklocka', 'wearable', 'smart produkt', 'smarta produkt'], label: 'tech elektronik gadgets unboxing' },
      { terms: ['tech', 'teknik', 'teknologi', 'it', 'ai'], label: 'tech teknik' },
      { terms: ['programmering', 'kod', 'utveckling', 'software'], label: 'tech programmering' },
      { terms: ['app', 'saas', 'startup'], label: 'tech startup' },
      // Mode & skönhet
      { terms: ['mode', 'fashion', 'kläder', 'stil'], label: 'mode fashion' },
      { terms: ['skönhet', 'beauty', 'smink', 'hudvård'], label: 'skönhet beauty' },
      // Resor & livsstil
      { terms: ['resa', 'resor', 'travel', 'äventyr'], label: 'resor travel' },
      { terms: ['livsstil', 'lifestyle', 'vlogg'], label: 'livsstil vlogg' },
      // Musik & underhållning
      { terms: ['musik', 'music', 'artist', 'låt'], label: 'musik' },
      { terms: ['humor', 'komedi', 'comedy', 'underhållning'], label: 'humor underhållning' },
      // Finans & ekonomi
      { terms: ['finans', 'ekonomi', 'aktier', 'investering', 'sparande'], label: 'finans ekonomi' },
      { terms: ['krypto', 'crypto', 'bitcoin', 'blockchain'], label: 'krypto finans' },
      // Familj & barn
      { terms: ['familj', 'förälder', 'barn', 'mamma', 'pappa'], label: 'familj förälder' },
      // Djur & husdjur
      { terms: ['djur', 'husdjur', 'hund', 'katt'], label: 'djur husdjur' },
      // Bil & motor
      { terms: ['bil', 'motor', 'fordon', 'bilar'], label: 'bil motor' },
    ];

    const keywords = [];
    for (const mapping of keywordMap) {
      if (mapping.terms.some(term => desc.includes(term))) {
        keywords.push(mapping.label);
      }
    }
    if (keywords.length > 0) return keywords;
  }

  // Om fortfarande inga labels — extrahera substantiv från beskrivningen direkt
  if (labels.length === 0 && beskrivning) {
    // Returnera de mest meningsfulla orden från beskrivningen
    const stopwords = new Set(['vi', 'och', 'i', 'på', 'för', 'med', 'som', 'är', 'ett', 'en', 'av', 'till', 'det', 'att', 'den', 'de', 'har', 'vara', 'vill', 'ska', 'kan', 'inte', 'alla', 'från', 'vår', 'våra', 'sin', 'sina', 'sitt', 'mycket', 'också', 'sedan', 'under', 'efter', 'mellan', 'utan', 'bara', 'när', 'där', 'här', 'eller', 'men', 'om', 'så', 'sig', 'min', 'din', 'unga', 'vuxna', 'samarbeta', 'gör', 'säljer']);
    const words = beskrivning.toLowerCase()
      .replace(/[^a-zåäö\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopwords.has(w));
    if (words.length > 0) return words.slice(0, 4);
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
