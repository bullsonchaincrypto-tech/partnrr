// ============================================================
// V9 Pipeline — ScrapeCreators provider (PRIMARY social-data källa)
// ============================================================
// Dokumentation: https://docs.scrapecreators.com/
// Auth: x-api-key header.
//
// Interface (delas med providers/hikerapi.js via providers/social-provider.js):
//   - searchReels(term, limit)               → { items: RawCandidate[] }
//   - searchIgHashtag(tag, limit)            → { items: RawCandidate[] }
//   - getIgProfile(handle)                   → IgProfile
//   - searchTikTokVideo(term, limit)         → { items: RawCandidate[] }
//   - searchTikTokHashtag(tag, limit)        → { items: RawCandidate[] }
//   - getTikTokProfile(handle)               → TtProfile
//
// Alla anrop loggas till provider_events (provider-health.js).

import { recordProviderEvent } from '../provider-health.js';

const BASE = 'https://api.scrapecreators.com';
const TIMEOUT_MS = 15000;
const PROVIDER = 'scrapecreators';

function getKey() {
  const k = process.env.SCRAPECREATORS_API_KEY;
  if (!k) throw new Error('[ScrapeCreators] SCRAPECREATORS_API_KEY saknas');
  return k;
}

/**
 * Internt fetch-wrapper med timeout, error-handling och provider_events-logging.
 */
async function scFetch(endpoint, params = {}) {
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
        'x-api-key': getKey(),
        'accept': 'application/json',
      },
      signal: ac.signal,
    });
    status = res.status;
    if (!res.ok) {
      errMsg = `HTTP ${res.status}`;
      throw new Error(`[ScrapeCreators] ${endpoint} → ${res.status}`);
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
 * IG Reels-search via keyword.
 * Endpoint: GET /v2/instagram/reels/search?query=...
 * (Verifierat mot https://docs.scrapecreators.com/v2/instagram/reels/search)
 * OBS: SC returnerar paginerat set — vi tar bara första sidan (~12-20 reels).
 * Parametern `limit` är enbart mjuk cap på client-sidan.
 */
export async function searchReels(term, limit = 30) {
  const raw = await scFetch('/v2/instagram/reels/search', {
    query: term,
  });
  const reels = raw?.reels || raw?.items || raw?.data || [];
  const items = reels.slice(0, limit).map(r => normalizeIgReelToRaw(r, term));
  return { items, raw };
}

/**
 * IG hashtag-search — EJ SUPPORTAT av ScrapeCreators.
 * SC har /v1/instagram/song/reels och /v2/instagram/reels/search men ingen
 * dedikerad hashtag-medias-endpoint. Vi faller tillbaka på reels-search med
 * hashtag som query-string (SC's sökning matchar på hashtag-innehåll i caption).
 */
export async function searchIgHashtag(tag, limit = 20) {
  const cleanTag = String(tag || '').replace(/^#/, '');
  // Kör som reel-search med "#tag" som query
  const raw = await scFetch('/v2/instagram/reels/search', {
    query: `#${cleanTag}`,
  });
  const reels = raw?.reels || raw?.items || raw?.data || [];
  const items = reels.slice(0, limit).map(r => normalizeIgReelToRaw(r, `#${cleanTag}`));
  return { items, raw };
}

/**
 * IG-profile (full data inkl bio, follower-count, business-info).
 * Endpoint: GET /v1/instagram/profile?handle=...
 */
export async function getIgProfile(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '');
  return scFetch('/v1/instagram/profile', { handle: cleanHandle });
}

// ============================================================
// === TIKTOK ==================================================
// ============================================================

/**
 * TikTok video-search via keyword.
 * Endpoint: GET /v1/tiktok/search/keyword?query=...&region=SE
 * (Verifierat mot https://docs.scrapecreators.com/v1/tiktok/search/keyword)
 */
export async function searchTikTokVideo(term, limit = 30) {
  const raw = await scFetch('/v1/tiktok/search/keyword', {
    query: term,
    region: 'SE',
  });
  const items = (raw?.search_item_list || raw?.videos || raw?.items || raw?.data || [])
    .slice(0, limit)
    .map(v => normalizeTtVideoToRaw(v, term));
  return { items, raw };
}

/**
 * TikTok hashtag-search.
 * Endpoint: GET /v1/tiktok/search/hashtag?hashtag=...&region=SE
 * (Verifierat mot https://docs.scrapecreators.com/v1/tiktok/search/hashtag)
 */
export async function searchTikTokHashtag(tag, limit = 20) {
  const cleanTag = String(tag || '').replace(/^#/, '');
  const raw = await scFetch('/v1/tiktok/search/hashtag', {
    hashtag: cleanTag,
    region: 'SE',
  });
  const items = (raw?.search_item_list || raw?.videos || raw?.items || raw?.data || [])
    .slice(0, limit)
    .map(v => normalizeTtVideoToRaw(v, `#${cleanTag}`));
  return { items, raw };
}

/**
 * TikTok-profile.
 * Endpoint: GET /v1/tiktok/profile?handle=...
 */
export async function getTikTokProfile(handle) {
  const cleanHandle = String(handle || '').replace(/^@/, '');
  return scFetch('/v1/tiktok/profile', { handle: cleanHandle });
}

// ============================================================
// === NORMALISERING ===========================================
// ============================================================
// Konverterar provider-specifikt rå-svar till V9 RawCandidate-schema.

export function normalizeIgReelToRaw(reel, query) {
  const u = reel?.user || reel?.owner || reel?.author || {};
  const caption =
    typeof reel?.caption === 'string'
      ? reel.caption
      : reel?.caption?.text || reel?.text || reel?.description || '';
  const likes = Number(reel?.like_count ?? reel?.likes ?? 0);
  const comments = Number(reel?.comment_count ?? reel?.comments ?? 0);
  const shares = Number(reel?.share_count ?? reel?.shares ?? 0);
  return {
    platform: 'instagram',
    handle: u.username || u.handle || '',
    name: u.full_name || u.name || u.username || '',
    bio: (u.biography || u.bio || '').slice(0, 1000),
    followers: u.follower_count ?? u.followers ?? null,
    country: null,
    default_language: null,
    external_url: u.external_url || null,
    caption_sample: (caption || '').slice(0, 500),
    engagement_signal: likes + 5 * comments + 10 * shares,
    is_business_account: u.is_business ?? u.is_business_account ?? null,
    business_category: u.category || null,
    is_verified: !!(u.is_verified || u.verified),
    discovery_source: 'main',
    discovery_query: query,
    raw: reel,
    comment_depth: 0,
  };
}

export function normalizeTtVideoToRaw(video, query) {
  const u = video?.author || video?.user || {};
  const caption = video?.desc || video?.description || video?.caption || '';
  const likes = Number(video?.stats?.diggCount ?? video?.like_count ?? video?.likes ?? 0);
  const comments = Number(video?.stats?.commentCount ?? video?.comment_count ?? 0);
  const shares = Number(video?.stats?.shareCount ?? video?.share_count ?? 0);
  return {
    platform: 'tiktok',
    handle: u.uniqueId || u.username || u.handle || '',
    name: u.nickname || u.name || u.uniqueId || '',
    bio: (u.signature || u.bio || u.biography || '').slice(0, 1000),
    followers: u.followerCount ?? u.follower_count ?? u.fans ?? null,
    country: u.region || null,
    default_language: null,
    external_url: u.bioLink?.link || null,
    caption_sample: caption.slice(0, 500),
    engagement_signal: likes + 5 * comments + 10 * shares,
    is_business_account: !!(u.commerceUserInfo || u.is_business),
    business_category: u.commerceUserInfo?.category || null,
    is_verified: !!(u.verified || u.is_verified),
    discovery_source: 'main',
    discovery_query: query,
    raw: video,
    comment_depth: 0,
  };
}

export const __test__ = { scFetch, normalizeIgReelToRaw, normalizeTtVideoToRaw };
