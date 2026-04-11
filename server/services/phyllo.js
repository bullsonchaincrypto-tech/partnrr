import fetch from 'node-fetch';
import { queryOne, runSql, queryAll } from '../db/schema.js';

/**
 * Phyllo API-integration for influencer data (Creator Discovery).
 *
 * Docs: https://docs.getphyllo.com/docs/api-reference/api/ref
 *
 * Korrekt endpoint: POST /v1/social/creators/profiles/search
 * Auth: Basic Auth (client_id:client_secret base64)
 *
 * Phyllo ger oss:
 * - Engagement rate, avg likes/views
 * - Audience demographics (kön, ålder, geografi, språk)
 * - Credibility score (fake followers)
 * - Follower growth
 * - Contact details (e-post, sociala profiler)
 * - Verified platform data
 */

// Phyllo-miljö: staging som standard
const PHYLLO_BASE = process.env.PHYLLO_BASE_URL || 'https://api.staging.getphyllo.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache

// Plattforms-ID cache (hämtas dynamiskt vid första anropet)
let platformIdCache = null;

/**
 * Hämta Phyllo auth headers
 */
function getHeaders() {
  const clientId = process.env.PHYLLO_CLIENT_ID;
  const clientSecret = process.env.PHYLLO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null; // Phyllo ej konfigurerad — graceful degradation
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Kolla om Phyllo API är tillgänglig
 */
export async function isPhylloConfigured() {
  return !!(process.env.PHYLLO_CLIENT_ID && process.env.PHYLLO_CLIENT_SECRET);
}

/**
 * Gör ett Phyllo API-anrop med rate limiting och retry
 */
async function phylloRequest(endpoint, options = {}) {
  const headers = getHeaders();
  if (!headers) throw new Error('Phyllo API ej konfigurerad');

  const url = `${PHYLLO_BASE}${endpoint}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Phyllo] ${options.method || 'GET'} ${url}`);
      const res = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
      });

      // Rate limit — vänta och försök igen
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '2');
        console.log(`[Phyllo] Rate limited, väntar ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Phyllo API ${res.status}: ${errText.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Exponential backoff
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}

// ============================================================
// WORK PLATFORM IDs — hämtas dynamiskt och cachas
// ============================================================

/**
 * Hämta alla work platforms och cacha dem.
 * Returnerar en map: { instagram: "uuid", youtube: "uuid", tiktok: "uuid", twitch: "uuid" }
 */
async function getWorkPlatformIds() {
  if (platformIdCache) return platformIdCache;

  try {
    const data = await phylloRequest('/v1/work-platforms?limit=50');
    const platforms = data.data || [];

    platformIdCache = {};
    for (const p of platforms) {
      const name = (p.name || '').toLowerCase();
      platformIdCache[name] = p.id;
    }

    console.log('[Phyllo] Work platforms loaded:', Object.keys(platformIdCache).join(', '));
    return platformIdCache;
  } catch (err) {
    console.error('[Phyllo] Failed to load work platforms:', err.message);
    // Fallback: kända ID:n från Phyllo (kan skilja mellan miljöer)
    platformIdCache = {
      instagram: '9bb8913b-ddd9-430b-a66a-d74d846e6c66',
      youtube: '14d9ddf5-51c6-415e-bde6-f8ed36ad7054',
      tiktok: 'de55aeec-0dc8-4119-bf90-16b3d1f0c987',
      twitch: 'e4f4e60c-6b1e-4865-9c92-fbfb1a654957',
    };
    return platformIdCache;
  }
}

/**
 * Hämta work_platform_id för en given plattform
 */
async function getPlatformId(platformName) {
  const ids = await getWorkPlatformIds();
  const name = platformName.toLowerCase().trim();
  return ids[name] || null;
}

// ============================================================
// CREATOR DISCOVERY — Sök influencers
// ============================================================

/**
 * Sök influencers via Phyllo Creator Discovery API.
 * Endpoint: POST /v1/social/creators/profiles/search
 *
 * @param {Object} params
 * @param {string} params.platform - 'instagram', 'youtube', 'tiktok', 'twitch'
 * @param {string} [params.query] - Sökord för bio/description
 * @param {string[]} [params.niches] - Ämnesrelevans / topics
 * @param {number} [params.minFollowers=1000]
 * @param {number} [params.maxFollowers]
 * @param {number} [params.minEngagement] - Min engagement rate (%)
 * @param {string} [params.country='SE'] - ISO 3166-1 alpha-2 landskod (not used directly, see audience_location)
 * @param {number} [params.limit=20]
 */
export async function searchInfluencers({ platform, query, niches, minFollowers = 1000, maxFollowers, minEngagement, country = 'SE', limit = 20 }) {
  if (!isPhylloConfigured()) {
    console.log('[Phyllo] Ej konfigurerad — returnerar tom lista');
    return { results: [], source: 'none' };
  }

  // Kolla cache först
  const cacheKey = `${platform}_${query}_${niches}_${country}_${limit}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    console.log(`[Phyllo] Cache hit för ${cacheKey}`);
    return { results: cached, source: 'cache' };
  }

  try {
    // Hämta work_platform_id
    const workPlatformId = await getPlatformId(platform);
    if (!workPlatformId) {
      console.warn(`[Phyllo] Okänd plattform: ${platform}`);
      return { results: [], source: 'error', error: `Okänd plattform: ${platform}` };
    }

    // Bygg request body enligt Phyllo Creator Discovery API
    const searchBody = {
      work_platform_id: workPlatformId,
      follower_count: {
        min: minFollowers,
        ...(maxFollowers && { max: maxFollowers }),
      },
      // Sök i bio/description
      ...(query && { description_keywords: query }),
      // Topic-relevans
      ...(niches && {
        topic_relevance: {
          name: Array.isArray(niches) ? niches : [niches],
          weight: 0.5,
          threshold: 0.5,
        },
      }),
      // Engagement rate filter
      ...(minEngagement && {
        engagement_rate: {
          percentage_value: String(minEngagement),
        },
      }),
      // Kräv kontaktuppgifter (e-post) om möjligt
      has_contact_details: true,
      // Audience location (Sverige) - uses name-based filter
      ...(country && {
        audience_location: [{
          name: country === 'SE' ? 'Sweden' : country,
          percentage_value: 15,
          operator: 'GT',
        }],
      }),
      // Sortera på engagement rate (bäst först)
      sort_by: {
        field: 'ENGAGEMENT_RATE',
        order: 'DESCENDING',
      },
      limit: Math.min(limit, 50),
      offset: 0,
    };

    console.log(`[Phyllo] Söker ${platform} influencers:`, JSON.stringify(searchBody).slice(0, 300));
    const data = await phylloRequest('/v1/social/creators/profiles/search', {
      method: 'POST',
      body: JSON.stringify(searchBody),
    });

    const results = (data.data || []).map(normalizeCreator);

    // Cacha resultat
    cacheSearchResults(cacheKey, results);

    console.log(`[Phyllo] Hittade ${results.length} ${platform} influencers`);
    return { results, source: 'phyllo_api' };
  } catch (err) {
    console.error(`[Phyllo] Search error:`, err.message);

    // Om 403/401 — troligen ej tillgång till Creator Discovery i staging
    if (err.message.includes('403') || err.message.includes('401')) {
      console.warn('[Phyllo] Creator Discovery kanske inte är aktiverad i staging-miljön');
    }

    return { results: [], source: 'error', error: err.message };
  }
}

/**
 * Hämta detaljerad profil för en specifik influencer via username
 * Endpoint: POST /v1/social/creators/profiles/search med platform_username
 */
export async function getCreatorProfile(platformUsername, platform) {
  if (!isPhylloConfigured()) return null;

  try {
    const workPlatformId = await getPlatformId(platform);
    if (!workPlatformId) return null;

    // Sök efter exakt username via bio_phrase (närmaste alternativ)
    const data = await phylloRequest('/v1/social/creators/profiles/search', {
      method: 'POST',
      body: JSON.stringify({
        work_platform_id: workPlatformId,
        description_keywords: platformUsername,
        sort_by: { field: 'FOLLOWER_COUNT', order: 'DESCENDING' },
        limit: 5,
      }),
    });

    // Hitta exakt match på username
    const match = (data.data || []).find(
      c => (c.platform_username || '').toLowerCase() === platformUsername.toLowerCase()
    );

    return match ? normalizeCreator(match) : null;
  } catch (err) {
    console.error(`[Phyllo] Profile error for ${platformUsername}:`, err.message);
    return null;
  }
}

// ============================================================
// NORMALIZER — mappar Phyllo Creator Discovery response till vårt format
// ============================================================

/**
 * Normalisera Phyllo Creator Discovery data till vårt interna format.
 *
 * Phyllo response per creator:
 * {
 *   platform_username, url, image_url, follower_count, subscriber_count,
 *   is_verified, work_platform: { id, name, logo_url },
 *   full_name, introduction, platform_account_type,
 *   gender, age_group, language, content_count,
 *   engagement_rate, average_likes, average_views,
 *   creator_location: { city, state, country },
 *   contact_details: [{ type, value }],
 *   filter_match: { ... }
 * }
 */
function normalizeCreator(raw) {
  const platformName = (raw.work_platform?.name || '').toLowerCase();

  // Extrahera kontaktinfo
  const contacts = raw.contact_details || [];
  const emailContact = contacts.find(c => c.type === 'EMAIL');
  const otherContacts = contacts.filter(c => c.type !== 'EMAIL');

  // Location
  const location = raw.creator_location || raw.location || {};

  return {
    // Identifiering
    phyllo_id: null, // Creator Discovery ger ej ett unikt Phyllo-ID
    name: raw.full_name || raw.platform_username || 'Okänd',
    platform: platformName,
    handle: raw.platform_username || '',
    profile_url: raw.url || '',
    avatar_url: raw.image_url || '',
    bio: raw.introduction || '',

    // Följare
    followers: raw.follower_count || 0,
    subscribers: raw.subscriber_count || 0,
    posts_count: raw.content_count || 0,

    // Engagement
    engagement_rate: raw.engagement_rate || 0,
    avg_likes: raw.average_likes || 0,
    avg_comments: 0, // Ej tillgängligt i Creator Discovery
    avg_views: raw.average_views || 0,

    // Kvalitet
    fake_follower_pct: null, // Kräver separat credibility-anrop
    growth_rate_30d: null,

    // Publik
    audience_demographics: {
      age_groups: {},
      gender: {},
      countries: {},
    },
    sweden_audience_pct: 0, // Kan ej extraheras direkt från search

    // Kontakt
    email: emailContact?.value || null,
    contact_details: otherContacts.map(c => ({ type: c.type, value: c.value })),

    // Pris (estimerat baserat på följare + engagement)
    estimated_price_sek: estimatePriceSek(raw.follower_count || 0, raw.engagement_rate || 0),

    // Meta
    content_frequency: null,
    recent_brand_deals: [],
    niches: [], // Topic data ej i search response
    verified: raw.is_verified || false,
    gender: raw.gender || null,
    age_group: raw.age_group || null,
    language: raw.language || null,
    location: location.country ? `${location.city || ''}, ${location.country}`.replace(/^, /, '') : null,
    account_type: raw.platform_account_type || null,

    // Datakälla
    datakalla: 'phyllo_api',
    verifierad: true,
  };
}

/**
 * Estimera pris i SEK baserat på följare och engagement
 */
function estimatePriceSek(followers, engagementRate) {
  if (!followers) return null;

  // Baslinje: CPM-baserad prissättning (svensk marknad)
  let baseCPM = 50; // SEK per 1000 visningar

  // Justera för engagement
  if (engagementRate > 5) baseCPM *= 1.5;
  else if (engagementRate > 3) baseCPM *= 1.2;
  else if (engagementRate < 1) baseCPM *= 0.6;

  // Estimerade visningar ~ 10-30% av följare
  const estViews = followers * 0.15;
  const price = Math.round((estViews / 1000) * baseCPM);

  // Min/max
  return Math.max(500, Math.min(price, 250000));
}

// ============================================================
// CACHE (SQLite-baserad, 24h TTL)
// ============================================================

async function getCachedSearch(key) {
  try {
    const row = await queryOne(
      'SELECT data, created_at FROM influencer_search_cache WHERE cache_key = ?',
      [key]
    );
    if (!row) return null;

    const age = Date.now() - new Date(row.created_at).getTime();
    if (age > CACHE_TTL_MS) return null;

    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

async function cacheSearchResults(key, results) {
  try {
    await runSql(
      'INSERT OR REPLACE INTO influencer_search_cache (cache_key, data, created_at) VALUES (?, ?, datetime("now"))',
      [key, JSON.stringify(results)]
    );
  } catch (err) {
    console.error('[Phyllo] Cache write error:', err.message);
  }
}

// ============================================================
// DIAGNOSTIK — testa API-anslutning
// ============================================================

/**
 * Testa Phyllo API-anslutningen och returnera status
 */
export async function testConnection() {
  if (!isPhylloConfigured()) {
    return { ok: false, error: 'PHYLLO_CLIENT_ID eller PHYLLO_CLIENT_SECRET saknas i .env' };
  }

  try {
    const data = await phylloRequest('/v1/work-platforms?limit=5');
    const platforms = (data.data || []).map(p => p.name);
    return {
      ok: true,
      environment: PHYLLO_BASE.includes('staging') ? 'staging' : PHYLLO_BASE.includes('sandbox') ? 'sandbox' : 'production',
      platforms_available: platforms,
      base_url: PHYLLO_BASE,
    };
  } catch (err) {
    return { ok: false, error: err.message, base_url: PHYLLO_BASE };
  }
}
