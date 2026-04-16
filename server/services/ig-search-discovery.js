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

// Kommersiella kategorier = troligen brand, inte creator
const COMMERCIAL_CATEGORIES = new Set([
  // Exakt-matchning (case-insensitive jämförs nedan)
  'shopping & retail', 'retail company', 'product/service',
  'brand', 'company', 'e-commerce website', 'business service',
  'local business', 'restaurant', 'bar', 'hotel', 'grocery store',
  'food & beverage company', 'health/beauty', 'automotive dealership',
  'real estate', 'insurance company', 'bank', 'financial service',
  'clothing store', 'jewelry/watches', 'home decor', 'furniture store',
  'pet store', 'veterinarian', 'pet service',
]);

// Creator-kategorier = bra signal
const CREATOR_CATEGORIES = new Set([
  'personal blog', 'public figure', 'artist', 'content creator',
  'creator', 'digital creator', 'video creator', 'reels creator',
  'reels-kreatör', 'gamer', 'gaming video creator', 'blogger',
  'musician/band', 'comedian', 'writer', 'photographer',
  'fitness trainer', 'coach', 'entrepreneur', 'editor',
]);

/**
 * Klassificera profil baserat på isBusinessAccount + category.
 * @returns {'creator'|'business'|'personal'|'unknown'}
 */
function classifyAccountType(profile) {
  const isBiz = profile.isBusinessAccount || profile.is_business_account;
  const cat = (profile.businessCategoryName || profile.business_category_name || profile.category || '').toLowerCase().trim();

  if (!isBiz && !cat) return 'personal';
  if (!isBiz) return 'personal';

  // Business/Creator-konto — kolla kategori
  if (COMMERCIAL_CATEGORIES.has(cat)) return 'business';
  if (CREATOR_CATEGORIES.has(cat)) return 'creator';

  // Okänd kategori men har business-konto → troligen creator
  // (de flesta seriösa creators har Business/Creator-konto)
  return 'unknown';
}

/**
 * Sök profiler med ett keyword via Apify Instagram Search.
 */
async function searchKeyword(keyword, metrics) {
  console.log(`[Discovery][IG-Search] Söker "${keyword}" (max ${RESULTS_PER_KEYWORD} profiler)...`);

  try {
    const items = await runApifyActor(
      SEARCH_ACTOR,
      {
        search: keyword,
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
    let skippedCommercial = 0;
    let skippedPersonal = 0;

    // Debug: logga första profilen för att se fältstruktur
    if (items.length > 0) {
      const sample = items[0];
      const keys = Object.keys(sample).join(', ');
      console.log(`[Discovery][IG-Search] "${keyword}" sample keys: ${keys}`);
      console.log(`[Discovery][IG-Search] "${keyword}" sample username fields: username=${sample.username}, login=${sample.login}, pk=${sample.pk}, id=${sample.id}, handle=${sample.handle}`);
    }

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

      const accountType = classifyAccountType(p);

      // Filtrera bort kommersiella brands
      if (accountType === 'business') {
        skippedCommercial++;
        continue;
      }

      // Behåll alla andra (creator, unknown, personal)
      const cat = (p.businessCategoryName || p.business_category_name || p.category || '');

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
        account_type: accountType,
        _already_enriched: true, // Vi har redan all profildata
        _search_appearances: 1,
      });
    }

    console.log(`[Discovery][IG-Search] "${keyword}": ${candidates.length} kept, skipped: ${skippedPrivate} private, ${skippedCommercial} commercial, ${skippedPersonal} personal`);

    if (metrics) {
      metrics.search_total_returned = (metrics.search_total_returned || 0) + items.length;
      metrics.search_skipped_private = (metrics.search_skipped_private || 0) + skippedPrivate;
      metrics.search_skipped_commercial = (metrics.search_skipped_commercial || 0) + skippedCommercial;
    }

    return candidates;
  } catch (err) {
    console.error(`[Discovery][IG-Search] "${keyword}" failed: ${err.message}`);
    return [];
  }
}

/**
 * Gör serper_keywords (optimerade för Google-dork) IG-sök-vänliga.
 * Instagram user search matchar på username + name + bio — korta, enkla termer fungerar bäst.
 *
 * "pälsvård hemma" → ["pälsvård"]
 * "hundgrooming tips" → ["hundgrooming"]
 * "katt grooming" → ["katt grooming", "kattgrooming"]
 * "djurvård produkter" → ["djurvård"]
 */
function simplifyForIGSearch(keywords) {
  // Filler-ord som inte hjälper i IG-sök
  const FILLER = new Set([
    'tips', 'hemma', 'bäst', 'bästa', 'bra', 'guide', 'recension',
    'recensioner', 'produkt', 'produkter', 'köp', 'online', 'billig',
    'billiga', 'gratis', 'blogg', 'vlogg', 'kanal', 'konto',
    'inspiration', 'idéer', 'svenska', 'svensk', 'sverige',
  ]);

  const simplified = new Set();
  for (const kw of keywords) {
    const words = kw.trim().split(/\s+/).filter(w => !FILLER.has(w.toLowerCase()));
    if (words.length === 0) {
      // Hela keywordet var filler — behåll ursprungligt första ord
      const first = kw.trim().split(/\s+/)[0];
      if (first) simplified.add(first.toLowerCase());
    } else if (words.length === 1) {
      simplified.add(words[0].toLowerCase());
    } else {
      // Flera kvar: behåll som fras OCH som ihopskrivet
      simplified.add(words.join(' ').toLowerCase());
      simplified.add(words.join('').toLowerCase());
    }
  }
  return [...simplified];
}

/**
 * Kör search-discovery för alla keywords.
 * @param {string[]} keywords - AI-genererade nisch-keywords (serper_keywords)
 * @param {string[]} hashtags - AI-genererade hashtags (hashtag_terms)
 * @param {object} metrics
 * @returns {RawCandidate[]}
 */
export async function discoverIGViaSearch(keywords, hashtags, metrics) {
  // Förbered IG-sök-vänliga keywords
  const fromSerper = simplifyForIGSearch(keywords || []);
  const fromHashtags = (hashtags || []).map(h => h.replace(/^#/, '').toLowerCase());

  // Kombinera, dedup, max 10 sökningar
  const allKeywords = [
    ...new Set([...fromSerper, ...fromHashtags])
  ].slice(0, 10);

  console.log(`[Discovery][IG-Search] Simplified keywords: ${fromSerper.join(', ')}`);
  console.log(`[Discovery][IG-Search] Hashtag keywords: ${fromHashtags.join(', ')}`);

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

  // Sortera: creators först, sen multi-keyword, sen followers
  const sorted = Array.from(allCandidates.values()).sort((a, b) => {
    // 1. Creators > unknown > personal
    const typeOrder = { creator: 0, unknown: 1, personal: 2 };
    const aType = typeOrder[a.account_type] ?? 1;
    const bType = typeOrder[b.account_type] ?? 1;
    if (aType !== bType) return aType - bType;

    // 2. Multi-keyword appearances
    if (b._search_appearances !== a._search_appearances) {
      return b._search_appearances - a._search_appearances;
    }

    // 3. Followers
    return (b.followers || 0) - (a.followers || 0);
  });

  // Logga statistik
  const typeDist = { creator: 0, unknown: 0, personal: 0 };
  for (const c of sorted) typeDist[c.account_type] = (typeDist[c.account_type] || 0) + 1;
  console.log(`[Discovery][IG-Search] Totalt: ${sorted.length} unika profiler`);
  console.log(`[Discovery][IG-Search] Kontotyp: creator=${typeDist.creator}, unknown=${typeDist.unknown}, personal=${typeDist.personal}`);

  if (metrics) {
    metrics.ig_search_queries = allKeywords.length;
    metrics.ig_search_unique_handles = sorted.length;
  }

  return sorted;
}
