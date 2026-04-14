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
  // Instagram: bytt från hashtag-scraper till search-scraper (user mode)
  // Search-scraper hittar PROFILER direkt istället för posts per hashtag
  instagram: 'apify/instagram-search-scraper',
  tiktok: 'clockworks/tiktok-scraper',
};

// Max 25 items per plattform
// Instagram: 5 söktermer × 5 results = 25 profiler
// TikTok: 10 hashtags × 1 item = 10 videos (orörd i denna commit)
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

/**
 * Kolla om ett konto ser ut som ett företag/e-handel snarare än en influencer.
 * Företagskonton ska filtreras bort eftersom vi söker efter riktiga creators.
 */
function isBusinessAccount(username, fullName) {
  const u = (username || '').toLowerCase();
  const n = (fullName || '').toLowerCase();

  // Domän-suffix i användarnamn (miniprojektor.se, some.com)
  if (/\.(se|com|nu|net|shop|store|io)$/i.test(u)) return true;

  // Vanliga företagssuffix i användarnamn
  if (/_?(shop|butik|store|ab|sverige|sweden|official)$/i.test(u)) return true;

  // Full name innehåller "AB" som eget ord eller företagsindikatorer
  if (/\b(ab|aktiebolag)\b/i.test(n)) return true;
  if (/\b(butik|shop|store|återförsäljare|kedja)\b/i.test(n)) return true;
  if (/\b(vitvaror|elektronik|tjänst|tjanst)\b/i.test(n)) return true;

  // Användarnamn som innehåller brand-mönster
  if (/_?(elon|power|mediamarkt|netonnet)/.test(u)) return true;

  return false;
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
 *
 * @param {object} queries - { hashtags: string[], igSearchTerms: string[] }
 *   - hashtags: för TikTok (clockworks/tiktok-scraper)
 *   - igSearchTerms: för Instagram (apify/instagram-search-scraper, user mode)
 * @param {string[]} platforms - ['instagram', 'tiktok']
 * @param {object} options - { timeoutSecs }
 * @returns {{ instagram: object[], tiktok: object[] }}
 */
export async function discoverInfluencers(queries, platforms = ['instagram', 'tiktok'], options = {}) {
  if (!isApifyConfigured()) {
    console.log('[ApifyDiscovery] APIFY_API_TOKEN saknas — skippar discovery');
    return { instagram: [], tiktok: [] };
  }

  // Backwards-kompatibilitet: om queries är en array → behandla som hashtags (gamla API)
  let hashtags = [];
  let igSearchTerms = [];
  if (Array.isArray(queries)) {
    hashtags = queries;
    igSearchTerms = queries;
  } else if (queries && typeof queries === 'object') {
    hashtags = queries.hashtags || [];
    igSearchTerms = queries.igSearchTerms || queries.searchTerms || [];
  }

  if (!hashtags.length && !igSearchTerms.length) {
    console.log('[ApifyDiscovery] Inga hashtags/söktermer att söka');
    return { instagram: [], tiktok: [] };
  }

  const { timeoutSecs = 120 } = options;

  console.log(`[ApifyDiscovery] ========================================`);
  console.log(`[ApifyDiscovery] IG söktermer (${igSearchTerms.length}): ${igSearchTerms.join(' | ')}`);
  console.log(`[ApifyDiscovery] TT hashtags (${hashtags.length}): ${hashtags.join(', ')}`);
  console.log(`[ApifyDiscovery] Plattformar: ${platforms.join(', ')}`);
  console.log(`[ApifyDiscovery] APIFY_API_TOKEN: ${process.env.APIFY_API_TOKEN ? '✅ satt (' + process.env.APIFY_API_TOKEN.slice(0, 8) + '...)' : '❌ SAKNAS'}`);
  console.log(`[ApifyDiscovery] Actors: IG=${DISCOVERY_ACTORS.instagram}, TT=${DISCOVERY_ACTORS.tiktok}`);

  const results = { instagram: [], tiktok: [] };

  const promises = [];

  if (platforms.includes('instagram') && igSearchTerms.length) {
    promises.push(
      discoverInstagramViaSearch(igSearchTerms, timeoutSecs)
        .then(creators => { results.instagram = creators; })
        .catch(err => {
          console.error('[ApifyDiscovery] Instagram discovery fel:', err.message);
        })
    );
  }

  if (platforms.includes('tiktok') && hashtags.length) {
    promises.push(
      discoverTikTok(hashtags, 1, timeoutSecs)
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
// INSTAGRAM DISCOVERY — apify/instagram-search-scraper (user mode)
// ============================================================
// Söker Instagram-profiler DIREKT via sökord (inte posts via hashtags).
// Varje resultat är en riktig profil med followers, bio, verified-status.
// Pricing: $1.50/1000 → 25 results = ~$0.04 per körning.

async function discoverInstagramViaSearch(searchTerms, timeoutSecs) {
  // Max 5 söktermer × 5 resultat = 25 profiler totalt
  const terms = searchTerms.slice(0, 5);
  const searchString = terms.join(', ');
  const searchLimit = 5;

  console.log(`[ApifyDiscovery] Instagram-search input: search="${searchString}", type=user, limit=${searchLimit}`);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.instagram,
    {
      search: searchString,
      searchType: 'user',
      searchLimit: searchLimit,
    },
    timeoutSecs
  );

  if (!items?.length) {
    console.log('[ApifyDiscovery] Instagram: inga profiler hittade');
    return [];
  }

  console.log(`[ApifyDiscovery] Instagram: ${items.length} profiler hittade, filtrerar...`);

  // Filtrera bort företagskonton och extrahera creators
  let skippedPrivate = 0;
  let skippedBusiness = 0;

  const creatorMap = new Map();

  for (const profile of items) {
    const username = profile.username || '';
    const fullName = profile.fullName || '';
    const bio = profile.biography || '';

    if (!username) continue;

    // Privata profiler kan vi inte kontakta — skippa
    if (profile.private === true) {
      skippedPrivate++;
      continue;
    }

    // Företagskonto — signalerat via Instagram OCH via heuristik
    const isBiz = profile.isBusinessAccount === true || isBusinessAccount(username, fullName);
    if (isBiz) {
      // Tillåt business om kategori verkar creator-relaterad (t.ex. blogger, content creator)
      const cat = (profile.businessCategoryName || '').toLowerCase();
      const creatorCats = ['creator', 'blogger', 'influencer', 'public figure', 'personal blog', 'artist', 'writer', 'journalist'];
      const looksLikeCreator = creatorCats.some(c => cat.includes(c));
      if (!looksLikeCreator) {
        skippedBusiness++;
        console.log(`[ApifyDiscovery] IG skip business: @${username} (${fullName}) cat="${cat}"`);
        continue;
      }
    }

    const key = username.toLowerCase();
    if (creatorMap.has(key)) continue; // samma profil från olika söktermer

    creatorMap.set(key, {
      handle: sanitizeString(username),
      platform: 'instagram',
      full_name: sanitizeString(fullName),
      bio: sanitizeString(bio.slice(0, 300)),
      followers: profile.followersCount || null,
      follows: profile.followsCount || null,
      posts_count: profile.postsCount || 0,
      is_verified: profile.verified === true,
      is_business: profile.isBusinessAccount === true,
      business_category: profile.businessCategoryName || null,
      external_url: profile.externalUrl || null,
      profile_pic_url: profile.profilePicUrl || null,
      avatar_url: profile.profilePicUrlHD || profile.profilePicUrl || null,
      profile_url: profile.url || `https://www.instagram.com/${username}/`,
      search_term: profile.searchTerm || null,
      datakalla: 'apify_ig_search',
      // Search-scrapern ger redan fullständig profildata → skippa Profile Scraper
      verifierad: true,
    });
  }

  const creators = Array.from(creatorMap.values());

  // Sortera efter följarantal (högst först) — fallback till postsCount
  creators.sort((a, b) => {
    const fa = a.followers || 0;
    const fb = b.followers || 0;
    if (fa !== fb) return fb - fa;
    return (b.posts_count || 0) - (a.posts_count || 0);
  });

  console.log(`[ApifyDiscovery] Instagram: ${items.length} profiler → ${creators.length} unika creators (skippat: ${skippedPrivate} privata, ${skippedBusiness} företag)`);
  return creators.slice(0, MAX_CREATORS_PER_PLATFORM);
}

// ============================================================
// TIKTOK DISCOVERY — hashtag-sökning
// ============================================================

async function discoverTikTok(hashtags, maxResults, timeoutSecs) {
  // clockworks/tiktok-scraper tar hashtags som array — använd alla 5 från Claude
  // Använd alla 10 hashtags — 1 video per hashtag = 10 items, alla unika creators
  const cleanHashtags = hashtags.slice(0, 10).map(tag => tag.replace(/^#/, ''));

  console.log(`[ApifyDiscovery] TikTok hashtags (${cleanHashtags.length}): ${cleanHashtags.join(', ')}`);

  // 1 video per hashtag × 10 hashtags = 10 items — varje hashtag ger en unik creator
  const resultsPerHashtag = 1;

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

  // Språk-prioritet: svenska videos först, sen övriga
  // Detta säkerställer att svenska creators hamnar överst även om Apify
  // returnerade massa engelskt innehåll från generella hashtags
  const swedishItems = qualityItems.filter(item =>
    (item.textLanguage || '').toLowerCase() === 'sv'
  );
  const otherItems = qualityItems.filter(item =>
    (item.textLanguage || '').toLowerCase() !== 'sv'
  );
  const sortedItems = [...swedishItems, ...otherItems];

  console.log(`[ApifyDiscovery] TikTok: ${items.length} videos hittade, ${qualityItems.length} med engagement (${swedishItems.length} svenska, ${otherItems.length} andra språk), extraherar creators...`);

  // Extrahera unika creators från kvalitets-videos
  const creatorMap = new Map();

  for (const item of sortedItems) {
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
      video_language: (item.textLanguage || '').toLowerCase(),
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
    parts.push('APIFY INSTAGRAM DISCOVERY (hittade via user-sökning — VERIFIERADE profiler):');
    for (const c of discoveryResults.instagram.slice(0, 30)) {
      const line = [
        `  @${c.handle}`,
        c.full_name ? `(${c.full_name})` : '',
        c.is_verified ? '[✓ Verifierad]' : '',
        c.followers != null ? `${c.followers} followers` : '',
        c.posts_count ? `${c.posts_count} posts` : '',
        c.is_business ? `[biz: ${c.business_category || 'okänd'}]` : '',
        c.search_term ? `[hittad via "${c.search_term}"]` : '',
        c.bio ? `Bio: "${sanitizeString(c.bio).slice(0, 120)}"` : '',
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
