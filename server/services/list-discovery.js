// ============================================================
// V9 Pipeline — Fas 2.8: List Discovery (Serper Google search)
// ============================================================
// Söker efter publicerade listor som "topp X svenska Y-creators" på Google,
// extraherar kanal/handle-mentions från resultat-snippets och sidor.
// Dessa kandidater får discovery_source='list' (med -3 obscurity-malus i Fas 7
// eftersom de redan är publicerade).
//
// Trigger: USE_LIST_DISCOVERY=true
// Cache: 14 dagar via list_discovery_cache.

import crypto from 'node:crypto';
import { serperSearch } from './serper.js';
import { runSql, queryOne } from '../db/schema.js';

const HANDLE_RE = /(?:instagram\.com|tiktok\.com|youtube\.com)\/(?:@?)([a-zA-Z0-9._-]{3,30})/g;

function queryHash(query) {
  return crypto.createHash('sha256').update(query).digest('hex').slice(0, 16);
}

async function getCachedListDiscovery(query) {
  try {
    const r = await queryOne(
      `SELECT data FROM list_discovery_cache
       WHERE query_hash = $1 AND created_at > NOW() - INTERVAL '14 days'`,
      [queryHash(query)]
    );
    return r?.data || null;
  } catch { return null; }
}

async function setCachedListDiscovery(query, data) {
  try {
    await runSql(
      `INSERT INTO list_discovery_cache (query_hash, data)
       VALUES ($1, $2)
       ON CONFLICT (query_hash) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`,
      [queryHash(query), JSON.stringify(data)]
    );
  } catch (err) {
    console.warn(`[ListDiscovery] cache write failed: ${err.message}`);
  }
}

function extractHandlesFromText(text) {
  const found = [];
  HANDLE_RE.lastIndex = 0;
  let m;
  while ((m = HANDLE_RE.exec(text))) {
    const fullUrl = m[0].toLowerCase();
    const handle = m[1];
    let platform = null;
    if (fullUrl.includes('instagram.com')) platform = 'instagram';
    else if (fullUrl.includes('tiktok.com')) platform = 'tiktok';
    else if (fullUrl.includes('youtube.com')) platform = 'youtube';
    if (platform) found.push({ platform, handle });
  }
  return found;
}

/**
 * Generera Google-queries för list-discovery baserat på brief.primary_niche.
 */
function buildQueries(brief) {
  const niche = brief.primary_niche;
  return [
    `topp svenska ${niche} influencers`,
    `bästa ${niche} youtubers sverige`,
    `svenska ${niche} creators att följa`,
  ];
}

/**
 * @returns {Promise<RawCandidate[]>} - kandidater med discovery_source='list'
 */
export async function discoverFromLists(brief, metrics = {}) {
  if (process.env.USE_LIST_DISCOVERY !== 'true') return [];

  const queries = buildQueries(brief);
  const allHandles = new Map();  // key = "platform:handle" → metadata

  for (const q of queries) {
    let results = await getCachedListDiscovery(q);
    if (!results) {
      try {
        const serp = await serperSearch(q, { gl: 'se', hl: 'sv', num: 10 });
        const allText = (serp.organic || []).map(r =>
          `${r.title || ''} ${r.snippet || ''} ${r.link || ''}`
        ).join('\n');
        results = extractHandlesFromText(allText);
        await setCachedListDiscovery(q, results);
      } catch (err) {
        console.warn(`[ListDiscovery] Serper "${q}" → ${err.message}`);
        results = [];
      }
    }
    for (const { platform, handle } of results) {
      const key = `${platform}:${handle.toLowerCase()}`;
      if (!allHandles.has(key)) {
        allHandles.set(key, { platform, handle, discovered_via: q });
      }
    }
  }

  const candidates = [...allHandles.values()].map(({ platform, handle, discovered_via }) => ({
    platform,
    handle,
    name: handle,
    bio: '',
    followers: null,
    country: null,
    default_language: null,
    external_url: null,
    caption_sample: null,
    engagement_signal: 0,
    is_business_account: null,
    business_category: null,
    is_verified: false,
    discovery_source: 'list',
    discovery_query: discovered_via,
    raw: {},
    comment_depth: 0,
  }));

  metrics.list_discovery_handles_found = candidates.length;
  console.log(`[ListDiscovery] ${candidates.length} unika handles från ${queries.length} queries`);
  return candidates;
}

export const __test__ = { extractHandlesFromText, buildQueries, queryHash };
