import fetch from 'node-fetch';
import { trackApiCost } from './cost-tracker.js';

/**
 * Social Enrichment Service
 *
 * Hämtar verifierad data (followers, bio, engagement) för Instagram och TikTok
 * via Apify scrapers. Används för att berika AI-hittade influencers med riktig data.
 *
 * Flöde:
 *   1. AI (Claude) hittar influencers via web search → namn + handles
 *   2. Denna service tar handles → hämtar followers + bio + stats från plattformen
 *   3. E-post hittas separat via SerpAPI (redan implementerat)
 *
 * Apify Actors:
 *   Instagram: apify/instagram-profile-scraper
 *   TikTok:    clockworks/tiktok-profile-scraper
 *
 * Kostnad: ~$0.01-0.05 per profil (Apify pay-per-result)
 */

const APIFY_BASE = 'https://api.apify.com/v2';

// Actor IDs (Apify Store)
const ACTORS = {
  instagram: 'apify/instagram-profile-scraper',
  tiktok: 'clockworks/tiktok-profile-scraper',
};

/**
 * Kolla om Apify är konfigurerat
 */
export function isApifyConfigured() {
  return !!process.env.APIFY_API_TOKEN;
}

function getToken() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN saknas i .env');
  return token;
}

// ============================================================
// HUVUDFUNKTION — Berika en lista med influencers
// ============================================================

/**
 * Berika en lista med influencer-handles med verifierad data.
 *
 * @param {Object[]} influencers - Lista med { handle, platform }
 * @returns {Object[]} - Samma lista med tillagd followers, bio, etc.
 */
export async function enrichInfluencers(influencers) {
  if (!isApifyConfigured() || !influencers?.length) {
    console.log(`[Enrichment] Skipping: configured=${isApifyConfigured()}, profiles=${influencers?.length || 0}`);
    return influencers;
  }

  // Gruppera per plattform
  const instagram = influencers.filter(i => i.platform?.toLowerCase() === 'instagram');
  const tiktok = influencers.filter(i => i.platform?.toLowerCase() === 'tiktok');

  // Kör parallellt
  const [igResults, ttResults] = await Promise.all([
    instagram.length > 0 ? enrichInstagramProfiles(instagram.map(i => i.handle)) : [],
    tiktok.length > 0 ? enrichTikTokProfiles(tiktok.map(i => i.handle)) : [],
  ]);

  // Skapa lookup-maps (handle → data)
  const igMap = new Map();
  for (const r of igResults) {
    if (r.username) igMap.set(r.username.toLowerCase(), r);
  }
  const ttMap = new Map();
  for (const r of ttResults) {
    if (r.username) ttMap.set(r.username.toLowerCase(), r);
  }

  // Merga tillbaka
  return influencers.map(inf => {
    const handle = (inf.handle || '').replace(/^@/, '').toLowerCase();
    const platform = (inf.platform || '').toLowerCase();

    if (platform === 'instagram' && igMap.has(handle)) {
      return mergeEnrichment(inf, igMap.get(handle));
    }
    if (platform === 'tiktok' && ttMap.has(handle)) {
      return mergeEnrichment(inf, ttMap.get(handle));
    }

    // Ingen enrichment — markera som ej verifierad
    return { ...inf, verifierad: false, datakalla: inf.datakalla || 'ai_estimated' };
  });
}

/**
 * Berika en enskild influencer
 */
export async function enrichSingleProfile(handle, platform) {
  if (!isApifyConfigured()) return null;

  const cleanHandle = handle.replace(/^@/, '');
  const pl = platform.toLowerCase();

  try {
    let result = null;
    if (pl === 'instagram') {
      const results = await enrichInstagramProfiles([cleanHandle]);
      result = results[0] || null;
    } else if (pl === 'tiktok') {
      const results = await enrichTikTokProfiles([cleanHandle]);
      result = results[0] || null;
    }

    // Returnera null om profilen saknar riktig data (spökprofil)
    if (result && !result.followers && !result.bio) {
      console.log(`[Enrichment] @${cleanHandle} (${platform}): profil tom — returnerar null`);
      return null;
    }
    return result;
  } catch (err) {
    console.error(`[Enrichment] Error for @${cleanHandle} on ${platform}:`, err.message);
    return null;
  }
}

// ============================================================
// INSTAGRAM — via Apify
// ============================================================

/**
 * Hämta Instagram-profiler via Apify actor i batches
 * @param {string[]} usernames - Lista med Instagram-handles (utan @)
 */
async function enrichInstagramProfiles(usernames) {
  if (!usernames.length) return [];

  console.log(`[Enrichment] Hämtar ${usernames.length} Instagram-profiler via Apify (i batches om 5)...`);

  const BATCH_SIZE = 5;
  const TIMEOUT_SECS = 120;
  const allResults = [];

  try {
    for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
      const batch = usernames.slice(i, i + BATCH_SIZE);
      console.log(`[Enrichment] Instagram batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} profiler...`);

      try {
        const result = await runApifyActor(
          ACTORS.instagram,
          {
            usernames: batch.map(u => u.replace(/^@/, '')),
            resultsLimit: 1,          // Bara profildata, inga posts
            addParentData: false,
          },
          TIMEOUT_SECS
        );

        const normalized = (result || []).map(raw => normalizeInstagram(raw));
        allResults.push(...normalized);
        console.log(`[Enrichment] Instagram batch klar, ${normalized.length} resultat`);
      } catch (batchErr) {
        console.error(`[Enrichment] Instagram batch error (batch ${i / BATCH_SIZE + 1}):`, batchErr.message);
        // Fortsätta med nästa batch istället för att kasta
      }
    }

    return allResults;
  } catch (err) {
    console.error('[Enrichment] Instagram error:', err.message);
    return allResults; // Returnera vad vi kunde hämta
  }
}

function normalizeInstagram(raw) {
  if (!raw) return {};

  return {
    username: raw.username || '',
    platform: 'instagram',
    full_name: raw.fullName || raw.full_name || '',
    bio: raw.biography || raw.bio || '',
    followers: raw.followersCount || raw.followers || raw.follower_count || 0,
    following: raw.followsCount || raw.following || 0,
    posts_count: raw.postsCount || raw.mediaCount || raw.posts_count || 0,
    is_verified: raw.verified || raw.isVerified || raw.is_verified || false,
    is_business: raw.isBusinessAccount || raw.is_business_account || false,
    category: raw.businessCategoryName || raw.category || '',
    profile_url: raw.url || `https://www.instagram.com/${raw.username}/`,
    avatar_url: raw.profilePicUrl || raw.profilePicUrlHD || raw.profile_pic_url || '',
    website: raw.externalUrl || raw.website || '',
    engagement_rate: calculateEngagement(raw),
  };
}

// ============================================================
// TIKTOK — via Apify
// ============================================================

/**
 * Hämta TikTok-profiler via Apify actor i batches
 * @param {string[]} usernames - Lista med TikTok-handles (utan @)
 */
async function enrichTikTokProfiles(usernames) {
  if (!usernames.length) return [];

  console.log(`[Enrichment] Hämtar ${usernames.length} TikTok-profiler via Apify (i batches om 4-5)...`);

  const BATCH_SIZE = 4;
  const TIMEOUT_SECS = 120;
  const allRawItems = [];

  try {
    for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
      const batch = usernames.slice(i, i + BATCH_SIZE);
      console.log(`[Enrichment] TikTok batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} profiler...`);

      try {
        const result = await runApifyActor(
          ACTORS.tiktok,
          {
            profiles: batch.map(u => u.replace(/^@/, '')),
            resultsPerPage: 1,    // Vi behöver bara profildata, inte alla videos
            shouldDownloadCovers: false,
            shouldDownloadVideos: false,
            shouldDownloadSubtitles: false,
          },
          TIMEOUT_SECS
        );

        allRawItems.push(...(result || []));
        console.log(`[Enrichment] TikTok batch klar, ${(result || []).length} rå-items`);
      } catch (batchErr) {
        console.error(`[Enrichment] TikTok batch error (batch ${Math.floor(i / BATCH_SIZE) + 1}):`, batchErr.message);
      }
    }

    // clockworks/tiktok-profile-scraper returnerar ofta VIDEO-objekt (100 per profil)
    // inte profil-objekt. Vi måste aggregera per unik author/profil.
    const profiles = aggregateTikTokProfiles(allRawItems, usernames);
    console.log(`[Enrichment] TikTok: ${allRawItems.length} rå-items → ${profiles.length} unika profiler`);
    return profiles;
  } catch (err) {
    console.error('[Enrichment] TikTok error:', err.message);
    return [];
  }
}

/**
 * Aggregera TikTok-items till unika profiler.
 *
 * clockworks/tiktok-profile-scraper kan returnera:
 * A) Profil-objekt med userInfo.user + userInfo.stats (idealt)
 * B) Video-objekt med authorMeta (vanligast — ~100 videos per profil)
 * C) Flat-objekt med followerCount etc direkt
 *
 * Vi grupperar per username och extraherar profildata från första träffen.
 */
function aggregateTikTokProfiles(items, requestedUsernames) {
  if (!items?.length) return [];

  // Log första item-strukturen för debugging
  const sample = items[0];
  const sampleKeys = Object.keys(sample || {}).join(', ');
  console.log(`[Enrichment] TikTok sample item keys: ${sampleKeys}`);
  if (sample?.authorMeta) console.log(`[Enrichment] TikTok → video-format (authorMeta)`);
  if (sample?.userInfo) console.log(`[Enrichment] TikTok → profil-format (userInfo)`);

  // Samla profildata per username
  const profileMap = new Map();

  for (const item of items) {
    const profile = extractTikTokProfile(item);
    if (!profile || !profile.username) continue;

    const key = profile.username.toLowerCase();

    // Behåll profilen med mest data (högst followers — om den förra var 0, uppdatera)
    if (!profileMap.has(key) || (profile.followers > 0 && (profileMap.get(key).followers || 0) === 0)) {
      profileMap.set(key, profile);
    }
  }

  // Logga vilka profiler som hittades vs missades
  const foundUsernames = Array.from(profileMap.keys());
  const requestedLower = requestedUsernames.map(u => u.toLowerCase().replace(/^@/, ''));
  const missing = requestedLower.filter(u => !profileMap.has(u));

  if (foundUsernames.length > 0) {
    console.log(`[Enrichment] TikTok matchade: ${foundUsernames.join(', ')} (med followers: ${foundUsernames.map(u => profileMap.get(u)?.followers || 0).join(', ')})`);
  }
  if (missing.length > 0) {
    console.log(`[Enrichment] TikTok missade (ej i scraperdata): ${missing.join(', ')}`);
  }

  // Om inga profiler hittades, logga sample
  if (profileMap.size === 0 && items.length > 0) {
    console.log(`[Enrichment] TikTok: Ingen profil extraherad!`);
    console.log(`[Enrichment] TikTok sample (first 500 chars): ${JSON.stringify(items[0]).slice(0, 500)}`);
  }

  return Array.from(profileMap.values());
}

/**
 * Extrahera profildata ur ett TikTok-item oavsett format
 */
function extractTikTokProfile(item) {
  if (!item) return null;

  // Format A: Profil-objekt med userInfo
  if (item.userInfo?.user) {
    const user = item.userInfo.user;
    const stats = item.userInfo.stats || {};
    return {
      username: user.uniqueId || user.username || '',
      platform: 'tiktok',
      full_name: user.nickname || '',
      bio: user.signature || '',
      followers: stats.followerCount || 0,
      following: stats.followingCount || 0,
      posts_count: stats.videoCount || 0,
      likes_total: stats.heartCount || stats.diggCount || 0,
      is_verified: user.verified || false,
      profile_url: `https://www.tiktok.com/@${user.uniqueId || user.username}`,
      avatar_url: user.avatarLarger || user.avatarMedium || '',
      engagement_rate: 0,
    };
  }

  // Format B: Video-objekt med authorMeta (vanligast för clockworks scraper)
  if (item.authorMeta) {
    const a = item.authorMeta;
    return {
      username: a.name || a.uniqueId || a.id || '',
      platform: 'tiktok',
      full_name: a.nickName || a.nickname || a.name || '',
      bio: a.signature || a.bio || '',
      followers: a.fans || a.followers || a.followerCount || 0,
      following: a.following || a.followingCount || 0,
      posts_count: a.video || a.videoCount || 0,
      likes_total: a.heart || a.heartCount || a.digg || a.diggCount || 0,
      is_verified: a.verified || false,
      profile_url: `https://www.tiktok.com/@${a.name || a.uniqueId || ''}`,
      avatar_url: a.avatar || a.avatarLarger || '',
      engagement_rate: 0,
    };
  }

  // Format C: Flat-objekt (direkt fält)
  if (item.uniqueId || item.username || item.user) {
    const user = item.user || item;
    const stats = item.stats || item;
    return {
      username: user.uniqueId || user.username || item.uniqueId || '',
      platform: 'tiktok',
      full_name: user.nickname || user.fullName || item.nickname || '',
      bio: user.signature || user.bio || item.signature || '',
      followers: stats.followerCount || stats.followers || item.followerCount || item.fans || 0,
      following: stats.followingCount || stats.following || item.followingCount || 0,
      posts_count: stats.videoCount || stats.videos || item.videoCount || 0,
      likes_total: stats.heartCount || stats.diggCount || item.heartCount || item.heart || 0,
      is_verified: user.verified || item.verified || false,
      profile_url: `https://www.tiktok.com/@${user.uniqueId || user.username || item.uniqueId || ''}`,
      avatar_url: user.avatarLarger || user.avatarMedium || item.avatarLarger || '',
      engagement_rate: 0,
    };
  }

  // Format D: Okänt — logga och returnera null
  return null;
}

// ============================================================
// APIFY ACTOR RUNNER
// ============================================================

/**
 * Kör en Apify actor synkront (väntar på resultat).
 *
 * Använder Apify REST API:
 *   POST /v2/acts/{actorId}/run-sync-get-dataset-items
 *   → Startar actor, väntar på resultat, returnerar dataset-items
 */
async function runApifyActor(actorId, input, timeoutSecs = 60) {
  const token = getToken();

  // Encode actor ID (username/name → username~name)
  const encodedId = actorId.replace('/', '~');

  const url = `${APIFY_BASE}/acts/${encodedId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

  console.log(`[Apify] Kör actor ${actorId} med ${JSON.stringify(input).slice(0, 150)}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apify ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();

  // run-sync-get-dataset-items returnerar en array direkt
  const items = Array.isArray(data) ? data : (data.items || data.data || []);
  console.log(`[Apify] Actor ${actorId} klar, ${items.length} resultat`);

  trackApiCost({ service: 'apify', endpoint: actorId, details: `${items.length} profiles` });

  return items;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Beräkna engagement rate för Instagram
 * (avg likes per post / followers) * 100
 */
function calculateEngagement(raw) {
  const followers = raw.followersCount || raw.followers || 0;
  if (!followers) return 0;

  // Om vi har latestPosts, beräkna snitt
  const posts = raw.latestPosts || raw.recentPosts || [];
  if (posts.length > 0) {
    const totalLikes = posts.reduce((sum, p) => sum + (p.likesCount || p.likes || 0), 0);
    const avgLikes = totalLikes / posts.length;
    return Math.round((avgLikes / followers) * 10000) / 100; // 2 decimaler
  }

  return 0;
}

/**
 * Beräkna engagement rate för TikTok
 */
function calculateTikTokEngagement(stats, raw) {
  const followers = stats?.followerCount || raw?.followerCount || raw?.fans || 0;
  const videos = stats?.videoCount || raw?.videoCount || 0;
  const likes = stats?.heartCount || raw?.heartCount || raw?.heart || 0;

  if (!followers || !videos) return 0;

  const avgLikesPerVideo = likes / videos;
  return Math.round((avgLikesPerVideo / followers) * 10000) / 100;
}

/**
 * Formatera följarantal till läsbar sträng
 */
function formatFollowers(count) {
  if (!count || count === 0) return '0';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`.replace('.0K', 'K');
  return count.toString();
}

/**
 * Merga enrichment-data in i befintlig influencer-objekt.
 * Enrichment-data (verifierad) skriver över AI-uppskattad data.
 */
function mergeEnrichment(original, enriched) {
  const followerCount = enriched.followers || original.foljare_exakt || original.followers || 0;

  // Apify returnerade profilen men den kan vara tom/privat/borttagen.
  // Verifiera bara om vi faktiskt fick meningsfull data (followers > 0 eller bio finns).
  const hasRealData = followerCount > 0 || !!enriched.bio;

  if (!hasRealData) {
    console.log(`[Enrichment] ⚠️ Spökprofil: @${enriched.username || original.handle} returnerades av Apify men har 0 followers och ingen bio — markeras EJ som verifierad`);
  }

  return {
    ...original,
    // Verifierad data överskriver
    foljare_exakt: followerCount,
    followers: followerCount,
    foljare: formatFollowers(followerCount),
    beskrivning: enriched.bio || original.beskrivning,
    bio: enriched.bio || original.bio,
    thumbnail: enriched.avatar_url || original.thumbnail,
    avatar_url: enriched.avatar_url || original.avatar_url,
    profile_url: enriched.profile_url || original.profile_url,
    engagement_rate: enriched.engagement_rate || original.engagement_rate,
    videoCount: enriched.posts_count || original.videoCount,
    posts_count: enriched.posts_count || original.posts_count,
    kontakt_info: enriched.website || original.kontakt_info,

    // Meta — bara verifierad om Apify hade riktig data
    verifierad: hasRealData,
    datakalla: original.datakalla || (hasRealData ? `apify_${enriched.platform}` : 'ai_estimated'),
    enrichment_kalla: hasRealData ? `apify_${enriched.platform}` : null,
    is_verified_platform: enriched.is_verified,
    is_business: enriched.is_business,
    category: enriched.category || original.category,
  };
}

// ============================================================
// TEST / DIAGNOSTIK
// ============================================================

export async function testConnection() {
  if (!isApifyConfigured()) {
    return { ok: false, error: 'APIFY_API_TOKEN saknas i .env' };
  }

  try {
    // Testa med ett enkelt API-anrop (hämta user info)
    const token = getToken();
    const res = await fetch(`${APIFY_BASE}/users/me?token=${token}`);

    if (!res.ok) {
      throw new Error(`Apify API ${res.status}`);
    }

    const user = await res.json();
    return {
      ok: true,
      source: 'apify',
      username: user.data?.username || 'unknown',
      plan: user.data?.plan?.id || 'free',
      credits_remaining: user.data?.plan?.monthlyUsageCreditsUsd
        ? `$${user.data.plan.monthlyUsageCreditsUsd}`
        : 'okänt',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
