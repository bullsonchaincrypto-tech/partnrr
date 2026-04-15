// ============================================================
// V9 Pipeline — Fas 2.7: Bio-Link Harvest (cross-platform handle discovery)
// ============================================================
// För kandidater som har en bio-länk till en annan plattform vi inte upptäckt
// dem på, hämta profilen på den andra plattformen och addera som ny kandidat.
// Ger oss creators som finns på flera plattformar utan att ha matchats av Fas 2.5.
//
// Trigger: USE_BIO_HARVEST=true

import * as provider from './providers/social-provider.js';
import { extractCrossPlatformHandles } from './cross-platform-merge.js';

/**
 * Skanna kandidater och hämta deras cross-platform-profiler där sådana
 * referenser finns men inte redan finns i poolen.
 * @returns {Promise<{newCandidates: RawCandidate[], harvestedCount: number}>}
 */
export async function harvestBioLinks(candidates, metrics = {}) {
  if (process.env.USE_BIO_HARVEST !== 'true') {
    return { newCandidates: [], harvestedCount: 0 };
  }

  // Bygg lookup för befintliga (platform:handle) kombinationer
  const existing = new Set();
  for (const c of candidates) {
    existing.add(`${c.platform}:${(c.handle || '').toLowerCase()}`);
  }

  // Samla upp targets att hämta
  const targets = new Set();
  for (const c of candidates) {
    const refs = extractCrossPlatformHandles(c);
    for (const [plat, handle] of Object.entries(refs)) {
      if (plat === c.platform) continue;  // redan på den plattformen
      const key = `${plat}:${handle.toLowerCase()}`;
      if (!existing.has(key)) {
        targets.add(JSON.stringify({ platform: plat, handle }));
      }
    }
  }

  if (targets.size === 0) {
    metrics.bio_harvest_new_handles = 0;
    return { newCandidates: [], harvestedCount: 0 };
  }

  // Cap för kostnadskontroll
  const targetList = [...targets].slice(0, 30).map(s => JSON.parse(s));

  console.log(`[BioHarvest] ${targets.size} cross-platform-refs hittade, hämtar topp ${targetList.length}`);

  // Chunked parallel: 5 åt gången
  const newCandidates = [];
  for (let i = 0; i < targetList.length; i += 5) {
    const chunk = targetList.slice(i, i + 5);
    const results = await Promise.all(chunk.map(async ({ platform, handle }) => {
      try {
        if (platform === 'instagram') {
          const p = await provider.getIgProfile(handle);
          return normalizeIgProfileToCandidate(p, handle);
        }
        if (platform === 'tiktok') {
          const p = await provider.getTikTokProfile(handle);
          return normalizeTtProfileToCandidate(p, handle);
        }
        // YT requires a channel-id lookup; skip om vi bara har handle
        return null;
      } catch (err) {
        console.warn(`[BioHarvest] ${platform}:@${handle} → ${err.message}`);
        return null;
      }
    }));
    newCandidates.push(...results.filter(Boolean));
  }

  metrics.bio_harvest_new_handles = newCandidates.length;
  console.log(`[BioHarvest] ${newCandidates.length} new candidates added`);
  return { newCandidates, harvestedCount: newCandidates.length };
}

function normalizeIgProfileToCandidate(profileResponse, handle) {
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
    discovery_source: 'bio_harvest',
    discovery_query: '__bio_harvest__',
    raw: profileResponse,
    comment_depth: 0,
  };
}

function normalizeTtProfileToCandidate(profileResponse, handle) {
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
    discovery_source: 'bio_harvest',
    discovery_query: '__bio_harvest__',
    raw: profileResponse,
    comment_depth: 0,
  };
}
