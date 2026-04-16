// ============================================================
// V9 Pipeline — Fas 6: Profile Enrichment (Apify-baserad)
// ============================================================
// För top 55 (sorterade på multi-platform → swedish_confidence → engagement)
// hämtar full profile-data via Apify Instagram/TikTok Profile Scrapers.
// YT redan komplett från Fas 2.
//
// Tidigare: ScrapeCreators (SC) — ersatt med Apify pga SC credits slut (402).
// Post-enrichment re-verifierar Swedish Gate (för 'pending') och Brand Filter.

import { enrichInstagramProfiles, enrichTikTokProfiles } from './social-enrichment.js';
import { applySwedishGate } from './swedish-gate.js';
import { classifyBrand } from './brand-detector.js';

// Ingen cap — alla som passerat Swedish Gate ska berikas via Apify.
// Sorteringen behålls för att multi-platform/hard-confidence batchas först.
const TOP_N = Infinity;

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

/**
 * Merga Apify Instagram-enrichment in i V9-kandidat.
 * Apify instagram-profile-scraper returnerar:
 *   { username, fullName, biography, followersCount, followsCount,
 *     postsCount, verified, isBusinessAccount, businessCategoryName,
 *     externalUrl, profilePicUrl, ... }
 */
function mergeApifyIgProfile(original, apifyData) {
  if (!apifyData) return original;
  const bio = apifyData.bio || apifyData.biography || original.bio || '';
  return {
    ...original,
    name: apifyData.full_name || apifyData.fullName || original.name,
    bio: bio.slice(0, 1000),
    followers: apifyData.followers ?? apifyData.followersCount ?? original.followers,
    external_url: apifyData.website || apifyData.externalUrl || original.external_url,
    is_business_account: apifyData.is_business || apifyData.isBusinessAccount || false,
    business_category: apifyData.category || apifyData.businessCategoryName || original.business_category,
    is_verified: !!(apifyData.is_verified_platform || apifyData.is_verified || apifyData.verified || original.is_verified),
    engagement_signal: apifyData.engagement_rate || original.engagement_signal || 0,
    _already_enriched: true,
  };
}

/**
 * Merga Apify TikTok-enrichment in i V9-kandidat.
 */
function mergeApifyTtProfile(original, apifyData) {
  if (!apifyData) return original;
  const bio = apifyData.bio || apifyData.signature || original.bio || '';
  return {
    ...original,
    name: apifyData.full_name || apifyData.nickname || original.name,
    bio: bio.slice(0, 1000),
    followers: apifyData.followers || apifyData.followerCount || original.followers,
    is_verified: !!(apifyData.is_verified || apifyData.verified || original.is_verified),
    _already_enriched: true,
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
  console.log(`[Enrichment] All ${top.length} of ${candidates.length} candidates selected for enrichment.`);

  // Separera per plattform (skippa redan berikade)
  const igCandidates = top.filter(c => c.platform === 'instagram' && !c._already_enriched);
  const ttCandidates = top.filter(c => c.platform === 'tiktok' && !c._already_enriched);
  const ytCandidates = top.filter(c => c.platform === 'youtube' || c._already_enriched);

  const alreadyEnriched = top.filter(c => c._already_enriched).length;
  console.log(`[Enrichment] To enrich: IG=${igCandidates.length}, TT=${ttCandidates.length}, already enriched (skip)=${alreadyEnriched}`);

  // Kör IG och TT parallellt via Apify
  const [igResults, ttResults] = await Promise.all([
    igCandidates.length > 0
      ? enrichInstagramProfiles(igCandidates.map(c => c.handle)).catch(err => {
          console.error(`[Enrichment] Apify IG batch failed: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
    ttCandidates.length > 0
      ? enrichTikTokProfiles(ttCandidates.map(c => c.handle)).catch(err => {
          console.error(`[Enrichment] Apify TT batch failed: ${err.message}`);
          return [];
        })
      : Promise.resolve([]),
  ]);

  // Bygg lookup maps (handle → apify data)
  const igMap = new Map();
  for (const r of igResults) {
    const key = (r.username || '').toLowerCase();
    if (key) igMap.set(key, r);
  }
  const ttMap = new Map();
  for (const r of ttResults) {
    const key = (r.username || '').toLowerCase();
    if (key) ttMap.set(key, r);
  }

  console.log(`[Enrichment] Apify returned: IG=${igMap.size}/${igCandidates.length}, TT=${ttMap.size}/${ttCandidates.length}`);

  // Merga enrichment-data in i kandidater
  let enrichedCount = 0;
  const enriched = top.map(c => {
    if (c._already_enriched) return c;

    const handle = (c.handle || '').toLowerCase();

    if (c.platform === 'instagram' && igMap.has(handle)) {
      enrichedCount++;
      const apifyData = igMap.get(handle);
      const merged = mergeApifyIgProfile(c, apifyData);
      if (!merged.followers && apifyData.followers) {
        console.warn(`[Enrichment] MERGE BUG: @${handle} — apify.followers=${apifyData.followers} but merged.followers=${merged.followers}`);
      }
      if (merged.followers !== apifyData.followers && apifyData.followers > 0) {
        console.log(`[Enrichment] Followers mismatch @${handle}: apify=${apifyData.followers}, merged=${merged.followers}, original=${c.followers}`);
      }
      return merged;
    }
    if (c.platform === 'tiktok' && ttMap.has(handle)) {
      enrichedCount++;
      return mergeApifyTtProfile(c, ttMap.get(handle));
    }

    // Ingen enrichment — returnera oförändrad
    return c;
  });

  console.log(`[Enrichment] Merged enrichment for ${enrichedCount}/${top.length} candidates`);

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

export const __test__ = { sortForEnrichment, mergeApifyIgProfile, mergeApifyTtProfile };
