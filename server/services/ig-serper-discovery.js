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
//   Totalt: 35 queries × 3 pages = 105 credits, num:20 → ~2100 resultat
//
// OBS: num:100 blockeras av Serper för site:-dork queries (400 "Query not allowed").
//      Pagination (page=1,2,3) funkar — varje page kostar 1 credit.
// Budget: ~105 credits per sökning (konfigurerbar via SERPER_PAGES_PER_QUERY env).
// Output: RawCandidate[] med handle, namn (från title), bio (snippet).
// Profil-berikining sker i Fas 6 via Apify.

import { serperSearch } from './serper.js';

const CITIES = ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Linköping'];
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

/**
 * Bygger dork-queries. Returnerar { query, label }[] där label
 * är en läsbar kort-form t.ex. '"teknik" × Malmö'.
 */
export function buildDorkQueries(keywords) {
  const queries = [];
  for (const kw of keywords) {
    for (const city of CITIES) {
      queries.push({
        q: `"${kw}" "${city}" ${DORK_EXCLUDES} site:instagram.com`,
        label: `"${kw}" × ${city}`,
      });
    }
    for (const geo of GEO_VARIANTS) {
      queries.push({
        q: `"${kw}" "${geo}" ${DORK_EXCLUDES} site:instagram.com`,
        label: `"${kw}" × ${geo}`,
      });
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

const BATCH_SIZE = 3; // Parallella Serper-anrop per batch (Serper limit: 5 req/s, keep margin)
const BATCH_DELAY_MS = 1200; // Paus mellan batches för att undvika 429 rate limit
const PAGES_PER_QUERY = parseInt(process.env.SERPER_PAGES_PER_QUERY) || 3; // Sidor per query (1 credit/sida)

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
  const totalCredits = queries.length * PAGES_PER_QUERY;
  console.log(`[Discovery][IG-Serper] ${queries.length} queries × ${PAGES_PER_QUERY} pages = ${totalCredits} credits (${keywords.length} keywords × ${CITIES.length + GEO_VARIANTS.length} geo-varianter)`);
  for (const kw of keywords) console.log(`[Discovery][IG-Serper]   keyword: "${kw}"`);

  const handleMap = new Map();       // handle → candidate
  const queryStats = new Map();      // label → { profiles: Set, totalResults }
  let totalOrganic = 0;
  let failedQueries = 0;

  // Initiera per-query stats
  for (const { label } of queries) queryStats.set(label, { profiles: new Set(), totalResults: 0 });

  // Expandera queries med pages: [{q, label, page}, ...]
  const expandedQueries = [];
  for (const { q, label } of queries) {
    for (let p = 1; p <= PAGES_PER_QUERY; p++) {
      expandedQueries.push({ q, label, page: p });
    }
  }

  // Kör i batches med delay för att undvika 429 rate limit
  for (let i = 0; i < expandedQueries.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    const batch = expandedQueries.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async ({ q, label, page }, batchIdx) => {
      const qIdx = i + batchIdx + 1;
      const pageLabel = PAGES_PER_QUERY > 1 ? ` [p${page}]` : '';
      // Retry-loop för 429 rate limits
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await serperSearch(q, {
            gl: 'se',
            hl: 'sv',
            num: 20,        // num:100/50/30 blockeras av Serper för site:-dorks
            tbs: 'qdr:m',  // Senaste månaden
            page,
          });
          const organic = data.organic || [];
          let profileCount = 0;
          for (const item of organic) {
            const h = extractHandleFromUrl(item.link);
            if (h) profileCount++;
          }
          console.log(`[Discovery][IG-Serper] Q${qIdx}/${expandedQueries.length} ${label}${pageLabel}: ${organic.length} results, ${profileCount} profiler`);
          return { organic, label };
        } catch (err) {
          if (err.message?.includes('429') && attempt < 2) {
            const wait = (attempt + 1) * 2000; // 2s, 4s
            console.warn(`[Discovery][IG-Serper] Q${qIdx} 429 rate limit — retry ${attempt + 1}/2 after ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          console.warn(`[Discovery][IG-Serper] Q${qIdx}/${expandedQueries.length} ${label}${pageLabel} FAIL: ${err.message}`);
          failedQueries++;
          return { organic: [], label };
        }
      }
      // Alla retries misslyckades
      return { organic: [], label };
    }));

    for (const { organic, label } of results) {
      const stats = queryStats.get(label);
      for (const item of organic) {
        totalOrganic++;
        const handle = extractHandleFromUrl(item.link);
        if (!handle) continue;

        // Spåra vilken query som hittade detta handle
        if (stats) {
          stats.totalResults++;
          stats.profiles.add(handle);
        }

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
            discovery_query: label,           // Första query som hittade profilen
            raw: item,
            comment_depth: 0,
            _serper_appearances: 1,
            _serper_queries: [label],          // ALLA queries som hittar denna
            _serper_titles: [item.title || ''],
          });
        } else {
          const existing = handleMap.get(handle);
          existing._serper_appearances++;
          if (!existing._serper_queries.includes(label)) {
            existing._serper_queries.push(label);
          }
          if (item.title) existing._serper_titles.push(item.title);
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

  // ─── PER-QUERY SAMMANFATTNING ───
  console.log(`[Discovery][IG-Serper] ─── Per-query breakdown ───`);
  for (const [label, stats] of queryStats) {
    console.log(`[Discovery][IG-Serper]   ${label}: ${stats.profiles.size} profiler (${stats.totalResults} results)`);
  }

  // Logga top 10 hittade handles med vilka queries som hittade dem
  console.log(`[Discovery][IG-Serper] ─── Top handles ───`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`[Discovery][IG-Serper]   @${c.handle} (×${c._serper_appearances}): "${c.name}" — queries: [${c._serper_queries.join(', ')}]`);
  }

  metrics.serper_ig_queries = expandedQueries.length;
  metrics.serper_ig_total_organic = totalOrganic;
  metrics.serper_ig_unique_handles = candidates.length;
  metrics.serper_ig_failed_queries = failedQueries;
  metrics.serper_calls = (metrics.serper_calls || 0) + expandedQueries.length;

  console.log(`[Discovery][IG-Serper] Klart: ${candidates.length} unika handles från ${totalOrganic} organiska resultat (${failedQueries} misslyckade, ${expandedQueries.length} credits = ${queries.length} queries × ${PAGES_PER_QUERY} pages)`);
  return candidates;
}

export const __test__ = { buildDorkQueries, extractHandleFromUrl, parseNameFromTitle };
