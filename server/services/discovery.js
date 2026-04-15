// ============================================================
// V9 Pipeline — Fas 2: Parallel Discovery
// ============================================================
// Orkestrerar 6 parallella lanes:
//   2.1-2.4 YouTube (relevance, viewCount, long-tail, channels.list batch)
//   2.5     IG reels-search via social-provider
//   2.6     IG hashtag-search (conditional + cached)
//   TikTok  video-search + hashtag-search
//
// Output: RawCandidate[] (typiskt 400-900 unika handles före Fas 3).

import * as provider from './providers/social-provider.js';
import { runSql, queryOne } from '../db/schema.js';

const YT_PUBLISHED_AFTER = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 18);
  return d.toISOString();
})();

const EARLY_EXIT_AT = 300;

// ============================================================
// === 2.1 + 2.2 + 2.3 YouTube search-pass =====================
// ============================================================

async function searchYTPass(term, order, publishedAfter) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('q', term);
  url.searchParams.set('regionCode', 'SE');
  url.searchParams.set('relevanceLanguage', 'sv');
  url.searchParams.set('maxResults', '50');
  url.searchParams.set('order', order);
  url.searchParams.set('publishedAfter', publishedAfter);
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`YouTube ${r.status}`);
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function gatherYTChannelIds(queries) {
  // OBS: V9 använde tidigare BÅDE relevance och viewCount-passes per term
  // (dubblerade quota från 600 till 1600 units). Nu: endast relevance per term
  // för att matcha V1's quota-budget (~800 units för 8 termer).
  const allTerms = queries.yt_terms.map(t => ({ term: t, order: 'relevance' }));
  if (process.env.USE_LONG_TAIL_QUERIES === 'true') {
    for (const t of queries.long_tail_terms || []) {
      allTerms.push({ term: t, order: 'relevance' });
    }
  }

  console.log(`[Discovery][YT] Söker ${allTerms.length} termer (quota: ~${allTerms.length * 100} units):`);
  for (const { term } of allTerms) console.log(`[Discovery][YT]   • "${term}"`);

  const channelIdSet = new Set();
  const perQueryResults = [];
  const promises = allTerms.map(({ term, order }) =>
    searchYTPass(term, order, YT_PUBLISHED_AFTER)
      .then(data => {
        const items = data.items || [];
        let newChannels = 0;
        for (const item of items) {
          const id = item.snippet?.channelId;
          if (id && !channelIdSet.has(id)) {
            channelIdSet.add(id);
            newChannels++;
          }
        }
        perQueryResults.push({ term, videos: items.length, newChannels });
      })
      .catch(err => {
        console.warn(`[Discovery][YT] "${term}" (${order}) → ${err.message}`);
        perQueryResults.push({ term, videos: 0, newChannels: 0, error: err.message });
      })
  );
  await Promise.all(promises);

  for (const r of perQueryResults) {
    const info = r.error
      ? `FEL: ${r.error}`
      : `${r.videos} videos, ${r.newChannels} nya kanaler`;
    console.log(`[Discovery][YT] "${r.term}" → ${info}`);
  }
  console.log(`[Discovery][YT] Totalt: ${channelIdSet.size} unika kanaler, ~${allTerms.length * 100} search-units förbrukade`);
  return [...channelIdSet];
}

// 2.4 channels.list batch
async function batchChannelsList(channelIds) {
  const results = [];
  for (let i = 0; i < channelIds.length && i < EARLY_EXIT_AT; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('part', 'snippet,statistics,brandingSettings');
    url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) {
        console.warn(`[Discovery][YT] channels.list batch failed ${r.status}`);
        continue;
      }
      const data = await r.json();
      results.push(...(data.items || []));
    } catch (err) {
      console.warn(`[Discovery][YT] channels.list error: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}

function normalizeYTChannel(ch, query) {
  const s = ch.snippet || {};
  const stats = ch.statistics || {};
  const country = s.country || ch.brandingSettings?.channel?.country || null;
  const lang = s.defaultLanguage || ch.brandingSettings?.channel?.defaultLanguage || null;
  return {
    platform: 'youtube',
    handle: s.customUrl || s.title || ch.id,
    name: s.title || '',
    bio: (s.description || '').slice(0, 1000),
    followers: stats.subscriberCount ? Number(stats.subscriberCount) : null,
    country,
    default_language: lang,
    external_url: null,
    caption_sample: null,
    engagement_signal: stats.viewCount ? Number(stats.viewCount) : 0,
    is_business_account: null,
    business_category: null,
    is_verified: false,
    discovery_source: 'main',
    discovery_query: query,
    raw: ch,
    comment_depth: 0,
    youtube_channel_id: ch.id,
  };
}

async function discoverYT(queries) {
  console.log('[Discovery][YT] Starting...');
  const channelIds = await gatherYTChannelIds(queries);
  console.log(`[Discovery][YT] ${channelIds.length} unika channelIds funna`);
  if (channelIds.length === 0) return [];
  const channels = await batchChannelsList(channelIds);
  return channels.map(c => normalizeYTChannel(c, queries.yt_terms[0] || ''));
}

// ============================================================
// === 2.5 + 2.6 INSTAGRAM =====================================
// ============================================================

function dedupeByHandle(arrays) {
  const seen = new Map();
  for (const arr of arrays) {
    for (const c of arr) {
      const key = `${c.platform}:${(c.handle || '').toLowerCase()}`;
      if (!key.endsWith(':')) {
        const existing = seen.get(key);
        if (!existing || (c.engagement_signal || 0) > (existing.engagement_signal || 0)) {
          seen.set(key, c);
        }
      }
    }
  }
  return [...seen.values()];
}

async function discoverIG(queries, metrics) {
  const reelPromises = (queries.ig_terms || []).map(t =>
    provider.searchReels(t, 30).catch(err => {
      console.warn(`[Discovery][IG] reels "${t}" → ${err.message}`);
      return { items: [] };
    })
  );
  const reelResults = await Promise.all(reelPromises);
  const fromReels = dedupeByHandle(reelResults.map(r => r.items || []));

  let fromHashtags = [];
  if (fromReels.length < 60 && process.env.USE_HASHTAG_DISCOVERY === 'true') {
    metrics.hashtag_triggered = true;
    const hashtagPromises = (queries.hashtag_terms || []).map(async tag => {
      try {
        const cached = await getCachedHashtag(tag, 'instagram');
        if (cached) return cached;
        const data = await provider.searchIgHashtag(tag, 20);
        await setCachedHashtag(tag, 'instagram', data);
        return data;
      } catch (err) {
        console.warn(`[Discovery][IG] hashtag "${tag}" → ${err.message}`);
        return { items: [] };
      }
    });
    const hashtagResults = await Promise.all(hashtagPromises);
    fromHashtags = dedupeByHandle(hashtagResults.map(r => r.items || []));
  }
  return dedupeByHandle([fromReels, fromHashtags]);
}

// ============================================================
// === TIKTOK ==================================================
// ============================================================

async function discoverTT(queries, metrics) {
  const videoPromises = (queries.ig_terms || []).map(t =>
    provider.searchTikTokVideo(t, 30).catch(err => {
      console.warn(`[Discovery][TT] video "${t}" → ${err.message}`);
      return { items: [] };
    })
  );
  const videoResults = await Promise.all(videoPromises);
  const fromVideos = dedupeByHandle(videoResults.map(r => r.items || []));

  let fromHashtags = [];
  if (fromVideos.length < 60 && process.env.USE_HASHTAG_DISCOVERY === 'true') {
    const hashtagPromises = (queries.hashtag_terms || []).map(async tag => {
      try {
        const cached = await getCachedHashtag(tag, 'tiktok');
        if (cached) return cached;
        const data = await provider.searchTikTokHashtag(tag, 20);
        await setCachedHashtag(tag, 'tiktok', data);
        return data;
      } catch (err) {
        console.warn(`[Discovery][TT] hashtag "${tag}" → ${err.message}`);
        return { items: [] };
      }
    });
    const hashtagResults = await Promise.all(hashtagPromises);
    fromHashtags = dedupeByHandle(hashtagResults.map(r => r.items || []));
  }
  return dedupeByHandle([fromVideos, fromHashtags]);
}

// ============================================================
// === HASHTAG-CACHE (24h TTL) =================================
// ============================================================

async function getCachedHashtag(tag, platform) {
  try {
    const r = await queryOne(
      `SELECT data FROM hashtag_cache
       WHERE tag = $1 AND platform = $2
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [tag, platform]
    );
    return r?.data || null;
  } catch { return null; }
}

async function setCachedHashtag(tag, platform, data) {
  try {
    await runSql(
      `INSERT INTO hashtag_cache (tag, platform, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (tag, platform) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()`,
      [tag, platform, JSON.stringify(data)]
    );
  } catch (err) {
    console.warn(`[Discovery] hashtag-cache write failed: ${err.message}`);
  }
}

// ============================================================
// === ENTRY POINT =============================================
// ============================================================

/**
 * @param {object} brief - Brief from Fas 0
 * @param {object} queries - Queries from Fas 1
 * @param {object} foretag - foretag-row
 * @param {string[]} platforms - which platforms to query ['youtube','instagram','tiktok']
 * @param {object} metrics - mutable metrics-bag
 * @returns {Promise<RawCandidate[]>}
 */
export async function discoverCandidates(brief, queries, foretag, platforms, metrics = {}) {
  const t0 = Date.now();
  const useYt = platforms.includes('youtube');
  const useIg = platforms.includes('instagram');
  const useTt = platforms.includes('tiktok');

  console.log(`[Discovery] Starting — platforms=[${platforms.join(',')}]`);

  const [yt, ig, tt] = await Promise.all([
    useYt ? discoverYT(queries) : Promise.resolve([]),
    useIg ? discoverIG(queries, metrics) : Promise.resolve([]),
    useTt ? discoverTT(queries, metrics) : Promise.resolve([]),
  ]);

  const all = dedupeByHandle([yt, ig, tt]);
  metrics.raw_candidates = all.length;
  console.log(`[Discovery] Done in ${Date.now() - t0}ms — yt=${yt.length}, ig=${ig.length}, tt=${tt.length}, deduped=${all.length}`);
  return all;
}

export const __test__ = { dedupeByHandle, normalizeYTChannel, getCachedHashtag, setCachedHashtag };
