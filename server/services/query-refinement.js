// ============================================================
// V9 Pipeline — Fas 1.5: Content-Driven Query Refinement
// ============================================================
// Efter Fas 2.5: om kandidat-pool < 500, läs sample captions från topp-20
// engagerade kandidater, låt Haiku generera 4 nya söktermer som fångar
// creators vi MISSAT (samma subnisch, annan vokabulär).
//
// Trigger: USE_QUERY_REFINEMENT=true + candidates.length < 500
// Kostnad: ~$0.013 amort.

import * as provider from './providers/social-provider.js';
import {
  ENGLISH_MAGNETS,
  BRAND_MAGNETS,
  GUARANTEED_SWEDISH_WORDS,
  CREATOR_KEYWORDS,
} from './data/brand-keywords.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = (foretag, brief, queries) => `Du är en discovery-strategikonsult för SparkCollab. Vi har just kört en
initial influencer-sökning för ${foretag.namn} i nischen
${brief.primary_niche}.

Här är 20 sample-captions från de mest engagerade kandidaterna. Läs dem och
generera 4 nya svenska söktermer som fångar creators VI MISSAT — sådana som
skriver om samma saker men använder annan vokabulär eller subnisch.

Regler:
- 4 termer, 2-4 ord var.
- Minst ett av: åäö, svensk markör ("sverige"/"svensk"/"svenska"), eller
  creator-vokabulär ("tipsar", "recenserar", "berättar").
- Inga engelska magnet-ord (tech, review, unboxing, gadget, home, ...).
- Inga brand-magnet-ord (officiell, store, AB, shop, ...).
- Maximera SKILLNAD från befintliga termer som redan kördes:
  YT: ${(queries.yt_terms || []).join(', ')}
  IG: ${(queries.ig_terms || []).join(', ')}
- Fokusera på SUBNISCHER eller vokabulär som faktiskt finns i captions.

Returnera STRIKT JSON: {"refined_terms": [4 strängar]}`;

function validateRefined(term) {
  if (!term || typeof term !== 'string') return false;
  const lc = term.toLowerCase();
  for (const m of ENGLISH_MAGNETS) if (lc.includes(m)) return false;
  for (const m of BRAND_MAGNETS) if (lc.includes(m)) return false;
  if (/[åäöÅÄÖ]/.test(term)) return true;
  if (/\b(sverige|svensk|svenska)\b/i.test(term)) return true;
  for (const w of GUARANTEED_SWEDISH_WORDS) if (lc.includes(w)) return true;
  for (const w of CREATOR_KEYWORDS) if (lc.includes(w)) return true;
  return false;
}

async function callHaiku(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[QueryRefinement] ANTHROPIC_API_KEY saknas');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`[QueryRefinement] Haiku ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON');
  return JSON.parse(m[0]);
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function normalizeIgReelToRaw(reel, query) {
  const u = reel?.user || reel?.owner || reel?.author || {};
  const caption =
    typeof reel?.caption === 'string'
      ? reel.caption
      : reel?.caption?.text || reel?.text || '';
  const likes = Number(reel?.like_count ?? 0);
  const comments = Number(reel?.comment_count ?? 0);
  const shares = Number(reel?.share_count ?? 0);
  return {
    platform: 'instagram',
    handle: u.username || '',
    name: u.full_name || u.username || '',
    bio: (u.biography || '').slice(0, 1000),
    followers: u.follower_count ?? null,
    country: null,
    default_language: null,
    external_url: u.external_url || null,
    caption_sample: (caption || '').slice(0, 500),
    engagement_signal: likes + 5 * comments + 10 * shares,
    is_business_account: u.is_business ?? null,
    business_category: u.category || null,
    is_verified: !!u.is_verified,
    discovery_source: 'refined_query',
    discovery_query: query,
    raw: reel,
    comment_depth: 0,
  };
}

/**
 * @returns {Promise<RawCandidate[]>} - nya kandidater från refined queries
 */
export async function refineQueriesFromCaptions(candidates, brief, queries, foretag, metrics = {}) {
  if (process.env.USE_QUERY_REFINEMENT !== 'true') return [];
  if (candidates.length >= 500) return [];

  // Topp-20 engagerade med caption_sample >= 50 chars
  const topEngaged = candidates
    .filter(c => (c.caption_sample || '').length >= 50)
    .sort((a, b) => (b.engagement_signal || 0) - (a.engagement_signal || 0))
    .slice(0, 20);

  if (topEngaged.length < 10) {
    console.log(`[QueryRefinement] Skipped: ${topEngaged.length} captions (< 10 krävs)`);
    return [];
  }

  const captionsText = topEngaged.map((c, i) => `- "${truncate(c.caption_sample, 300)}"`).join('\n');
  const userPrompt = `Nisch: ${brief.primary_niche}\n\nSample captions från mest engagerade kandidaterna:\n${captionsText}`;

  let refinedTerms = [];
  try {
    const raw = await callHaiku(SYSTEM_PROMPT(foretag, brief, queries), userPrompt);
    const parsed = parseJson(raw);
    refinedTerms = (parsed.refined_terms || []).filter(validateRefined).slice(0, 4);
  } catch (err) {
    console.warn(`[QueryRefinement] Skipped: Haiku error — ${err.message}`);
    return [];
  }

  if (refinedTerms.length === 0) {
    console.log('[QueryRefinement] Inga giltiga refined-termer — skip');
    return [];
  }

  console.log(`[QueryRefinement] Generated ${refinedTerms.length} refined terms: [${refinedTerms.join(', ')}]`);

  // Sekundär discovery — parallella IG+TT per term
  const newCandidates = [];
  for (const term of refinedTerms) {
    const [igResult, ttResult] = await Promise.all([
      provider.searchReels(term, 20).catch(err => {
        console.warn(`[QueryRefinement][IG] "${term}" → ${err.message}`);
        return { items: [] };
      }),
      provider.searchTikTokVideo(term, 10).catch(err => {
        console.warn(`[QueryRefinement][TT] "${term}" → ${err.message}`);
        return { items: [] };
      }),
    ]);
    const igItems = (igResult.items || []).map(it => ({ ...it, discovery_source: 'refined_query', discovery_query: term }));
    const ttItems = (ttResult.items || []).map(it => ({ ...it, discovery_source: 'refined_query', discovery_query: term }));
    newCandidates.push(...igItems, ...ttItems);
  }

  metrics.query_refinement_triggered = true;
  console.log(`[QueryRefinement] Sekundär discovery added ${newCandidates.length} raw candidates`);
  return newCandidates;
}

export const __test__ = { validateRefined };
