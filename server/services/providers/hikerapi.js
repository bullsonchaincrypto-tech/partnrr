// ============================================================
// V9 Pipeline — HikerAPI provider (FALLBACK för Instagram)
// ============================================================
// Dokumentation: https://hikerapi.com/docs
// Auth: x-access-key header (eller ?access_key= query-param).
// Aktiveras via USE_HIKERAPI_FALLBACK=true (auto-flippas vid SC 5xx-burst).
//
// Output-paritet med providers/scrapecreators.js är KRITISKT — output måste
// matcha RawCandidate-schemat exakt så att resten av pipen är agnostisk.
//
// Notera: Hiker täcker primärt Instagram. TikTok-fallback finns inte i v9.0;
// vid TikTok-failure loggas error och pipen körs utan TT-results.

import { recordProviderEvent } from '../provider-health.js';

const BASE = 'https://api.hikerapi.com';
const TIMEOUT_MS = 15000;
const PROVIDER = 'hikerapi';

function getKey() {
  const k = process.env.HIKERAPI_TOKEN;
  if (!k) throw new Error('[HikerAPI] HIKERAPI_TOKEN saknas');
  return k;
}

async function hikerFetch(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let status = 0;
  let success = false;
  let errMsg = null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-access-key': getKey(),
        'accept': 'application/json',
      },
      signal: ac.signal,
    });
    status = res.status;
    if (!res.ok) {
      errMsg = `HTTP ${res.status}`;
      throw new Error(`[HikerAPI] ${endpoint} → ${res.status}`);
    }
    const data = await res.json();
    success = true;
    return data;
  } catch (err) {
    if (!errMsg) errMsg = err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    recordProviderEvent({
      provider: PROVIDER,
      endpoint,
      status_code: status,
      duration_ms: Date.now() - t0,
      success,
      error_message: errMsg,
    }).catch(() => {});
  }
}

// ============================================================
// === INSTAGRAM ===============================================
// ============================================================

/**
 * IG keyword-search via Hiker. Hiker exponerar inte direkt reels-search;
 * vi använder en vanlig user/hashtag-search istället.
 * Endpoint: GET /v2/search/keyword?query=...
 */
export async function searchReels(term, limit = 30) {
  // TODO: Verifiera Hikers exakta endpoint mot https://hikerapi.com/docs.
  const raw = await hikerFetch('/v2/search/keyword', { query: term });
  const items = (raw?.items || raw?.users || raw?.results || [])
    .slice(0, limit)
    .map(u => normalizeHikerUserToRaw(u, term, 'main'));
  return { items, raw };
}

/**
 * Hikers hashtag-endpoint.
 * Endpoint: GET /v2/hashtag/medias/recent?name=...&amount=...
 */
export async function searchIgHashtag(tag, limit = 20) {
  const cleanTag = String(tag || '').replace(/^#/, '');
  const raw = await hikerFetch('/v2/hashtag/medias/recent', {
    name: cleanTag,
    amount: limit,
  });
  const items = (raw?.medias || raw?.items || []).map(m =>
    normalizeHikerMediaToRaw(m, `#${cleanTag}`)
  );
  return { items, raw };
}

/**
 * Hiker user-profile by username.
 * Endpoint: GET /v2/user/by/username?username=...
 */
export async function getIgProfile(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '');
  const raw = await hikerFetch('/v2/user/by/username', { username: cleanHandle });
  return normalizeHikerProfileResponse(raw);
}

// ============================================================
// === TIKTOK (ej supportat av Hiker) ==========================
// ============================================================

export async function searchTikTokVideo(_term, _limit) {
  throw new Error('[HikerAPI] TikTok ej supportat — fallback krävs primär provider');
}
export async function searchTikTokHashtag(_tag, _limit) {
  throw new Error('[HikerAPI] TikTok ej supportat');
}
export async function getTikTokProfile(_handle) {
  throw new Error('[HikerAPI] TikTok ej supportat');
}

// ============================================================
// === NORMALISERING TILL SC-SCHEMAT ==========================
// ============================================================

export function normalizeHikerUserToRaw(u, query, source = 'main') {
  return {
    platform: 'instagram',
    handle: u?.username || u?.handle || '',
    name: u?.full_name || u?.name || u?.username || '',
    bio: (u?.biography || u?.bio || '').slice(0, 1000),
    followers: u?.follower_count ?? u?.followers ?? null,
    country: null,
    default_language: null,
    external_url: u?.external_url || null,
    caption_sample: null,
    engagement_signal: 0,
    is_business_account: u?.is_business ?? null,
    business_category: u?.category_name || u?.category || null,
    is_verified: !!(u?.is_verified || u?.verified),
    discovery_source: source,
    discovery_query: query,
    raw: u,
    comment_depth: 0,
  };
}

export function normalizeHikerMediaToRaw(media, query) {
  const u = media?.user || media?.owner || {};
  const caption =
    typeof media?.caption === 'string'
      ? media.caption
      : media?.caption?.text || media?.text || '';
  const likes = Number(media?.like_count ?? 0);
  const comments = Number(media?.comment_count ?? 0);
  return {
    platform: 'instagram',
    handle: u.username || '',
    name: u.full_name || u.username || '',
    bio: (u.biography || '').slice(0, 1000),
    followers: u.follower_count ?? null,
    country: null,
    default_language: null,
    external_url: u.external_url || null,
    caption_sample: (caption || '').slice(0, 500),
    engagement_signal: likes + 5 * comments,
    is_business_account: u.is_business ?? null,
    business_category: u.category_name || null,
    is_verified: !!u.is_verified,
    discovery_source: 'main',
    discovery_query: query,
    raw: media,
    comment_depth: 0,
  };
}

/**
 * Hikers user-profile-svar wrappas i { user: {...} } för paritet med
 * SC's getIgProfile() så att enrichment-koden är agnostisk.
 */
export function normalizeHikerProfileResponse(raw) {
  const u = raw?.user || raw || {};
  return {
    user: {
      username: u.username || '',
      full_name: u.full_name || u.username || '',
      biography: u.biography || u.bio || '',
      follower_count: u.follower_count ?? null,
      following_count: u.following_count ?? null,
      external_url: u.external_url || null,
      is_business: u.is_business ?? false,
      category: u.category_name || u.category || null,
      is_verified: !!(u.is_verified || u.verified),
      related_profiles: u.related_profiles || [],
    },
    raw,
  };
}

export const __test__ = {
  hikerFetch,
  normalizeHikerUserToRaw,
  normalizeHikerMediaToRaw,
  normalizeHikerProfileResponse,
};
