// ============================================================
// V9 Pipeline — Fas 5.5 + 5.5+: Lookalike Expansion
// ============================================================
// First-degree: top 10 confirmed creators' related_profiles + brief seeds.
// Second-degree (FoF): top 5 first-degree's related_profiles.
//
// Triggers:
//   - USE_LOOKALIKE_EXPANSION=true + confirmed.length < 60
//   - USE_FOF_LOOKALIKE=true + firstDegree.length >= 10

import * as provider from './providers/social-provider.js';
import { applySwedishGate } from './swedish-gate.js';
import { classifyBrand } from './brand-detector.js';

const FIRST_DEGREE_CAP = 30;
const SECOND_DEGREE_CAP = 15;

function normalizeIgProfileToCandidate(profileResponse, handle, source) {
  const u = profileResponse?.user || {};
  return {
    platform: 'instagram',
    handle,
    name: u.full_name || handle,
    bio: (u.biography || '').slice(0, 1000),
    followers: u.follower_count ?? null,
    country: null,
    default_language: null,
    external_url: u.external_url || null,
    caption_sample: null,
    engagement_signal: 0,
    is_business_account: u.is_business ?? null,
    business_category: u.category || null,
    is_verified: !!u.is_verified,
    discovery_source: source,
    discovery_query: '__lookalike__',
    raw: profileResponse,
    platforms_data: { instagram: profileResponse },
    comment_depth: 0,
  };
}

function normalizeTtProfileToCandidate(profileResponse, handle, source) {
  const u = profileResponse?.user || profileResponse || {};
  return {
    platform: 'tiktok',
    handle,
    name: u.nickname || u.full_name || handle,
    bio: (u.signature || u.biography || '').slice(0, 1000),
    followers: u.follower_count ?? u.fans ?? null,
    country: null,
    default_language: null,
    external_url: null,
    caption_sample: null,
    engagement_signal: 0,
    is_business_account: false,
    business_category: null,
    is_verified: !!u.verified,
    discovery_source: source,
    discovery_query: '__lookalike__',
    raw: profileResponse,
    platforms_data: { tiktok: profileResponse },
    comment_depth: 0,
  };
}

function extractRelatedFromCandidate(c) {
  return (
    c.platforms_data?.instagram?.user?.related_profiles ||
    c.platforms_data?.tiktok?.related_profiles ||
    c.raw?.user?.related_profiles ||
    c.raw?.related_profiles ||
    []
  );
}

async function firstDegreeLookalike(confirmed, brief) {
  const top10 = [...confirmed]
    .sort((a, b) => (b.engagement_signal || 0) - (a.engagement_signal || 0))
    .slice(0, 10);

  const handleSet = new Set();

  // 1. Related profiles från top 10
  for (const c of top10) {
    const related = extractRelatedFromCandidate(c);
    for (const r of related.slice(0, 5)) {
      if (r.username) handleSet.add(`${c.platform}:${r.username}`);
    }
  }

  // 2. Brief seeds (IG-only, eftersom Claude's kunskap är bäst där)
  for (const seed of (brief.lookalike_seeds || [])) {
    const clean = String(seed).replace(/^@/, '').trim();
    if (clean) handleSet.add(`instagram:${clean}`);
  }

  const entries = [...handleSet].slice(0, FIRST_DEGREE_CAP);
  const profiles = await Promise.all(entries.map(async entry => {
    const [platform, handle] = entry.split(':');
    try {
      if (platform === 'instagram') {
        const p = await provider.getIgProfile(handle);
        return normalizeIgProfileToCandidate(p, handle, 'lookalike');
      } else if (platform === 'tiktok') {
        const p = await provider.getTikTokProfile(handle);
        return normalizeTtProfileToCandidate(p, handle, 'lookalike');
      }
      return null;
    } catch (err) {
      console.warn(`[Lookalike][1st] ${platform}:@${handle} → ${err.message}`);
      return null;
    }
  }));

  return profiles.filter(Boolean);
}

async function secondDegreeLookalike(firstDegree) {
  const top5 = [...firstDegree]
    .sort((a, b) => (b.followers || 0) - (a.followers || 0))
    .slice(0, 5);

  const handleSet = new Set();
  for (const c of top5) {
    const related = extractRelatedFromCandidate(c);
    for (const r of related.slice(0, 3)) {
      if (r.username) handleSet.add(`${c.platform}:${r.username}`);
    }
  }

  const entries = [...handleSet].slice(0, SECOND_DEGREE_CAP);
  const profiles = await Promise.all(entries.map(async entry => {
    const [platform, handle] = entry.split(':');
    try {
      if (platform === 'instagram') {
        const p = await provider.getIgProfile(handle);
        return normalizeIgProfileToCandidate(p, handle, 'lookalike_fof');
      } else if (platform === 'tiktok') {
        const p = await provider.getTikTokProfile(handle);
        return normalizeTtProfileToCandidate(p, handle, 'lookalike_fof');
      }
      return null;
    } catch (err) {
      console.warn(`[Lookalike][2nd] ${platform}:@${handle} → ${err.message}`);
      return null;
    }
  }));

  return profiles.filter(Boolean);
}

/**
 * @returns {Promise<Candidate[]>} - alla lookalike-kandidater som passerat
 *   Swedish Gate + Brand Filter. Haiku skippas för kostnad.
 */
export async function expandWithLookalikes(confirmed, brief, metrics = {}) {
  if (process.env.USE_LOOKALIKE_EXPANSION !== 'true') return [];
  if (confirmed.length >= 60) {
    console.log('[Lookalike] Skipped: confirmed >= 60');
    return [];
  }

  const t0 = Date.now();
  const firstDegree = await firstDegreeLookalike(confirmed, brief);
  console.log(`[Lookalike] First-degree: ${firstDegree.length} profiles fetched`);

  let secondDegree = [];
  if (process.env.USE_FOF_LOOKALIKE === 'true' && firstDegree.length >= 10) {
    secondDegree = await secondDegreeLookalike(firstDegree);
    console.log(`[Lookalike+] Second-degree: ${secondDegree.length} profiles fetched`);
  }

  // Filtrera genom Swedish Gate + Brand Filter
  const all = [...firstDegree, ...secondDegree];
  const { passed } = applySwedishGate(all);
  const kept = passed.filter(c => classifyBrand(c).class !== 'brand');

  // Tagga discovery_source korrekt (överskriv om felaktig)
  const secondDegreeSet = new Set(secondDegree.map(c => `${c.platform}:${c.handle}`));
  for (const c of kept) {
    c.discovery_source = secondDegreeSet.has(`${c.platform}:${c.handle}`) ? 'lookalike_fof' : 'lookalike';
  }

  metrics.lookalike_triggered = true;
  if (secondDegree.length > 0) metrics.fof_lookalike_added = secondDegree.length;

  console.log(`[Lookalike] Total added to pool: ${kept.length} (in ${Date.now() - t0}ms)`);
  return kept;
}
