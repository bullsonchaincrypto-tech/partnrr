// ============================================================
// V9 Pipeline — Fas 2 (IG): Apify Instagram Search Discovery
// ============================================================
// Använder apify/instagram-search-scraper med searchType="user".
// Returnerar profiler med FULL metadata direkt — ingen separat
// enrichment behövs (followers, isBusinessAccount, category, bio).
//
// Strategi:
//   AI-genererade keywords (5 st serper_keywords + 6 hashtags)
//   Varje keyword → 1 Apify-run med searchType="user", resultsLimit=30
//   Filtrera: behåll bara Business/Creator-konton (isBusinessAccount=true)
//   Filtrera bort kommersiella kategorier (Product/Service, Shopping etc)
//
// Toggle: IG_DISCOVERY_MODE=search (default) | hashtag | serper
// Output: RawCandidate[] med handle, namn, bio, followers, kontotyp.

import { runApifyActor } from './social-enrichment.js';

const SEARCH_ACTOR = 'apify/instagram-search-scraper';
const RESULTS_PER_KEYWORD = parseInt(process.env.IG_SEARCH_RESULTS_PER_KW) || 30;
const TIMEOUT_SECS = 120;

/**
 * Parsa Apify-kategori — hanterar "none,product/service"-format.
 * Returnerar rengjord kategori-sträng (utan "none").
 */
function parseCategory(profile) {
  const raw = (profile.businessCategoryName || profile.business_category_name || profile.category || '').toLowerCase().trim();
  if (!raw) return '';
  return raw.split(',').map(c => c.trim()).filter(c => c && c !== 'none').join(', ');
}

/**
 * Sanitize keyword for Apify Instagram Search input.
 * Apify rejects: !?.,:;\-+=*&%$#@/\~^|<>()[]{}\"'`
 */
function sanitizeKeyword(kw) {
  return kw.replace(/[!?.,:;\-+=*&%$#@/\\~^|<>()\[\]{}"'`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sök profiler med ett keyword via Apify Instagram Search.
 */
async function searchKeyword(keyword, metrics) {
  const sanitized = sanitizeKeyword(keyword);
  if (!sanitized || sanitized.length < 2) {
    console.log(`[Discovery][IG-Search] "${keyword}" → sanitized bort, skippar`);
    return [];
  }

  console.log(`[Discovery][IG-Search] Söker "${sanitized}" (max ${RESULTS_PER_KEYWORD} profiler)...`);

  try {
    const items = await runApifyActor(
      SEARCH_ACTOR,
      {
        search: sanitized,
        searchType: 'user',
        resultsLimit: RESULTS_PER_KEYWORD,
      },
      TIMEOUT_SECS
    );

    if (!items || items.length === 0) {
      console.log(`[Discovery][IG-Search] "${keyword}": 0 profiler`);
      return [];
    }

    console.log(`[Discovery][IG-Search] "${keyword}": ${items.length} profiler returnerade`);

    // Mappa till RawCandidate-format
    const candidates = [];
    let skippedPrivate = 0;
    let skippedPersonal = 0;

    for (const p of items) {
      // Robust username extraction — Apify actors varierar i fältnamn
      const handle = (p.username || p.login || p.handle || p.ownerUsername || p.user?.username || '').toLowerCase().replace(/^@/, '');
      if (!handle || handle.length > 30) {
        console.warn(`[Discovery][IG-Search] "${keyword}": skipping item with no parseable username. Keys: ${Object.keys(p).slice(0, 10).join(', ')}`);
        continue;
      }

      // Skippa privata konton
      if (p.isPrivate || p.is_private) {
        skippedPrivate++;
        continue;
      }

      // Filtrera bort personal accounts (isBusinessAccount=false)
      // Riktiga creators har alltid Business eller Creator-konto på Instagram
      const isBiz = p.isBusinessAccount || p.is_business_account;
      if (!isBiz) {
        skippedPersonal++;
        continue;
      }

      // Alla business/creator-konton går vidare — Haiku i Fas 6 avgör brand vs creator
      const cat = parseCategory(p);

      candidates.push({
        handle,
        name: p.fullName || p.full_name || handle,
        platform: 'instagram',
        bio: (p.biography || p.bio || '').slice(0, 1000),
        followers: p.followersCount ?? p.followers ?? null,
        total_reach: p.followersCount ?? p.followers ?? null,
        following_count: p.followsCount ?? p.following ?? null,
        posts_count: p.postsCount ?? p.posts_count ?? null,
        default_language: null,
        external_url: p.externalUrl || p.external_url || p.website || null,
        caption_sample: null,
        engagement_signal: 0,
        is_business_account: p.isBusinessAccount || p.is_business_account || false,
        business_category: cat,
        is_verified: p.isVerified || p.is_verified || false,
        discovery_source: 'search',
        discovery_query: keyword,
        _already_enriched: true, // Vi har redan all profildata
        _search_appearances: 1,
      });
    }

    console.log(`[Discovery][IG-Search] "${keyword}": ${candidates.length} kept, skipped: ${skippedPrivate} private, ${skippedPersonal} personal (no biz account)`);

    if (metrics) {
      metrics.search_total_returned = (metrics.search_total_returned || 0) + items.length;
      metrics.search_skipped_private = (metrics.search_skipped_private || 0) + skippedPrivate;
      metrics.search_skipped_personal = (metrics.search_skipped_personal || 0) + skippedPersonal;
    }

    return candidates;
  } catch (err) {
    console.error(`[Discovery][IG-Search] "${keyword}" failed: ${err.message}`);
    return [];
  }
}

// Filler-ord som inte hjälper i IG user search
const FILLER = new Set([
  'tips', 'hemma', 'bäst', 'bästa', 'bra', 'guide', 'recension',
  'recensioner', 'produkt', 'produkter', 'köp', 'online', 'billig',
  'billiga', 'gratis', 'blogg', 'vlogg', 'kanal', 'konto',
  'inspiration', 'idéer', 'svenska', 'svensk', 'sverige',
  // Prepositioner/fyllnadsord
  'på', 'för', 'med', 'och', 'till', 'från', 'hos', 'som', 'att',
  'ett', 'en', 'den', 'det', 'av', 'vid', 'inom', 'mot', 'utan',
  // Creator-ord (bra för video-sök men inte user-sök)
  'influencer', 'youtuber', 'tiktokare', 'bloggare', 'creator',
  'recenserar', 'tipsar', 'berättar', 'visar', 'skapar',
]);

/**
 * Gör serper_keywords IG-sök-vänliga.
 * IG user search matchar username + name + bio — korta termer fungerar bäst.
 * VIKTIGT: Genererar INTE ihopskrivna varianter — de returnerar Apify-errors.
 *
 * "pälsvård hemma" → ["pälsvård"]
 * "hundgrooming tips" → ["hundgrooming"]
 * "katt grooming" → ["katt grooming"]
 * "djurvård produkter" → ["djurvård"]
 */
function simplifyKeywords(keywords) {
  const simplified = new Set();
  for (const kw of keywords) {
    const words = kw.trim().split(/\s+/).filter(w => !FILLER.has(w.toLowerCase()));
    if (words.length === 0) {
      // Hela keywordet var filler — behåll första icke-filler-liknande ord
      const first = kw.trim().split(/\s+/)[0];
      if (first) simplified.add(first.toLowerCase());
    } else if (words.length <= 2) {
      // 1-2 ord kvar → behåll som fras (INTE ihopskrivet)
      simplified.add(words.join(' ').toLowerCase());
    } else {
      // 3+ ord → ta första 2 ord
      simplified.add(words.slice(0, 2).join(' ').toLowerCase());
    }
  }
  return [...simplified];
}

/**
 * Gör ig_terms (optimerade för video-sök) IG user-search-vänliga.
 * ig_terms har format "pälsvård katt influencer Sverige" — vi extraherar nisch-kärnan.
 */
function simplifyIGTerms(igTerms) {
  const simplified = new Set();
  for (const term of igTerms) {
    const words = term.trim().split(/\s+/).filter(w => !FILLER.has(w.toLowerCase()));
    if (words.length === 0) continue;
    if (words.length === 1) {
      simplified.add(words[0].toLowerCase());
    } else {
      // Ta max 2 kärnord
      simplified.add(words.slice(0, 2).join(' ').toLowerCase());
    }
  }
  return [...simplified];
}

/**
 * Simplifierar hashtag_terms för IG user search.
 * Hashtags som "pälsvårdsverige" → "pälsvård" (ta bort "sverige"-suffix)
 * "hundgrooming" → "hundgrooming" (behåll)
 * "svenskapälsälskare" → skippas (för specifikt)
 */
function simplifyHashtags(hashtags) {
  const simplified = new Set();
  for (let h of hashtags) {
    h = h.replace(/^#/, '').toLowerCase();
    // Ta bort vanliga suffix som inte hjälper i user search
    // "smarthemverige" → "smarthem", "groomingsverige" → "grooming"
    h = h.replace(/s?verige$/, '').replace(/swedish$/, '').replace(/svenska?$/, '');
    if (h.length >= 3 && h.length <= 25) {
      simplified.add(h);
    }
  }
  return [...simplified];
}

/**
 * Kör search-discovery för alla keywords.
 * @param {string[]} keywords - AI-genererade nisch-keywords (serper_keywords)
 * @param {string[]} hashtags - AI-genererade hashtags (hashtag_terms)
 * @param {string[]} igTerms - AI-genererade IG video-termer (ig_terms)
 * @param {object} metrics
 * @returns {RawCandidate[]}
 */
export async function discoverIGViaSearch(keywords, hashtags, igTerms, metrics) {
  // Förbered IG-sök-vänliga keywords från alla tre källor
  const fromSerper = simplifyKeywords(keywords || []);
  const fromHashtags = simplifyHashtags(hashtags || []);
  const fromIGTerms = simplifyIGTerms(igTerms || []);

  // Kombinera, dedup, max 12 sökningar
  const allKeywords = [
    ...new Set([...fromSerper, ...fromHashtags, ...fromIGTerms])
  ].slice(0, 12);

  console.log(`[Discovery][IG-Search] From serper (${fromSerper.length}): ${fromSerper.join(', ')}`);
  console.log(`[Discovery][IG-Search] From hashtags (${fromHashtags.length}): ${fromHashtags.join(', ')}`);
  console.log(`[Discovery][IG-Search] From ig_terms (${fromIGTerms.length}): ${fromIGTerms.join(', ')}`);

  if (allKeywords.length === 0) {
    console.warn('[Discovery][IG-Search] Inga keywords — returnerar tomt');
    return [];
  }

  console.log(`[Discovery][IG-Search] ${allKeywords.length} keywords: ${allKeywords.join(', ')}`);
  console.log(`[Discovery][IG-Search] ${allKeywords.length} × ${RESULTS_PER_KEYWORD} = max ${allKeywords.length * RESULTS_PER_KEYWORD} profiler`);

  // Kör 2 sökningar parallellt
  const PARALLEL = 2;
  const allCandidates = new Map();

  for (let i = 0; i < allKeywords.length; i += PARALLEL) {
    const batch = allKeywords.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(kw => searchKeyword(kw, metrics))
    );

    for (const candidates of results) {
      for (const c of candidates) {
        if (allCandidates.has(c.handle)) {
          // Merge — profil hittad via flera sökningar
          const existing = allCandidates.get(c.handle);
          existing._search_appearances++;
          // Behåll bästa bio
          if (c.bio && c.bio.length > (existing.bio || '').length) {
            existing.bio = c.bio;
          }
        } else {
          allCandidates.set(c.handle, c);
        }
      }
    }

    // Paus mellan batches
    if (i + PARALLEL < allKeywords.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Sortera: multi-keyword appearances först, sen followers
  const sorted = Array.from(allCandidates.values()).sort((a, b) => {
    // 1. Multi-keyword appearances
    if (b._search_appearances !== a._search_appearances) {
      return b._search_appearances - a._search_appearances;
    }
    // 2. Followers
    return (b.followers || 0) - (a.followers || 0);
  });

  // Logga statistik
  const withCat = sorted.filter(c => c.business_category).length;
  console.log(`[Discovery][IG-Search] Totalt: ${sorted.length} unika profiler (${withCat} med kategori)`);

  if (metrics) {
    metrics.ig_search_queries = allKeywords.length;
    metrics.ig_search_unique_handles = sorted.length;
  }

  return sorted;
}
