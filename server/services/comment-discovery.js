// ============================================================
// V9 Pipeline — Fas 2.6: YouTube Comment Discovery
// ============================================================
// För top-N YT-creators: hämta video-comments och extrahera @mentions av andra
// kanaler/handles. Dessa "community-engagerade" creators får +5 obscurity-bonus.
//
// Trigger: USE_COMMENT_DISCOVERY=true
// Kostnad: 0 (YouTube quota — 1 unit per commentThreads.list)

const HANDLE_MENTION_RE = /@([A-Za-z0-9._-]{3,})/g;

async function fetchTopVideoForChannel(channelId) {
  // Försök hämta senaste video från kanal via search.list
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('channelId', channelId);
  url.searchParams.set('order', 'date');
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const r = await fetch(url, { signal: timeoutSignal(10000) });
  if (!r.ok) throw new Error(`YT search ${r.status}`);
  const data = await r.json();
  return data.items?.[0]?.id?.videoId || null;
}

async function fetchComments(videoId, max = 100) {
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', String(max));
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const r = await fetch(url, { signal: timeoutSignal(10000) });
  if (!r.ok) throw new Error(`YT comments ${r.status}`);
  const data = await r.json();
  return (data.items || []).map(item =>
    item.snippet?.topLevelComment?.snippet?.textDisplay || ''
  );
}

function extractMentionsFromComments(comments) {
  const mentions = new Set();
  for (const text of comments) {
    HANDLE_MENTION_RE.lastIndex = 0;
    let m;
    while ((m = HANDLE_MENTION_RE.exec(text))) {
      const handle = m[1].toLowerCase();
      // Filtrera bort generiska/uppenbara non-handles
      if (handle.length >= 4 && !/^(here|the|youtube|user|email)$/i.test(handle)) {
        mentions.add(handle);
      }
    }
  }
  return [...mentions];
}

function timeoutSignal(ms) {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac.signal;
}

/**
 * Discover community-mentioned creators från top YT-channels' comments.
 * @param {Candidate[]} ytCandidates
 * @param {number} topN - antal kanaler att gräva i (default 10)
 * @returns {Promise<{handles: string[], depth_map: Map<handle,number>}>}
 */
export async function discoverFromComments(ytCandidates, topN = 10, metrics = {}) {
  if (process.env.USE_COMMENT_DISCOVERY !== 'true') return { handles: [], depth_map: new Map() };

  const top = [...ytCandidates]
    .filter(c => c.platform === 'youtube')
    .sort((a, b) => (b.engagement_signal || 0) - (a.engagement_signal || 0))
    .slice(0, topN);

  if (top.length === 0) return { handles: [], depth_map: new Map() };

  const depthMap = new Map();
  for (const c of top) {
    const channelId = c.youtube_channel_id || c.raw?.id;
    if (!channelId) continue;
    try {
      const vid = await fetchTopVideoForChannel(channelId);
      if (!vid) continue;
      const comments = await fetchComments(vid, 100);
      const mentions = extractMentionsFromComments(comments);
      for (const h of mentions) {
        depthMap.set(h, (depthMap.get(h) || 0) + 1);
      }
    } catch (err) {
      console.warn(`[CommentDiscovery] @${c.handle} → ${err.message}`);
    }
  }

  // Filter: handles som mentions ≥2 gånger = community-engagerade
  const handles = [...depthMap.entries()]
    .filter(([_, depth]) => depth >= 2)
    .map(([h]) => h);

  metrics.comment_discovery_channels_found = handles.length;
  console.log(`[CommentDiscovery] Top ${topN} YT-creators inspected → ${handles.length} community-mentioned handles (depth ≥2)`);
  return { handles, depth_map: depthMap };
}

export const __test__ = { extractMentionsFromComments };
