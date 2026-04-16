// ============================================================
// V9 Pipeline — Fas 2 (IG): Apify Hashtag Discovery
// ============================================================
// Alternativ till Serper Google-dork discovery.
// Söker på Instagram-hashtags via Apify och extraherar PROFILER
// som faktiskt postar med dessa hashtags = creators, inte brands.
//
// Strategi:
//   AI-genererade hashtags (6 st från brief-interpreter)
//   Apify "apify/instagram-hashtag-scraper" per hashtag
//   Extrahera unika profiler från poster
//   Budget: ~6 Apify-runs × $0.01 = ~$0.06
//
// Toggle: IG_DISCOVERY_MODE=hashtag (default) | serper
// Output: RawCandidate[] med handle, namn, bio (från post-author).

import { runApifyActor } from './social-enrichment.js';

// Apify actor för hashtag-scraping
const HASHTAG_ACTOR = 'apify/instagram-hashtag-scraper';
// Fallback — populära alternativ
const HASHTAG_ACTOR_ALT = 'reGROWth/instagram-scraper-hashtag';

const MAX_POSTS_PER_TAG = parseInt(process.env.IG_HASHTAG_MAX_POSTS) || 30;
const TIMEOUT_SECS = 120;

/**
 * Hämta profiler från en Instagram-hashtag via Apify.
 * Returnerar array av { handle, name, bio, followers, ... } objekt.
 */
async function scrapeHashtag(tag, metrics) {
  const cleanTag = tag.replace(/^#/, '').toLowerCase().trim();
  if (!cleanTag) return [];

  console.log(`[Discovery][IG-Hashtag] Scraping #${cleanTag} (max ${MAX_POSTS_PER_TAG} posts)...`);

  try {
    const items = await runApifyActor(
      HASHTAG_ACTOR,
      {
        hashtags: [cleanTag],
        resultsLimit: MAX_POSTS_PER_TAG,
      },
      TIMEOUT_SECS
    );

    if (!items || items.length === 0) {
      console.log(`[Discovery][IG-Hashtag] #${cleanTag}: 0 posts`);
      return [];
    }

    // Extrahera unika profiler från posterna
    const profileMap = new Map();
    for (const post of items) {
      const owner = post.ownerUsername || post.owner?.username || post.username || '';
      if (!owner) continue;
      const handle = owner.toLowerCase().replace(/^@/, '');
      if (!handle || handle.length > 30) continue;

      if (!profileMap.has(handle)) {
        profileMap.set(handle, {
          handle,
          name: post.ownerFullName || post.owner?.fullName || post.fullName || handle,
          platform: 'instagram',
          bio: '', // Filled during enrichment
          followers: null, // Filled during enrichment
          total_reach: null,
          default_language: null,
          external_url: null,
          caption_sample: (post.caption || post.text || '').slice(0, 500),
          engagement_signal: 0,
          is_business_account: null,
          business_category: null,
          is_verified: post.ownerIsVerified || false,
          discovery_source: 'hashtag',
          discovery_query: `#${cleanTag}`,
          _hashtag_posts: 1,
          _hashtag_likes: post.likesCount || post.likes || 0,
        });
      } else {
        const existing = profileMap.get(handle);
        existing._hashtag_posts++;
        existing._hashtag_likes += (post.likesCount || post.likes || 0);
        // Ta caption från post med flest likes som sample
        if ((post.likesCount || 0) > 0 && (!existing.caption_sample || existing.caption_sample.length < 10)) {
          existing.caption_sample = (post.caption || post.text || '').slice(0, 500);
        }
      }
    }

    const profiles = Array.from(profileMap.values());
    console.log(`[Discovery][IG-Hashtag] #${cleanTag}: ${items.length} posts → ${profiles.length} unika profiler`);

    if (metrics) {
      metrics.hashtag_posts = (metrics.hashtag_posts || 0) + items.length;
      metrics.hashtag_profiles = (metrics.hashtag_profiles || 0) + profiles.length;
    }

    return profiles;
  } catch (err) {
    console.error(`[Discovery][IG-Hashtag] #${cleanTag} failed: ${err.message}`);
    // Prova alternativ actor
    try {
      console.log(`[Discovery][IG-Hashtag] Testar alternativ actor: ${HASHTAG_ACTOR_ALT}`);
      const items = await runApifyActor(
        HASHTAG_ACTOR_ALT,
        {
          hashtags: [cleanTag],
          resultsLimit: MAX_POSTS_PER_TAG,
        },
        TIMEOUT_SECS
      );
      if (!items || items.length === 0) return [];

      const profileMap = new Map();
      for (const post of items) {
        const owner = post.ownerUsername || post.owner?.username || post.username || '';
        if (!owner) continue;
        const handle = owner.toLowerCase().replace(/^@/, '');
        if (!handle || handle.length > 30) continue;

        if (!profileMap.has(handle)) {
          profileMap.set(handle, {
            handle,
            name: post.ownerFullName || post.owner?.fullName || handle,
            platform: 'instagram',
            bio: '',
            followers: null,
            total_reach: null,
            default_language: null,
            external_url: null,
            caption_sample: (post.caption || post.text || '').slice(0, 500),
            engagement_signal: 0,
            is_business_account: null,
            business_category: null,
            is_verified: false,
            discovery_source: 'hashtag',
            discovery_query: `#${cleanTag}`,
            _hashtag_posts: 1,
            _hashtag_likes: post.likesCount || post.likes || 0,
          });
        } else {
          const existing = profileMap.get(handle);
          existing._hashtag_posts++;
        }
      }
      const profiles = Array.from(profileMap.values());
      console.log(`[Discovery][IG-Hashtag] #${cleanTag} (alt actor): ${items.length} posts → ${profiles.length} unika profiler`);
      return profiles;
    } catch (err2) {
      console.error(`[Discovery][IG-Hashtag] Alt actor also failed: ${err2.message}`);
      return [];
    }
  }
}

/**
 * Kör hashtag-discovery för alla AI-genererade hashtags.
 * @param {string[]} hashtags - t.ex. ["hundgrooming", "pälsvård", "kattskötsel"]
 * @param {object} metrics
 * @returns {RawCandidate[]}
 */
export async function discoverIGViaHashtags(hashtags, metrics) {
  if (!hashtags || hashtags.length === 0) {
    console.warn('[Discovery][IG-Hashtag] Inga hashtags — returnerar tomt');
    return [];
  }

  // Ta max 6 hashtags för att hålla nere kostnad
  const tags = hashtags.slice(0, 6);
  console.log(`[Discovery][IG-Hashtag] ${tags.length} hashtags: ${tags.map(t => `#${t}`).join(', ')}`);

  // Kör 2 hashtags parallellt (undvik rate limit)
  const PARALLEL = 2;
  const allProfiles = new Map();

  for (let i = 0; i < tags.length; i += PARALLEL) {
    const batch = tags.slice(i, i + PARALLEL);
    const results = await Promise.all(
      batch.map(tag => scrapeHashtag(tag, metrics))
    );

    for (const profiles of results) {
      for (const p of profiles) {
        if (allProfiles.has(p.handle)) {
          // Merge — profilen hittad via flera hashtags
          const existing = allProfiles.get(p.handle);
          existing._hashtag_posts += p._hashtag_posts;
          existing._hashtag_likes += p._hashtag_likes;
          existing._serper_appearances = (existing._serper_appearances || 1) + 1;
          // Behåll bästa caption
          if (p.caption_sample && p.caption_sample.length > (existing.caption_sample || '').length) {
            existing.caption_sample = p.caption_sample;
          }
        } else {
          allProfiles.set(p.handle, { ...p, _serper_appearances: 1 });
        }
      }
    }

    // Liten paus mellan batches
    if (i + PARALLEL < tags.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Sortera: profiler som dök upp i fler hashtags först, sen mest likes
  const candidates = Array.from(allProfiles.values())
    .sort((a, b) => {
      if (b._serper_appearances !== a._serper_appearances) {
        return b._serper_appearances - a._serper_appearances;
      }
      return b._hashtag_likes - a._hashtag_likes;
    });

  console.log(`[Discovery][IG-Hashtag] Totalt: ${candidates.length} unika profiler från ${tags.length} hashtags`);

  if (metrics) {
    metrics.ig_hashtag_queries = tags.length;
    metrics.ig_hashtag_unique_handles = candidates.length;
  }

  return candidates;
}
