import fetch from 'node-fetch';
import { trackApiCost } from './cost-tracker.js';

/**
 * Apify Discovery Service — Steg 2 i influencer-pipeline
 *
 * Använder Apify-scrapade hashtag/sökresultat för att HITTA influencers
 * (till skillnad från social-enrichment.js som VERIFIERAR kända profiler).
 *
 * Actors:
 *   Instagram: apify/instagram-scraper (hashtag-sökning → posts med owner-info)
 *   TikTok:    clockworks/tiktok-scraper (hashtag-sökning → videos med authorMeta)
 *
 * Flöde:
 *   1. AI genererar relevanta hashtags baserat på företagets nisch
 *   2. Apify scrapar posts/videos från dessa hashtags
 *   3. Vi extraherar unika creators/authors från resultaten
 *   4. Dessa matas till Claude (Steg 3) tillsammans med SerpAPI-resultat
 */

const APIFY_BASE = 'https://api.apify.com/v2';

const DISCOVERY_ACTORS = {
  instagram: 'apify/instagram-scraper',
  tiktok: 'clockworks/tiktok-scraper',
};

export function isApifyConfigured() {
  return !!process.env.APIFY_API_TOKEN;
}

function getToken() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN saknas');
  return token;
}

// ============================================================
// HUVUDFUNKTION — Sök influencers via hashtags
// ============================================================

/**
 * Kör Apify discovery för Instagram och TikTok parallellt.
 * Returnerar en lista med unika creators (namn, handle, plattform, followers).
 *
 * @param {string[]} hashtags - Relevanta hashtags att söka (utan #)
 * @param {string[]} platforms - ['instagram', 'tiktok']
 * @param {object} options - { maxResultsPerHashtag, timeoutSecs }
 * @returns {{ instagram: object[], tiktok: object[] }}
 */
export async function discoverInfluencers(hashtags, platforms = ['instagram', 'tiktok'], options = {}) {
  if (!isApifyConfigured()) {
    console.log('[ApifyDiscovery] APIFY_API_TOKEN saknas — skippar discovery');
    return { instagram: [], tiktok: [] };
  }

  if (!hashtags?.length) {
    console.log('[ApifyDiscovery] Inga hashtags att söka');
    return { instagram: [], tiktok: [] };
  }

  const { maxResultsPerHashtag = 30, timeoutSecs = 120 } = options;

  console.log(`[ApifyDiscovery] Söker influencers via hashtags: ${hashtags.join(', ')}`);
  console.log(`[ApifyDiscovery] Plattformar: ${platforms.join(', ')}, max ${maxResultsPerHashtag} resultat/hashtag`);

  const results = { instagram: [], tiktok: [] };

  const promises = [];

  if (platforms.includes('instagram')) {
    promises.push(
      discoverInstagram(hashtags, maxResultsPerHashtag, timeoutSecs)
        .then(creators => { results.instagram = creators; })
        .catch(err => {
          console.error('[ApifyDiscovery] Instagram discovery fel:', err.message);
        })
    );
  }

  if (platforms.includes('tiktok')) {
    promises.push(
      discoverTikTok(hashtags, maxResultsPerHashtag, timeoutSecs)
        .then(creators => { results.tiktok = creators; })
        .catch(err => {
          console.error('[ApifyDiscovery] TikTok discovery fel:', err.message);
        })
    );
  }

  await Promise.all(promises);

  console.log(`[ApifyDiscovery] Resultat: ${results.instagram.length} Instagram-creators, ${results.tiktok.length} TikTok-creators`);
  return results;
}

// ============================================================
// INSTAGRAM DISCOVERY — hashtag-sökning
// ============================================================

async function discoverInstagram(hashtags, maxResults, timeoutSecs) {
  // Bygg hashtag-URLs för Instagram
  const directUrls = hashtags.slice(0, 3).map(tag =>
    `https://www.instagram.com/explore/tags/${encodeURIComponent(tag.replace(/^#/, ''))}/`
  );

  console.log(`[ApifyDiscovery] Instagram hashtag-URLs: ${directUrls.join(', ')}`);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.instagram,
    {
      directUrls,
      resultsType: 'posts',
      resultsLimit: maxResults,
      searchType: 'hashtag',
      searchLimit: 1,
      addParentData: false,
    },
    timeoutSecs
  );

  if (!items?.length) {
    console.log('[ApifyDiscovery] Instagram: inga posts hittade');
    return [];
  }

  console.log(`[ApifyDiscovery] Instagram: ${items.length} posts hittade, extraherar creators...`);

  // Extrahera unika creators från posts
  const creatorMap = new Map();

  for (const post of items) {
    const owner = post.ownerUsername || post.owner?.username || post.username;
    if (!owner) continue;

    const key = owner.toLowerCase();
    if (creatorMap.has(key)) {
      // Uppdatera post-count
      creatorMap.get(key).posts_found++;
      continue;
    }

    creatorMap.set(key, {
      handle: owner,
      platform: 'instagram',
      full_name: post.ownerFullName || post.owner?.fullName || '',
      bio: '', // Inte tillgänglig i posts — fylls i av enrichment (Steg 5)
      followers: null, // Inte tillgänglig — fylls i av enrichment
      posts_found: 1, // Antal posts vi hittade i hashtag-sökningen
      hashtag_source: post.hashtags?.slice(0, 5) || [],
      profile_url: `https://www.instagram.com/${owner}/`,
      is_verified: post.ownerIsVerified || false,
      post_likes: post.likesCount || post.likes || 0,
      post_comments: post.commentsCount || post.comments || 0,
      datakalla: 'apify_ig_discovery',
    });
  }

  const creators = Array.from(creatorMap.values());

  // Sortera efter engagemang (posts_found * likes) — mer aktiva creators först
  creators.sort((a, b) => {
    const scoreA = a.posts_found * (a.post_likes || 1);
    const scoreB = b.posts_found * (b.post_likes || 1);
    return scoreB - scoreA;
  });

  console.log(`[ApifyDiscovery] Instagram: ${creators.length} unika creators extraherade`);
  return creators.slice(0, 30); // Max 30 unika creators
}

// ============================================================
// TIKTOK DISCOVERY — hashtag-sökning
// ============================================================

async function discoverTikTok(hashtags, maxResults, timeoutSecs) {
  // clockworks/tiktok-scraper tar hashtags som array
  const cleanHashtags = hashtags.slice(0, 3).map(tag => tag.replace(/^#/, ''));

  console.log(`[ApifyDiscovery] TikTok hashtags: ${cleanHashtags.join(', ')}`);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.tiktok,
    {
      hashtags: cleanHashtags,
      resultsPerPage: maxResults,
    },
    timeoutSecs
  );

  if (!items?.length) {
    console.log('[ApifyDiscovery] TikTok: inga videos hittade');
    return [];
  }

  console.log(`[ApifyDiscovery] TikTok: ${items.length} videos hittade, extraherar creators...`);

  // Extrahera unika creators från videos
  const creatorMap = new Map();

  for (const item of items) {
    // TikTok scraper returnerar videos med authorMeta
    const author = item.authorMeta || item.author || {};
    const username = author.name || author.uniqueId || author.id || item.authorId || '';
    if (!username) continue;

    const key = username.toLowerCase();
    if (creatorMap.has(key)) {
      creatorMap.get(key).videos_found++;
      continue;
    }

    creatorMap.set(key, {
      handle: username,
      platform: 'tiktok',
      full_name: author.nickName || author.nickname || author.name || '',
      bio: author.signature || author.bio || '',
      followers: author.fans || author.followers || author.followerCount || null,
      videos_found: 1,
      hashtag_source: (item.hashtags || []).map(h => h.name || h).slice(0, 5),
      profile_url: `https://www.tiktok.com/@${username}`,
      is_verified: author.verified || false,
      video_plays: item.playCount || item.plays || 0,
      video_likes: item.diggCount || item.likes || 0,
      datakalla: 'apify_tt_discovery',
    });
  }

  const creators = Array.from(creatorMap.values());

  // Sortera efter engagemang
  creators.sort((a, b) => {
    const scoreA = a.videos_found * (a.video_plays || 1);
    const scoreB = b.videos_found * (b.video_plays || 1);
    return scoreB - scoreA;
  });

  console.log(`[ApifyDiscovery] TikTok: ${creators.length} unika creators extraherade`);
  return creators.slice(0, 30);
}

// ============================================================
// APIFY ACTOR RUNNER (shared med social-enrichment.js)
// ============================================================

async function runApifyActor(actorId, input, timeoutSecs = 120) {
  const token = getToken();
  const encodedId = actorId.replace('/', '~');

  const url = `${APIFY_BASE}/acts/${encodedId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

  console.log(`[ApifyDiscovery] Kör actor ${actorId} med input: ${JSON.stringify(input).slice(0, 200)}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apify ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const items = Array.isArray(data) ? data : (data.items || data.data || []);

  console.log(`[ApifyDiscovery] Actor ${actorId} klar, ${items.length} items`);

  trackApiCost({ service: 'apify', endpoint: `discovery_${actorId}`, details: `${items.length} items` });

  return items;
}

/**
 * Formatera Apify discovery-resultat till text som Claude kan analysera.
 * Används i Steg 3 när Claude tolkar alla resultat.
 */
export function formatDiscoveryForClaude(discoveryResults) {
  const parts = [];

  if (discoveryResults.instagram?.length > 0) {
    parts.push('APIFY INSTAGRAM DISCOVERY (hittade via hashtag-sökning):');
    for (const c of discoveryResults.instagram.slice(0, 20)) {
      const line = [
        `  @${c.handle}`,
        c.full_name ? `(${c.full_name})` : '',
        c.is_verified ? '[✓ Verifierad]' : '',
        `— ${c.posts_found} posts i hashtaggen`,
        c.post_likes ? `(${c.post_likes} likes senaste post)` : '',
      ].filter(Boolean).join(' ');
      parts.push(line);
    }
  }

  if (discoveryResults.tiktok?.length > 0) {
    parts.push('\nAPIFY TIKTOK DISCOVERY (hittade via hashtag-sökning):');
    for (const c of discoveryResults.tiktok.slice(0, 20)) {
      const line = [
        `  @${c.handle}`,
        c.full_name ? `(${c.full_name})` : '',
        c.is_verified ? '[✓ Verifierad]' : '',
        c.followers ? `${c.followers} followers` : '',
        `— ${c.videos_found} videos i hashtaggen`,
        c.video_plays ? `(${c.video_plays} visningar)` : '',
        c.bio ? `Bio: "${c.bio.slice(0, 80)}"` : '',
      ].filter(Boolean).join(' ');
      parts.push(line);
    }
  }

  return parts.join('\n');
}
