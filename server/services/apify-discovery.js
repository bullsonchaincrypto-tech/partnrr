import fetch from 'node-fetch';
import { trackApiCost } from './cost-tracker.js';
import { enrichTikTokProfiles, enrichInstagramProfiles } from './social-enrichment.js';

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
  // Instagram: använder Reels-search-scraper (söker faktiska Reels-videos)
  // istället för instagram-search-scraper (som googlar profiler).
  // Reels-search hittar CREATORS som faktiskt postar content,
  // istället för företag med bra Google SEO.
  instagram: 'patient_discovery/instagram-search-reels',
  tiktok: 'clockworks/tiktok-scraper',
};

// Max 15 items per plattform
// Instagram: 5 söktermer × 3 results = 15 profiler
// TikTok: 5 söktermer × 3 profiler = 15 profiler
const MAX_CREATORS_PER_PLATFORM = 15;

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

  // Domän-suffix i användarnamn (miniprojektor.se, some.com, .com.pe etc.)
  if (/\.(se|com|nu|net|shop|store|io)(\.\w{2,3})?$/i.test(u)) return true;

  // Vanliga företagssuffix i användarnamn
  if (/_?(shop|butik|store|ab|sverige|sweden|official|solution|solutions)$/i.test(u)) return true;

  // Sverige-/sweden-suffix (oavsett position) tyder på företag
  // T.ex. smartai.sverige, vvsmiljotekniksverige, smartshopsverige
  if (/\.sverige$|\.sweden$/i.test(u)) return true;
  if (/(shop|butik|store)sverige|sverige(shop|butik|store)/i.test(u)) return true;

  // Företagsverksamhets-ord i användarnamn (svensktekniker, svensktadteknik etc.)
  // "tekniker" / "teknik" som suffix utan personnamn → företag
  if (/^(svensk|svenska|svenske)(tekniker|stadteknik|stadteknik|pyroteknik|miljoteknik)/i.test(u)) return true;
  if (/(tekniker|miljoteknik|miljöteknik|stadteknik|städteknik|pyroteknik)$/i.test(u)) return true;

  // "tekniksolution(s)", "teknikservice" — företag
  if (/(teknik|tjanst|tjänst)(s|service|solution|solutions|akut|ab)$/i.test(u)) return true;

  // College, skola, utbildning
  if (/(college|gymnasium|skola|utbildning|university|hogskola|högskola)/i.test(u)) return true;

  // Generella företags-/e-handels-ord
  if (/(reserv|reservdelar|begagnat|outlet|sale)/i.test(u)) return true;

  // Full name innehåller "AB" som eget ord eller företagsindikatorer
  if (/\b(ab|aktiebolag)\b/i.test(n)) return true;
  if (/\b(butik|shop|store|återförsäljare|aterforsaljare|kedja|firma|företag|foretag)\b/i.test(n)) return true;
  if (/\b(vitvaror|elektronik|tjänst|tjanst|service|installation)\b/i.test(n)) return true;
  if (/\b(college|gymnasium|skola|utbildning)\b/i.test(n)) return true;

  // Användarnamn som innehåller brand-mönster
  if (/_?(elon|power|mediamarkt|netonnet|matsmart|capellmobler)/.test(u)) return true;

  return false;
}

/**
 * Försöker avgöra om ett konto är internationellt (inte svenskt).
 * Vi vill bara ha svenska creators så icke-svenska filtreras bort.
 */
function isInternationalAccount(username, fullName, bio) {
  const u = (username || '').toLowerCase();
  const n = (fullName || '').toLowerCase();
  const b = (bio || '').toLowerCase();

  // TLD-suffix i användarnamn som indikerar utländskt land
  // .sv = El Salvador, .pe = Peru, .mx = Mexico, .br = Brasilien, .ar = Argentina
  if (/\.(sv|pe|mx|br|ar|cl|co|us|uk|de|fr|es|it|pt|ru|tr|in|pk|bd|ph|id)(\.\w{2,3})?$/i.test(u)) return true;
  if (/\.com\.(sv|pe|mx|br|ar|cl|co|tr|in|ph|id)$/i.test(u)) return true;

  // Bio innehåller landskoder/flaggor som inte är svenska
  // 🇪🇸 🇲🇽 🇵🇪 🇸🇻 🇮🇳 etc.
  if (/[🇪🇲🇵🇸🇮🇧🇦🇨🇰🇹🇷]🇸/.test(b)) {
    // Innehåller en utländsk flagga — kolla om det INTE är svensk flagga (🇸🇪)
    if (!b.includes('🇸🇪')) return true;
  }

  // Vanliga utländska språk-indikatorer i bio
  // Spanska: "hola", "venta", "tienda", "envío"
  // Engelska bio är OK (många svenskar skriver på engelska)
  if (/\b(hola|venta|tienda|envío|envios|gratis a domicilio)\b/i.test(b)) return true;
  // Arabiska/persiska tecken
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(b) || /[\u0600-\u06FF\u0750-\u077F]/.test(n)) return true;
  // Azerbajdzjanska/turkiska specifika tecken kombinerat med icke-svensk text
  if (/(ağıllı|gözəl|ev sistemləri)/i.test(b) || /(ağıllı|gözəl|ev sistemləri)/i.test(n)) return true;

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
 * Båda använder nu user-search (sökord → profiler) istället för hashtag-search.
 *
 * @param {object} queries - { igSearchTerms: string[], ttSearchTerms: string[] }
 *   - igSearchTerms: för Instagram (apify/instagram-search-scraper, user mode)
 *   - ttSearchTerms: för TikTok (clockworks/tiktok-scraper, /user mode)
 * @param {string[]} platforms - ['instagram', 'tiktok']
 * @param {object} options - { timeoutSecs }
 * @returns {{ instagram: object[], tiktok: object[] }}
 */
export async function discoverInfluencers(queries, platforms = ['instagram', 'tiktok'], options = {}) {
  if (!isApifyConfigured()) {
    console.log('[ApifyDiscovery] APIFY_API_TOKEN saknas — skippar discovery');
    return { instagram: [], tiktok: [] };
  }

  // Backwards-kompatibilitet: om queries är en array → använd för båda plattformar
  let igSearchTerms = [];
  let ttSearchTerms = [];
  if (Array.isArray(queries)) {
    igSearchTerms = queries;
    ttSearchTerms = queries;
  } else if (queries && typeof queries === 'object') {
    igSearchTerms = queries.igSearchTerms || queries.searchTerms || [];
    ttSearchTerms = queries.ttSearchTerms || queries.searchTerms || queries.igSearchTerms || [];
  }

  if (!igSearchTerms.length && !ttSearchTerms.length) {
    console.log('[ApifyDiscovery] Inga söktermer att söka');
    return { instagram: [], tiktok: [] };
  }

  const { timeoutSecs = 120 } = options;

  console.log(`[ApifyDiscovery] ========================================`);
  console.log(`[ApifyDiscovery] IG söktermer (${igSearchTerms.length}): ${igSearchTerms.join(' | ')}`);
  console.log(`[ApifyDiscovery] TT söktermer (${ttSearchTerms.length}): ${ttSearchTerms.join(' | ')}`);
  console.log(`[ApifyDiscovery] Plattformar: ${platforms.join(', ')}`);
  console.log(`[ApifyDiscovery] APIFY_API_TOKEN: ${process.env.APIFY_API_TOKEN ? '✅ satt (' + process.env.APIFY_API_TOKEN.slice(0, 8) + '...)' : '❌ SAKNAS'}`);
  console.log(`[ApifyDiscovery] Actors: IG=${DISCOVERY_ACTORS.instagram}, TT=${DISCOVERY_ACTORS.tiktok}`);

  const results = { instagram: [], tiktok: [] };

  const promises = [];

  if (platforms.includes('instagram') && igSearchTerms.length) {
    promises.push(
      discoverInstagramViaReels(igSearchTerms, timeoutSecs)
        .then(creators => { results.instagram = creators; })
        .catch(err => {
          console.error('[ApifyDiscovery] Instagram discovery fel:', err.message);
        })
    );
  }

  if (platforms.includes('tiktok') && ttSearchTerms.length) {
    promises.push(
      discoverTikTokViaSearch(ttSearchTerms, timeoutSecs)
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
// INSTAGRAM DISCOVERY — patient_discovery/instagram-search-reels (PRIMÄR)
// ============================================================
// Söker faktiska Instagram Reels-videos per sökterm → hittar CREATORS
// som faktiskt postar content (inte företag med bra Google SEO).
// Returnerar reels med user-info; vi dedup:ar per username och berikar
// top 15 med apify/instagram-profile-scraper för followers + bio.
//
// Pricing: $2.50/1000 reels × ~10 reels/term × 5 termer = ~$0.13 + enrichment
//
// Actor input per run: { query: string, maxPages: 1 } — endast 1 query/run,
// så vi kör 5 runs parallellt.

export async function discoverInstagramViaReels(searchTerms, timeoutSecs = 120) {
  const terms = searchTerms.slice(0, 5);
  if (!terms.length) {
    console.log('[ApifyDiscovery] Instagram-Reels: inga söktermer');
    return [];
  }

  console.log(`[ApifyDiscovery] Instagram-Reels: söker ${terms.length} termer parallellt: ${terms.join(' | ')}`);

  // Kör en run per sökterm parallellt (actor accepterar bara 1 query/run)
  const runs = terms.map(query =>
    runApifyActor(
      DISCOVERY_ACTORS.instagram,
      { query, maxPages: 1 },
      timeoutSecs
    ).catch(err => {
      console.warn(`[ApifyDiscovery] Reels-search "${query}" misslyckades: ${err.message}`);
      return [];
    })
  );

  const allReelsArrays = await Promise.all(runs);
  const allReels = allReelsArrays.flat();

  if (!allReels.length) {
    console.log('[ApifyDiscovery] Instagram-Reels: 0 reels totalt');
    return [];
  }

  console.log(`[ApifyDiscovery] Instagram-Reels: ${allReels.length} reels totalt över ${terms.length} sökningar`);

  // Dedup:a per username — en creator kan ha flera reels i resultaten
  // Behåll bästa engagement per creator
  let skippedBusiness = 0;
  let skippedInternational = 0;
  const userMap = new Map();

  for (const reel of allReels) {
    const user = reel.user || {};
    const username = user.username || '';
    if (!username) continue;

    const fullName = user.full_name || '';
    const playCount = reel.ig_play_count || 0;
    const likeCount = reel.like_count || 0;
    const commentCount = reel.comment_count || 0;
    const shareCount = reel.share_count || 0;
    const captionText = reel.caption?.text || '';
    // Engagement-score: likes + comments*5 + shares*10 (shares vägs tyngst, signalerar verkligt värde)
    const engagementScore = likeCount + (commentCount * 5) + (shareCount * 10);

    // Internationell-filter
    if (isInternationalAccount(username, fullName, captionText)) {
      skippedInternational++;
      continue;
    }

    // Företagskonto-filter
    if (isBusinessAccount(username, fullName)) {
      skippedBusiness++;
      continue;
    }

    const key = username.toLowerCase();
    const existing = userMap.get(key);
    if (existing) {
      // Uppdatera om denna reel har bättre engagement
      existing.engagement_score += engagementScore;
      existing.reels_found++;
      if (playCount > existing.video_plays) existing.video_plays = playCount;
    } else {
      userMap.set(key, {
        handle: sanitizeString(username),
        platform: 'instagram',
        full_name: sanitizeString(fullName),
        bio: '', // Fylls i av enrichment nedan
        followers: null, // Fylls i av enrichment nedan
        is_verified: user.is_verified === true,
        avatar_url: user.profile_pic_url || null,
        profile_url: `https://www.instagram.com/${username}/`,
        reels_found: 1,
        engagement_score: engagementScore,
        video_plays: playCount,
        search_term: reel.searchQuery || reel.query || null,
        datakalla: 'apify_ig_reels',
        verifierad: false, // Markeras true efter enrichment
      });
    }
  }

  // Sortera per engagement (totalt över alla matchade reels)
  const sorted = Array.from(userMap.values())
    .sort((a, b) => b.engagement_score - a.engagement_score);

  console.log(`[ApifyDiscovery] Instagram-Reels: ${allReels.length} reels → ${sorted.length} unika creators (skippat: ${skippedBusiness} företag, ${skippedInternational} internationella)`);

  // Begränsa till MAX_CREATORS_PER_PLATFORM (15) FÖRE enrichment för att hålla kostnaden nere
  const top = sorted.slice(0, MAX_CREATORS_PER_PLATFORM);

  if (top.length === 0) return top;

  // Berika med apify/instagram-profile-scraper för followers + bio
  try {
    console.log(`[ApifyDiscovery] Instagram-Reels: berikar ${top.length} creators med profile-scraper...`);
    const enriched = await enrichInstagramProfiles(top.map(c => c.handle));

    const enrichedMap = new Map();
    for (const p of enriched) {
      const h = (p.username || '').toLowerCase();
      if (h) enrichedMap.set(h, p);
    }

    let enrichedCount = 0;
    for (const c of top) {
      const match = enrichedMap.get(c.handle.toLowerCase());
      if (match) {
        enrichedCount++;
        c.full_name = c.full_name || sanitizeString(match.full_name || '');
        c.bio = sanitizeString((match.bio || '').slice(0, 300));
        c.followers = match.followers ?? c.followers;
        c.follows = match.following ?? null;
        c.posts_count = match.posts_count ?? null;
        c.is_verified = match.is_verified === true || c.is_verified;
        c.is_business = match.is_business === true;
        c.business_category = match.category || null;
        c.external_url = match.website || null;
        c.engagement_rate = match.engagement_rate || null;
        c.verifierad = true; // Nu har vi full profildata → skippa Profile Scraper i Steg 5
      }
    }
    console.log(`[ApifyDiscovery] Instagram-Reels: ${enrichedCount}/${top.length} berikade`);
  } catch (err) {
    console.warn(`[ApifyDiscovery] Instagram-Reels enrichment misslyckades (fortsätter utan): ${err.message}`);
  }

  return top;
}

// ============================================================
// INSTAGRAM DISCOVERY — apify/instagram-search-scraper (user mode)
// ============================================================
// LEGACY (pausad i influencer-flödet) — fortfarande använd i sponsor-flödet
// där vi vill hitta företag, inte creators.
//
// Söker Instagram-profiler DIREKT via sökord (inte posts via hashtags).
// Varje resultat är en riktig profil med followers, bio, verified-status.
// Pricing: $1.50/1000 → 25 results = ~$0.04 per körning.

export async function discoverInstagramViaSearch(searchTerms, timeoutSecs = 120, options = {}) {
  const { includeBusinesses = false } = options;
  // Max 5 söktermer × 3 resultat = 15 profiler totalt
  const terms = searchTerms.slice(0, 5);
  const searchString = terms.join(', ');
  const searchLimit = 3;

  console.log(`[ApifyDiscovery] Instagram-search input: search="${searchString}", type=user, limit=${searchLimit}, includeBusinesses=${includeBusinesses}`);

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
  let skippedInternational = 0;

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

    // Internationell-filter (skippas vid sponsor-sökning där vi inte bryr oss)
    if (!includeBusinesses && isInternationalAccount(username, fullName, bio)) {
      skippedInternational++;
      console.log(`[ApifyDiscovery] IG skip international: @${username} (${fullName})`);
      continue;
    }

    // Företagskonto-filter — skippas helt vid sponsor-sökning (includeBusinesses=true)
    if (!includeBusinesses) {
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

  console.log(`[ApifyDiscovery] Instagram: ${items.length} profiler → ${creators.length} unika creators (skippat: ${skippedPrivate} privata, ${skippedBusiness} företag, ${skippedInternational} internationella)`);
  return creators.slice(0, MAX_CREATORS_PER_PLATFORM);
}

// ============================================================
// TIKTOK DISCOVERY — clockworks/tiktok-scraper (user-search mode)
// ============================================================
// Använder searchQueries + searchSection='/user' för att hitta PROFILER direkt
// (istället för videos via hashtags). Ger unika creators + fans/followers direkt
// → kan skippa TikTok Profile Scraper i enrichment.
//
// 5 söktermer × 5 profiler = 25 items max. Pris: $1.70/1000 = ~$0.04 per körning.

export async function discoverTikTokViaSearch(searchTerms, timeoutSecs = 120, options = {}) {
  const { includeBusinesses = false } = options;
  // Max 5 söktermer × 3 profiler = 15 items totalt
  const terms = searchTerms.slice(0, 5);
  const maxProfilesPerQuery = 3;

  console.log(`[ApifyDiscovery] TikTok-search input: searchQueries=${JSON.stringify(terms)}, section=/user, maxProfilesPerQuery=${maxProfilesPerQuery}`);

  const items = await runApifyActor(
    DISCOVERY_ACTORS.tiktok,
    {
      searchQueries: terms,
      searchSection: '/user',           // Filtrera till user-profiler enbart
      maxProfilesPerQuery,              // 5 profiler per sökterm
      proxyCountryCode: 'SE',           // Svenska creators prioriteras
      // Fält som inte behövs (har default=false men sätter explicit för tydlighet)
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadAvatars: false,
    },
    timeoutSecs
  );

  if (!items?.length) {
    console.log('[ApifyDiscovery] TikTok: inga profiler hittade');
    return [];
  }

  console.log(`[ApifyDiscovery] TikTok: ${items.length} items från search, filtrerar...`);

  // User-search returnerar profiler (inte videos). Försök extrahera authorMeta
  // eller direkta fält — defensiv extraktion eftersom formatet kan variera.
  let skippedBusiness = 0;
  let skippedInternational = 0;
  const creatorMap = new Map();

  for (const item of items) {
    // Försök först authorMeta (om det finns), sen direkta fält på item
    const author = item.authorMeta || item.author || item;
    const username = author.name || author.uniqueId || author.id || author.username || '';
    if (!username) continue;

    const fullName = author.nickName || author.nickname || author.fullName || '';
    const bio = author.signature || author.bio || author.biography || '';
    const videoText = item.text || ''; // Video-caption innehåller ofta språk-signaler

    // Internationell-filter — kolla username, fullName och video-text
    if (isInternationalAccount(username, fullName, bio + ' ' + videoText)) {
      skippedInternational++;
      console.log(`[ApifyDiscovery] TT skip international: @${username} (${fullName})`);
      continue;
    }

    // Företagskonto-filter — skippas helt vid sponsor-sökning (includeBusinesses=true)
    if (!includeBusinesses && isBusinessAccount(username, fullName)) {
      skippedBusiness++;
      console.log(`[ApifyDiscovery] TT skip business: @${username} (${fullName})`);
      continue;
    }

    const key = username.toLowerCase();
    if (creatorMap.has(key)) continue; // samma profil från olika söktermer

    const followers = author.fans ?? author.followers ?? author.followerCount ?? null;

    creatorMap.set(key, {
      handle: sanitizeString(username),
      platform: 'tiktok',
      full_name: sanitizeString(fullName),
      bio: sanitizeString(bio.slice(0, 300)),
      followers,
      follows: author.following ?? author.followingCount ?? null,
      posts_count: author.video ?? author.videoCount ?? author.heartCount ?? null,
      likes_count: author.heart ?? author.heartCount ?? null,
      is_verified: author.verified === true,
      profile_pic_url: author.avatar || author.avatarLarger || null,
      avatar_url: author.avatarLarger || author.avatar || null,
      profile_url: `https://www.tiktok.com/@${username}`,
      search_term: item.searchQuery || item.searchTerm || null,
      datakalla: 'apify_tt_search',
      // Search-scrapern ger bio+followers direkt → skippa Profile Scraper
      verifierad: true,
    });
  }

  const creators = Array.from(creatorMap.values());

  // Sortera efter följarantal (högst först) — fallback till posts_count
  creators.sort((a, b) => {
    const fa = a.followers || 0;
    const fb = b.followers || 0;
    if (fa !== fb) return fb - fa;
    return (b.posts_count || 0) - (a.posts_count || 0);
  });

  console.log(`[ApifyDiscovery] TikTok: ${items.length} profiler → ${creators.length} unika creators (skippat: ${skippedBusiness} företag, ${skippedInternational} internationella)`);

  const topCreators = creators.slice(0, MAX_CREATORS_PER_PLATFORM);

  // Berika TT-profilerna med followers + bio via clockworks/tiktok-profile-scraper
  // Search-scrapern ger bara handle+avatar, men profile-scrapern ger full profildata.
  // Kostnad: ~$0.005 per profil × 15 = ~$0.075 per körning — värt det för bättre underlag.
  if (topCreators.length > 0) {
    try {
      console.log(`[ApifyDiscovery] TikTok: berikar ${topCreators.length} profiler med profile-scraper...`);
      const enriched = await enrichTikTokProfiles(topCreators.map(c => c.handle));

      // Bygg lookup och merge:a in followers/bio/postsCount i våra creators
      const enrichedMap = new Map();
      for (const p of enriched) {
        const handle = (p.username || p.handle || '').toLowerCase();
        if (handle) enrichedMap.set(handle, p);
      }

      let enrichedCount = 0;
      for (const c of topCreators) {
        const match = enrichedMap.get(c.handle.toLowerCase());
        if (match) {
          enrichedCount++;
          c.followers = match.followers ?? match.fans ?? c.followers;
          c.follows = match.following ?? match.follows ?? c.follows;
          c.bio = sanitizeString(match.signature || match.bio || c.bio || '').slice(0, 300);
          c.posts_count = match.videoCount ?? match.video ?? c.posts_count;
          c.likes_count = match.heartCount ?? match.heart ?? c.likes_count;
          c.is_verified = match.verified === true || c.is_verified;
          c.full_name = c.full_name || sanitizeString(match.nickname || match.nickName || '');
        }
      }
      console.log(`[ApifyDiscovery] TikTok: ${enrichedCount}/${topCreators.length} profiler berikade`);
    } catch (err) {
      console.warn(`[ApifyDiscovery] TikTok enrichment misslyckades (fortsätter utan): ${err.message}`);
    }
  }

  return topCreators;
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
    parts.push('\nAPIFY TIKTOK DISCOVERY (hittade via user-sökning — VERIFIERADE profiler):');
    for (const c of discoveryResults.tiktok.slice(0, 30)) {
      const line = [
        `  @${c.handle}`,
        c.full_name ? `(${c.full_name})` : '',
        c.is_verified ? '[✓ Verifierad]' : '',
        c.followers != null ? `${c.followers} followers` : '',
        c.posts_count ? `${c.posts_count} videos` : '',
        c.search_term ? `[hittad via "${c.search_term}"]` : '',
        c.bio ? `Bio: "${sanitizeString(c.bio).slice(0, 120)}"` : '',
      ].filter(Boolean).join(' ');
      parts.push(line);
    }
  }

  return parts.join('\n');
}
