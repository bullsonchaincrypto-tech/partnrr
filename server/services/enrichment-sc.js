// ============================================================
// V9 Pipeline — Fas 6: Profile Enrichment
// ============================================================
// För top 55 (sorterade på multi-platform → swedish_confidence → engagement)
// hämtar full profile-data från IG/TT-providers. YT redan komplett från Fas 2.
//
// Post-enrichment re-verifierar Swedish Gate (för 'pending') och Brand Filter.

import * as provider from './providers/social-provider.js';
import { applySwedishGate } from './swedish-gate.js';
import { classifyBrand } from './brand-detector.js';

const TOP_N = 55;
const CHUNK_SIZE = 10;

function sortForEnrichment(candidates) {
  return [...candidates].sort((a, b) => {
    // 1. Multi-platform först
    if (!!a.is_multi_platform !== !!b.is_multi_platform) {
      return a.is_multi_platform ? -1 : 1;
    }
    // 2. swedish_confidence: hard → soft → pending
    const order = { hard: 0, soft: 1, pending: 2, undefined: 3 };
    const ao = order[a.swedish_confidence] ?? 3;
    const bo = order[b.swedish_confidence] ?? 3;
    if (ao !== bo) return ao - bo;
    // 3. engagement_signal desc
    return (b.engagement_signal || 0) - (a.engagement_signal || 0);
  });
}

// SC:s Instagram-profile-respons kan ha flera olika shapes:
//   { user: { biography, full_name, ... } }
//   { data: { user: { biography, ... } } }
//   { biography, full_name, ... } (flat, utan wrapper)
// Denna helper försöker alla varianter.
function unwrapIgProfile(raw) {
  if (!raw || typeof raw !== 'object') return {};
  // Testa nested .data.user, .user, sedan raw direkt
  return raw?.data?.user || raw?.user || raw?.data || raw || {};
}

function unwrapTtProfile(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return raw?.data?.user || raw?.user || raw?.userInfo?.user
    || raw?.data || raw || {};
}

function mergeIgProfile(original, profileResponse) {
  const u = unwrapIgProfile(profileResponse);
  // Prova alla rimliga bio-fält SC kan returnera
  const bio = u.biography
    || u.bio
    || u.biography_with_entities?.raw_text
    || u.biography_with_entities?.text
    || original.bio
    || '';
  // Diagnos-log vid första fetch om bio fortfarande tom
  if (!bio && profileResponse) {
    console.log(`[Enrichment][IG] @${original.handle}: tom bio efter parse. Top-level nycklar: ${Object.keys(profileResponse).join(', ')}`);
  }
  return {
    ...original,
    name: u.full_name || u.name || original.name,
    bio: bio.slice(0, 1000),
    followers: u.follower_count ?? u.followers_count ?? u.followers ?? original.followers,
    external_url: u.external_url || u.external_lynx_url || original.external_url,
    is_business_account: u.is_business === true || u.is_business_account === true,
    business_category: u.category || u.category_name || original.business_category,
    is_verified: !!(u.is_verified || u.verified || original.is_verified),
    platforms_data: { ...(original.platforms_data || {}), instagram: profileResponse },
  };
}

function mergeTtProfile(original, profileResponse) {
  const u = unwrapTtProfile(profileResponse);
  const bio = u.signature || u.biography || u.bio || original.bio || '';
  if (!bio && profileResponse) {
    console.log(`[Enrichment][TT] @${original.handle}: tom bio efter parse. Top-level nycklar: ${Object.keys(profileResponse).join(', ')}`);
  }
  return {
    ...original,
    name: u.nickname || u.full_name || u.unique_id || original.name,
    bio: bio.slice(0, 1000),
    followers: u.follower_count ?? u.followerCount ?? u.fans ?? original.followers,
    is_verified: !!(u.verified || u.is_verified || original.is_verified),
    platforms_data: { ...(original.platforms_data || {}), tiktok: profileResponse },
  };
}

/**
 * @param {Candidate[]} candidates - confirmed + reserve + lookalikes
 * @returns {Promise<Candidate[]>} - berikad och re-verifierad
 */
export async function enrichProfiles(candidates) {
  const t0 = Date.now();
  const sorted = sortForEnrichment(candidates);
  const top = sorted.slice(0, TOP_N);
  console.log(`[Enrichment] Sorting done. Top ${top.length} of ${candidates.length} selected for enrichment.`);

  const enriched = [];
  for (let i = 0; i < top.length; i += CHUNK_SIZE) {
    const chunk = top.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map(async c => {
      try {
        if (c.platform === 'instagram') {
          const p = await provider.getIgProfile(c.handle);
          return mergeIgProfile(c, p);
        }
        if (c.platform === 'tiktok') {
          const p = await provider.getTikTokProfile(c.handle);
          return mergeTtProfile(c, p);
        }
        // YouTube är redan komplett från Fas 2.4
        return c;
      } catch (err) {
        console.warn(`[Enrichment] ${c.platform}:@${c.handle} → ${err.message}`);
        return c;
      }
    }));
    enriched.push(...results);
  }

  // Post-enrichment re-verifiering
  let droppedSwedish = 0;
  let droppedBrand = 0;
  const verified = enriched.filter(c => {
    // Re-run Swedish Gate på pending
    if (c.swedish_confidence === 'pending') {
      const { passed } = applySwedishGate([c]);
      if (passed.length === 0) {
        droppedSwedish++;
        return false;
      }
    }
    // Re-run Brand Filter med ny data
    const r = classifyBrand(c);
    c.brand_score = r.brand_score;
    c.brand_signals = r.signals;
    if (r.class === 'brand') {
      droppedBrand++;
      return false;
    }
    return true;
  });

  // Lägg till skipped (icke-top) tillbaka utan enrichment
  const skipped = sorted.slice(TOP_N);
  const all = [...verified, ...skipped];

  console.log(
    `[Enrichment] Done in ${Date.now() - t0}ms — enriched=${enriched.length}, ` +
    `verified=${verified.length}, post-drops swedish=${droppedSwedish} brand=${droppedBrand}, ` +
    `skipped=${skipped.length}, total returned=${all.length}`
  );
  return all;
}

export const __test__ = { sortForEnrichment, mergeIgProfile, mergeTtProfile };
