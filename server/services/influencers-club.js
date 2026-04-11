import fetch from 'node-fetch';

/**
 * Influencers.club API-integration — Influencer Discovery & Enrichment
 *
 * Docs: https://docs.influencers.club/
 * Base URL: https://api-dashboard.influencers.club/public/v1
 * Auth: Bearer token (API key)
 *
 * Endpoints:
 *   POST /discovery       — Sök influencers med filter
 *   POST /enrich/handle   — Berika profil via handle
 *   POST /enrich/email    — Berika profil via e-post
 *   POST /lookalikes      — Hitta liknande profiler
 *   GET  /dictionary/...  — Hämta giltiga filter-värden (plattformar, länder, etc.)
 *
 * Credits: ~0.01 per sökresultat, 1.0 per full profil-enrichment, 2.0 per e-post-enrichment
 */

const BASE_URL = process.env.INFLUENCERS_CLUB_BASE_URL || 'https://api-dashboard.influencers.club/public/v1';

// Plattformsnamn som Influencers.club förväntar sig
const PLATFORM_MAP = {
  instagram: 'instagram',
  youtube: 'youtube',
  tiktok: 'tiktok',
  twitch: 'twitch',
  x: 'twitter',
  twitter: 'twitter',
};

/**
 * Kolla om API:et är konfigurerat
 */
export async function isInfluencersClubConfigured() {
  return !!process.env.INFLUENCERS_CLUB_API_KEY;
}

/**
 * Skapa auth headers
 */
function getHeaders() {
  const apiKey = process.env.INFLUENCERS_CLUB_API_KEY;
  if (!apiKey) throw new Error('INFLUENCERS_CLUB_API_KEY saknas i .env');

  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

/**
 * Gör ett API-anrop med retry och rate limiting
 */
async function apiRequest(endpoint, body = null, method = 'POST') {
  const url = `${BASE_URL}${endpoint}`;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[InfluencersClub] ${method} ${endpoint}`);

      const options = {
        method,
        headers: getHeaders(),
      };

      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);

      // Rate limit
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '3');
        console.log(`[InfluencersClub] Rate limited, väntar ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`InfluencersClub API ${res.status}: ${errText.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}

// ============================================================
// DISCOVERY — Sök influencers
// ============================================================

/**
 * Sök influencers via Discovery API.
 *
 * @param {Object} params
 * @param {string} params.platform - 'instagram', 'youtube', 'tiktok', 'twitch'
 * @param {string} [params.query] - Sökord (bio/beskrivning)
 * @param {string[]} [params.topics] - Ämnen/nischer
 * @param {number} [params.minFollowers=1000]
 * @param {number} [params.maxFollowers]
 * @param {number} [params.minEngagement] - Min engagement rate (%)
 * @param {string} [params.country='SE'] - ISO landskod
 * @param {string} [params.language='sv'] - Språkkod
 * @param {boolean} [params.hasEmail=true] - Kräv e-post
 * @param {number} [params.limit=20]
 * @param {number} [params.offset=0]
 */
export async function searchInfluencers({
  platform,
  query,
  topics,
  minFollowers = 1000,
  maxFollowers,
  minEngagement,
  country = 'SE',
  language,
  hasEmail = true,
  limit = 20,
  offset = 0,
}) {
  if (!isInfluencersClubConfigured()) {
    console.log('[InfluencersClub] Ej konfigurerad');
    return { results: [], source: 'none' };
  }

  try {
    const platformKey = PLATFORM_MAP[platform?.toLowerCase()] || platform;

    // Bygg filter-body
    const body = {
      platform: platformKey,
      limit: Math.min(limit, 50),
      offset,
      sort_by: 'engagement_rate',
      sort_order: 'desc',
    };

    // Follower-filter
    if (minFollowers) body.min_followers = minFollowers;
    if (maxFollowers) body.max_followers = maxFollowers;

    // Engagement filter
    if (minEngagement) body.min_engagement_rate = minEngagement;

    // Sökord
    if (query) body.keyword = query;

    // Topics/nischer
    if (topics && topics.length > 0) {
      body.topics = Array.isArray(topics) ? topics : [topics];
    }

    // Geografi
    if (country) {
      body.audience_country = country === 'SE' ? 'Sweden' : country;
    }

    // Språk
    if (language) body.language = language;

    // E-post-krav
    if (hasEmail) body.has_email = true;

    console.log(`[InfluencersClub] Discovery ${platform}:`, JSON.stringify(body).slice(0, 200));

    const data = await apiRequest('/discovery', body);

    const results = (data.data || data.results || data || [])
      .filter(Array.isArray(data.data || data.results || data) ? () => true : () => false);

    // Normalisera resultat
    const normalized = (Array.isArray(data.data) ? data.data :
                        Array.isArray(data.results) ? data.results :
                        Array.isArray(data) ? data : [])
      .map(normalizeInfluencer);

    console.log(`[InfluencersClub] Hittade ${normalized.length} influencers`);
    return {
      results: normalized,
      source: 'influencers_club',
      credits_used: data.credits_used || null,
      total: data.total || normalized.length,
    };
  } catch (err) {
    console.error(`[InfluencersClub] Discovery error:`, err.message);
    return { results: [], source: 'error', error: err.message };
  }
}

// ============================================================
// ENRICHMENT — Berika en profil
// ============================================================

/**
 * Berika en influencer-profil via handle.
 * Ger full data: engagement, audience demografi, e-post, etc.
 * Kostar ~1 credit per anrop.
 */
export async function enrichByHandle(handle, platform) {
  if (!isInfluencersClubConfigured()) return null;

  try {
    const platformKey = PLATFORM_MAP[platform?.toLowerCase()] || platform;
    const data = await apiRequest('/enrich/handle', {
      handle: handle.replace(/^@/, ''),
      platform: platformKey,
    });

    return normalizeInfluencer(data.data || data);
  } catch (err) {
    console.error(`[InfluencersClub] Enrich handle error:`, err.message);
    return null;
  }
}

/**
 * Berika via e-post — hittar alla sociala profiler kopplade till en e-post.
 * Kostar ~2 credits per anrop.
 */
export async function enrichByEmail(email) {
  if (!isInfluencersClubConfigured()) return null;

  try {
    const data = await apiRequest('/enrich/email', { email });
    return normalizeInfluencer(data.data || data);
  } catch (err) {
    console.error(`[InfluencersClub] Enrich email error:`, err.message);
    return null;
  }
}

/**
 * Hitta liknande influencers (lookalikes).
 * Perfekt för: "hitta fler som denna influencer"
 */
export async function findLookalikes(handle, platform, limit = 10) {
  if (!isInfluencersClubConfigured()) return [];

  try {
    const platformKey = PLATFORM_MAP[platform?.toLowerCase()] || platform;
    const data = await apiRequest('/lookalikes', {
      handle: handle.replace(/^@/, ''),
      platform: platformKey,
      limit,
    });

    return (data.data || data.results || []).map(normalizeInfluencer);
  } catch (err) {
    console.error(`[InfluencersClub] Lookalikes error:`, err.message);
    return [];
  }
}

// ============================================================
// NORMALIZER
// ============================================================

/**
 * Normalisera Influencers.club data till vårt interna format.
 */
function normalizeInfluencer(raw) {
  if (!raw) return null;

  // Plattform
  const platform = (raw.platform || raw.social_network || '').toLowerCase();

  // Kontaktinfo
  const email = raw.email || raw.contact_email || null;

  return {
    // Identifiering
    name: raw.full_name || raw.name || raw.username || 'Okänd',
    platform,
    handle: raw.username || raw.handle || raw.platform_username || '',
    profile_url: raw.url || raw.profile_url || raw.link || '',
    avatar_url: raw.image_url || raw.avatar_url || raw.profile_picture || '',
    bio: raw.bio || raw.introduction || raw.description || '',

    // Statistik
    followers: raw.followers || raw.follower_count || 0,
    subscribers: raw.subscribers || raw.subscriber_count || 0,
    posts_count: raw.posts_count || raw.content_count || raw.media_count || 0,

    // Engagement
    engagement_rate: raw.engagement_rate || 0,
    avg_likes: raw.avg_likes || raw.average_likes || 0,
    avg_comments: raw.avg_comments || raw.average_comments || 0,
    avg_views: raw.avg_views || raw.average_views || 0,

    // Kvalitet
    fake_follower_pct: raw.credibility_score ? (1 - raw.credibility_score) * 100 : null,
    growth_rate_30d: raw.growth_rate || raw.follower_growth_rate || null,

    // Publik
    audience_demographics: {
      age_groups: raw.audience_ages || raw.audience_age || {},
      gender: raw.audience_genders || raw.audience_gender || {},
      countries: raw.audience_countries || raw.audience_geo || {},
    },
    sweden_audience_pct: extractSwedishAudience(raw),

    // Kontakt
    kontakt_epost: email,
    email,
    contact_details: raw.contacts || raw.contact_details || [],

    // Pris
    estimated_price_sek: estimatePrice(raw.followers || raw.follower_count || 0, raw.engagement_rate || 0),

    // Meta
    verified: raw.is_verified || false,
    gender: raw.gender || null,
    language: raw.language || null,
    location: raw.location || raw.country || null,
    niches: raw.topics || raw.interests || raw.categories || [],

    // Datakälla
    datakalla: 'influencers_club',
    verifierad: true,
  };
}

function extractSwedishAudience(raw) {
  const geo = raw.audience_countries || raw.audience_geo || {};
  if (geo.SE) return geo.SE;
  if (geo.Sweden) return geo.Sweden;
  if (geo.sweden) return geo.sweden;
  // Sök i array-format
  if (Array.isArray(geo)) {
    const se = geo.find(g => g.code === 'SE' || g.name === 'Sweden');
    return se?.percentage || se?.value || 0;
  }
  return 0;
}

function estimatePrice(followers, engagementRate) {
  if (!followers) return null;
  let baseCPM = 50;
  if (engagementRate > 5) baseCPM *= 1.5;
  else if (engagementRate > 3) baseCPM *= 1.2;
  else if (engagementRate < 1) baseCPM *= 0.6;
  const estViews = followers * 0.15;
  return Math.max(500, Math.min(Math.round((estViews / 1000) * baseCPM), 250000));
}

// ============================================================
// TEST / DIAGNOSTIK
// ============================================================

/**
 * Testa API-anslutningen
 */
export async function testConnection() {
  if (!isInfluencersClubConfigured()) {
    return { ok: false, error: 'INFLUENCERS_CLUB_API_KEY saknas i .env' };
  }

  try {
    // Testa med en minimal discovery-sökning
    const data = await apiRequest('/discovery', {
      platform: 'instagram',
      min_followers: 100000,
      limit: 1,
    });

    return {
      ok: true,
      source: 'influencers_club',
      sample_results: (data.data || data.results || []).length,
      base_url: BASE_URL,
    };
  } catch (err) {
    return { ok: false, error: err.message, base_url: BASE_URL };
  }
}
