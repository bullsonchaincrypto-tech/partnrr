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

// Max antal unika creators att returnera per plattform
const MAX_CREATORS_PER_PLATFORM = 25;

/**
 * Rensa trasiga unicode-surrogat ur en sträng.
 * TikTok/IG-data kan innehålla lone surrogates (t.ex. halva emojis)
 * som kraschar JSON.stringify → Claude API 400.
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str || '';
  // Ta bort lone surrogates (U+D800–U+DFFF som inte är korrekta par)
  return str.replace(/[\uD800-\uDFFF]/g, '');
}

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

  console.log(`[ApifyDiscovery] ========================================`);
  console.log(`[ApifyDiscovery] Söker influencers via hashtags: ${hashtags.join(', ')}`);
  console.log(`[ApifyDiscovery] Plattformar: ${platforms.join(', ')}, max ${maxResultsPerHashtag} resultat/hashtag`);
  console.log(`[ApifyDiscovery] APIFY_API_TOKEN: ${process.env.APIFY_API_TOKEN ? '✅ satt (' + process.env.APIFY_API_TOKEN.slice(0, 8) + '...)' : '❌ SAKNAS'}`);
  console.log(`[ApifyDiscovery] Actors: IG=${DISCOVERY_ACTORS.instagram}, TT=${DISCOVERY_ACTORS.tiktok}`);

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
  // Använd alla 5 hashtags från Claude för bredare träffyta
  const directUrls = hashtags.slice(0, 5).map(tag =>
    `https://www.instagram.com/explore/tags/${encodeURIComponent(tag.replace(/^#/, ''))}/`
  );

  console.log(`[ApifyDiscovery] Instagram hashtag-URLs: ${directUrls.join(', ')}`);

  // Begränsa till 5 posts per hashtag → 25 totalt max (5 hashtags × 5 posts)
  // Sparar pengar — vi behöver bara unika creators, inte massa posts
  const resultsPerHashtag = Math.min(maxResults, 5);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.instagram,
    {
      directUrls,
      resultsType: 'posts',
      resultsLimit: resultsPerHashtag,
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

  // Filtrera bort skräp-posts:
  // - 0 childPosts OCH 0 kommentarer = värdelöst resultat (kostar pengar utan nytta)
  // - 0 likes OCH 0 kommentarer = inget engagement
  const qualityPosts = items.filter(post => {
    const likes = post.likesCount || post.likes || 0;
    const comments = post.commentsCount || post.comments || 0;
    const childPosts = post.childPosts?.length || post.sidecardImages?.length || 0;
    // Kräv minst NÅGOT engagement eller innehåll
    if (likes === 0 && comments === 0) return false;
    return true;
  });
  console.log(`[ApifyDiscovery] Instagram: ${items.length} posts hittade, ${qualityPosts.length} med engagement (filtrerade bort ${items.length - qualityPosts.length} tomma), extraherar creators...`);

  // Extrahera unika creators från kvalitets-posts
  const creatorMap = new Map();

  for (const post of qualityPosts) {
    const owner = post.ownerUsername || post.owner?.username || post.username;
    if (!owner) continue;

    const key = owner.toLowerCase();
    if (creatorMap.has(key)) {
      const existing = creatorMap.get(key);
      existing.posts_found++;
      // Behåll bästa engagement
      existing.post_likes = Math.max(existing.post_likes, post.likesCount || post.likes || 0);
      existing.post_comments = Math.max(existing.post_comments, post.commentsCount || post.comments || 0);
      continue;
    }

    creatorMap.set(key, {
      handle: sanitizeString(owner),
      platform: 'instagram',
      full_name: sanitizeString(post.ownerFullName || post.owner?.fullName || ''),
      bio: '', // Inte tillgänglig i posts — fylls i av enrichment (Steg 5)
      followers: null, // Inte tillgänglig — fylls i av enrichment
      posts_found: 1,
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

  console.log(`[ApifyDiscovery] Instagram: ${creators.length} unika creators extraherade (filtrerade från ${items.length} posts)`);
  return creators.slice(0, MAX_CREATORS_PER_PLATFORM);
}

// ============================================================
// TIKTOK DISCOVERY — hashtag-sökning
// ============================================================

async function discoverTikTok(hashtags, maxResults, timeoutSecs) {
  // clockworks/tiktok-scraper tar hashtags som array — använd alla 5 från Claude
  const cleanHashtags = hashtags.slice(0, 5).map(tag => tag.replace(/^#/, ''));

  console.log(`[ApifyDiscovery] TikTok hashtags: ${cleanHashtags.join(', ')}`);

  // Begränsa till 5 videos per hashtag → 25 totalt max (5 hashtags × 5 videos)
  // Sparar pengar och ger ändå tillräckligt med unika creators
  const resultsPerHashtag = Math.min(maxResults, 5);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.tiktok,
    {
      hashtags: cleanHashtags,
      resultsPerPage: resultsPerHashtag,
      // searchSection gäller bara keyword-sök, INTE hashtag-sök — lämna tom
      searchSection: '',
      // Proxy via Sverige → TikTok visar svenska creators/innehåll
      proxyCountryCode: 'SE',
      maxProfilesPerQuery: 20,
    },
    timeoutSecs
  );

  if (!items?.length) {
    console.log('[ApifyDiscovery] TikTok: inga videos hittade');
    return [];
  }

  // Filtrera bort skräp-videos (0 plays OCH 0 likes = värdelös)
  const qualityItems = items.filter(item => {
    const plays = item.playCount || item.plays || 0;
    const likes = item.diggCount || item.likes || 0;
    return plays > 0 || likes > 0;
  });
  console.log(`[ApifyDiscovery] TikTok: ${items.length} videos hittade, ${qualityItems.length} med engagement, extraherar creators...`);

  // Extrahera unika creators från kvalitets-videos
  const creatorMap = new Map();

  for (const item of qualityItems) {
    // TikTok scraper returnerar videos med authorMeta
    const author = item.authorMeta || item.author || {};
    const username = author.name || author.uniqueId || author.id || item.authorId || '';
    if (!username) continue;

    const key = username.toLowerCase();
    if (creatorMap.has(key)) {
      const existing = creatorMap.get(key);
      existing.videos_found++;
      existing.video_plays = Math.max(existing.video_plays, item.playCount || item.plays || 0);
      existing.video_likes = Math.max(existing.video_likes, item.diggCount || item.likes || 0);
      continue;
    }

    creatorMap.set(key, {
      handle: sanitizeString(username),
      platform: 'tiktok',
      full_name: sanitizeString(author.nickName || author.nickname || author.name || ''),
      bio: sanitizeString(author.signature || author.bio || ''),
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

  console.log(`[ApifyDiscovery] TikTok: ${creators.length} unika creators extraherade (max ${MAX_CREATORS_PER_PLATFORM})`);
  return creators.slice(0, MAX_CREATORS_PER_PLATFORM);
}

// ============================================================
// APIFY ACTOR RUNNER (shared med social-enrichment.js)
// ============================================================

async function runApifyActor(actorId, input, timeoutSecs = 120) {
  const token = getToken();
  if (!token) {
    console.error(`[ApifyDiscovery] ❌ APIFY_API_TOKEN saknas — kan inte köra ${actorId}`);
    return [];
  }

  const encodedId = actorId.replace('/', '~');
  const url = `${APIFY_BASE}/acts/${encodedId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;

  console.log(`[ApifyDiscovery] 🚀 Kör actor ${actorId}`);
  console.log(`[ApifyDiscovery]   Input: ${JSON.stringify(input)}`);
  console.log(`[ApifyDiscovery]   Timeout: ${timeoutSecs}s`);

  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ApifyDiscovery] ❌ Actor ${actorId} — HTTP ${res.status} efter ${elapsed}s`);
      console.error(`[ApifyDiscovery]   Response: ${errText.slice(0, 500)}`);
      throw new Error(`Apify ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items || data.data || []);

    console.log(`[ApifyDiscovery] ✅ Actor ${actorId} klar — ${items.length} items på ${elapsed}s`);
    if (items.length > 0) {
      console.log(`[ApifyDiscovery]   Första item keys: ${Object.keys(items[0]).slice(0, 10).join(', ')}`);
    }

    trackApiCost({ service: 'apify', endpoint: `discovery_${actorId}`, details: `${items.length} items` });

    return items;
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (err.message?.includes('Apify')) throw err; // Redan loggat ovan
    console.error(`[ApifyDiscovery] ❌ Actor ${actorId} — nätverksfel efter ${elapsed}s: ${err.message}`);
    throw err;
  }
}

/**
 * Formatera Apify discovery-resultat till text som Claude kan analysera.
 * Används i Steg 3 när Claude tolkar alla resultat.
 */
export function formatDiscoveryForClaude(discoveryResults) {
  const parts = [];

  if (discoveryResults.instagram?.length > 0) {
    parts.push('APIFY INSTAGRAM DISCOVERY (hittade via hashtag-sökning):');
    for (const c of discoveryResults.instagram.slice(0, 30)) {
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
    for (const c of discoveryResults.tiktok.slice(0, 30)) {
      const line = [
        `  @${c.handle}`,
        c.full_name ? `(${c.full_name})` : '',
        c.is_verified ? '[✓ Verifierad]' : '',
        c.followers ? `${c.followers} followers` : '',
        `— ${c.videos_found} videos i hashtaggen`,
        c.video_plays ? `(${c.video_plays} visningar)` : '',
        c.bio ? `Bio: "${sanitizeString(c.bio).slice(0, 80)}"` : '',
      ].filter(Boolean).join(' ');
      parts.push(line);
    }
  }

  return parts.join('\n');
}
