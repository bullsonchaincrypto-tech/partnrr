// ============================================================
// V9 Pipeline — Fas 2 (IG): Serper.dev Google-dork Discovery
// ============================================================
// Ersätter ScrapeCreators reel-search för Instagram-discovery.
// Använder site:instagram.com Google-dorks via Serper.dev.
//
// Strategi:
//   5 AI-genererade keywords × 5 städer = 25 queries
//   5 keywords × "Sverige"              =  5 queries
//   5 keywords × "Sweden"               =  5 queries
//   Totalt: 35 queries à 1 Serper-credit = $0.069
//
// Output: RawCandidate[] med handle, namn (från title), bio (snippet).
// Profil-berikining sker i Fas 4.5 / Fas 6 via SC getIgProfile.

import { serperSearch } from './serper.js';

const TOP_5_CITIES = ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Linköping'];
const GEO_VARIANTS = ['Sverige', 'Sweden'];
const DORK_EXCLUDES = '-inurl:/p/ -inurl:/reel -inurl:/channel -inurl:/explore';

// Paths som INTE är profil-URLs
const NON_PROFILE_SLUGS = new Set([
  'p', 'reel', 'reels', 'explore', 'stories', 'channel', 'accounts',
  'directory', 'about', 'developer', 'legal', 'tv', 'tags', 'locations',
  'nametag', 'emails', 'press', 'api', 'static', 'web', 'lite',
]);

// ============================================================
// === QUERY BUILDER ===========================================
// ============================================================

export function buildDorkQueries(keywords) {
  const queries = [];
  for (const kw of keywords) {
    // 5 keywords × 5 cities = 25
    for (const city of TOP_5_CITIES) {
      queries.push(`"${kw}" "${city}" ${DORK_EXCLUDES} site:instagram.com`);
    }
    // 5 keywords × "Sverige" + "Sweden" = 10
    for (const geo of GEO_VARIANTS) {
      queries.push(`"${kw}" "${geo}" ${DORK_EXCLUDES} site:instagram.com`);
    }
  }
  return queries;
}

// ============================================================
// === HANDLE PARSER ===========================================
// ============================================================

/**
 * Extraherar Instagram-handle från en URL.
 * Returnerar null om URL:en inte är en profil-sida.
 */
export function extractHandleFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.includes('instagram.com')) return null;
    // pathname: /username/ eller /username
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null; // /p/xxx, /reel/xxx etc har >1 segment
    const handle = parts[0].toLowerCase();
    if (NON_PROFILE_SLUGS.has(handle)) return null;
    // Validera handle-format (bokstäver, siffror, punkter, understreck)
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null;
    return handle;
  } catch {
    return null;
  }
}

/**
 * Extrahera namn från Serper-title. IG-profiler har ofta:
 *   "Name (@handle) • Instagram photos and videos"
 *   "Name on Instagram: ..."
 */
function parseNameFromTitle(title, handle) {
  if (!title) return handle;
  // "Name (@handle) • ..."
  let m = title.match(/^([^(@]+)/);
  if (m) {
    const name = m[1].replace(/[\s•\-|]+$/, '').trim();
    if (name.length >= 2 && name.length <= 60) return name;
  }
  return handle;
}

// ============================================================
// === DISCOVERY ENTRY POINT ===================================
// ============================================================

const BATCH_SIZE = 5; // Parallella Serper-anrop per batch

/**
 * @param {string[]} keywords - 5 AI-genererade nisch-keywords
 * @param {object} metrics - mutable metrics-bag
 * @returns {Promise<RawCandidate[]>}
 */
export async function discoverIGViaSerper(keywords, metrics = {}) {
  if (!keywords || keywords.length === 0) {
    console.warn('[Discovery][IG-Serper] Inga keywords — skippar');
    return [];
  }

  const queries = buildDorkQueries(keywords);
  console.log(`[Discovery][IG-Serper] ${queries.length} queries (${keywords.length} keywords × ${TOP_5_CITIES.length + GEO_VARIANTS.length} geo-varianter)`);
  for (const kw of keywords) console.log(`[Discovery][IG-Serper]   keyword: "${kw}"`);

  const handleMap = new Map();
  let totalOrganic = 0;
  let failedQueries = 0;

  // Kör i batches om 5 parallellt
  for (let i = 0; i < queries.length; i += BATCH_SIZE) {
    const batch = queries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (q, batchIdx) => {
      const qIdx = i + batchIdx + 1;
      try {
        const data = await serperSearch(q, {
          gl: 'se',
          hl: 'sv',
          num: 10,
          tbs: 'qdr:m', // Senaste månaden
        });
        const organic = data.organic || [];
        console.log(`[Discovery][IG-Serper] Q${qIdx}/${queries.length}: ${organic.length} results`);
        return organic;
      } catch (err) {
        console.warn(`[Discovery][IG-Serper] Q${qIdx}/${queries.length} FAIL: ${err.message}`);
        failedQueries++;
        return [];
      }
    }));

    for (const organic of results) {
      for (const item of organic) {
        totalOrganic++;
        const handle = extractHandleFromUrl(item.link);
        if (!handle) continue;

        if (!handleMap.has(handle)) {
          handleMap.set(handle, {
            platform: 'instagram',
            handle,
            name: parseNameFromTitle(item.title, handle),
            bio: (item.snippet || '').slice(0, 1000),
            followers: null,
            country: null,
            default_language: null,
            external_url: null,
            caption_sample: item.snippet || null,
            engagement_signal: 0,
            is_business_account: null,
            business_category: null,
            is_verified: false,
            discovery_source: 'serper_ig',
            discovery_query: keywords.join(', '),
            raw: item,
            comment_depth: 0,
            _serper_appearances: 1,
            _serper_titles: [item.title || ''],
          });
        } else {
          const existing = handleMap.get(handle);
          existing._serper_appearances++;
          if (item.title) existing._serper_titles.push(item.title);
          // Uppdatera bio om vi hittar en längre snippet
          if ((item.snippet || '').length > (existing.bio || '').length) {
            existing.bio = (item.snippet || '').slice(0, 1000);
            existing.caption_sample = item.snippet;
          }
        }
      }
    }
  }

  // Sortera: fler appearances = mer relevant (dyker upp i fler sökningar)
  const candidates = [...handleMap.values()]
    .sort((a, b) => (b._serper_appearances || 0) - (a._serper_appearances || 0));

  // Logga top 5 för diagnos
  for (const c of candidates.slice(0, 5)) {
    console.log(`[Discovery][IG-Serper]   @${c.handle} (${c._serper_appearances} träffar): "${c.name}" — "${(c.bio || '').slice(0, 80)}"`);
  }

  metrics.serper_ig_queries = queries.length;
  metrics.serper_ig_total_organic = totalOrganic;
  metrics.serper_ig_unique_handles = candidates.length;
  metrics.serper_ig_failed_queries = failedQueries;
  // Räkna Serper API-anrop (för metrics-tabellen)
  metrics.serper_calls = (metrics.serper_calls || 0) + queries.length;

  console.log(`[Discovery][IG-Serper] Klart: ${candidates.length} unika handles från ${totalOrganic} organiska resultat (${failedQueries} misslyckade queries, ${queries.length} credits)`);
  return candidates;
}

export const __test__ = { buildDorkQueries, extractHandleFromUrl, parseNameFromTitle };
