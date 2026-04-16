// ============================================================
// V9 Pipeline — Orchestrator (Fas 0 → Fas 10)
// ============================================================
// Wire-up för hela V9-pipen. Aktiveras från routes/search.js via USE_V9_PIPELINE-
// flaggan (wire-in sker i Sprint 4). Fram till dess: dead-code som man kan
// importa och testa.
//
// Returnerar: { results, cost_usd, duration_ms, metrics, cached }

import crypto from 'node:crypto';
import { runSql, queryOne } from '../db/schema.js';

import { interpretBrief } from './brief-interpreter.js';
import { generateAllSearchTerms } from './ai-search-v9.js';
import { discoverCandidates } from './discovery.js';
import { mergeCrossPlatform } from './cross-platform-merge.js';
import { discoverFromComments } from './comment-discovery.js';
import { harvestBioLinks } from './bio-link-harvest.js';
import { discoverFromLists } from './list-discovery.js';
import { refineQueriesFromCaptions } from './query-refinement.js';
import { applySwedishGate } from './swedish-gate.js';
import { applyBrandFilter } from './brand-detector.js';
import { classifyWithHaiku } from './haiku-classifier.js';
import { expandWithLookalikes } from './lookalike-expansion.js';
import { enrichProfiles } from './enrichment-sc.js';
import { scoreCandidates, applyFollowerCap } from './scoring-v9.js';
import { validateObscurity } from './obscurity-validator.js';
import { findEmailsForFinal } from './email-finder-v9.js';
import { notifyAlert } from './alerts.js';

const GLOBAL_TIMEOUT_MS = 180_000;
const LOCK_STALE_SEC = 300;

/** Räkna kandidater per plattform för diagnos-logging. */
function platformCounts(list) {
  const out = { youtube: 0, instagram: 0, tiktok: 0, other: 0 };
  for (const c of list) {
    if (c.platform in out) out[c.platform]++;
    else out.other++;
  }
  return out;
}

/** Logga per-source-query breakdown för IG (Serper). */
function logSourceQueryBreakdown(tag, list) {
  const igCands = list.filter(c => c.platform === 'instagram' && c.discovery_query);
  if (igCands.length === 0) return;
  const byQuery = {};
  for (const c of igCands) {
    const q = c.discovery_query;
    if (!byQuery[q]) byQuery[q] = [];
    byQuery[q].push(c.handle);
  }
  console.log(`[V9] ─── IG source-query breakdown (${tag}) ───`);
  for (const [query, handles] of Object.entries(byQuery).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`[V9]   ${query}: ${handles.length} st [${handles.slice(0, 5).map(h => '@' + h).join(', ')}${handles.length > 5 ? '...' : ''}]`);
  }
}

// ============================================================
// === FAS 8: DYNAMIC CUT + RESERVE REFILL =====================
// ============================================================

export function finalCut(scored, reservePool, {
  targetMin = parseInt(process.env.V9_TARGET_MIN_RESULTS) || 20,
  capMax = parseInt(process.env.V9_FINAL_CAP_MAX) || 40,
  threshold = 15,
} = {}) {
  // 1. Follower-cap safety net
  for (const c of scored) c.match_score = applyFollowerCap(c);

  // 2. Sort: deep-scored först, sedan match_score desc
  const sorted = [...scored].sort((a, b) => {
    const aProv = a.provisional === true;
    const bProv = b.provisional === true;
    if (aProv !== bProv) return aProv ? 1 : -1;
    const aScore = a.match_score ?? a.provisional_score ?? 0;
    const bScore = b.match_score ?? b.provisional_score ?? 0;
    return bScore - aScore;
  });

  // 3. Dynamic cap
  const highTier = sorted.filter(c => (c.match_score || 0) >= 60).length;
  const midTier = sorted.filter(c => (c.match_score || 0) >= 40).length;
  const finalCap = Math.min(capMax, Math.max(25, highTier + Math.min(20, midTier - highTier)));

  // 4. Threshold filter + slice
  let final = sorted.filter(c => (c.match_score ?? c.provisional_score ?? 0) >= threshold).slice(0, finalCap);

  // 5. Reserve refill
  let reserveUsed = 0;
  if (final.length < targetMin && reservePool.length > 0) {
    const need = targetMin - final.length;
    const refill = [...reservePool]
      .filter(c => (c.provisional_score || 0) >= 40)
      .slice(0, need)
      .map(c => ({ ...c, discovery_source: 'reserve' }));
    final = [...final, ...refill];
    reserveUsed = refill.length;
  }

  // 6. Hård golv: minst 10 OM vi har kvalitativt material.
  // Sänkt krav: >=20 istället för >=30, och minst 10 istf 15.
  // Detta hanterar fallet då SC-enrichment är nere och alla profiler
  // saknar followers-data (cappas hårt av follower-cap).
  if (final.length < 10) {
    const hasQualityMaterial = sorted.some(c => (c.match_score || 0) >= 20);
    if (hasQualityMaterial) {
      const padding = sorted.filter(c => !final.includes(c)).slice(0, 10 - final.length);
      final = [...final, ...padding];
      console.warn(`[FinalCut] Very low yield — padding till ${final.length} (kvalitetsmaterial finns >=20)`);
    } else {
      // Absolut sista fallback: returnera top-N ändå om vi har HAR kandidater
      // men alla scorade lågt p.g.a. saknad data
      if (sorted.length >= 5 && final.length === 0) {
        final = sorted.slice(0, Math.min(10, sorted.length));
        console.warn(`[FinalCut] Emergency fallback — ALLA scores <20 men ${sorted.length} kandidater finns. Returnerar top ${final.length} ändå.`);
      } else {
        console.warn(`[FinalCut] Very low yield AND inget material >= 20 — returnerar bara ${final.length} riktigt relevanta istället för skräp`);
      }
    }
  }

  console.log(`[FinalCut] deep_scored: ${sorted.filter(c => !c.provisional).length}, provisional: ${sorted.filter(c => c.provisional).length}, reserve-pool: ${reservePool.length}`);
  console.log(`[FinalCut] highTier (>=60): ${highTier}, midTier (>=40): ${midTier}, dynamic cap: ${finalCap}`);
  console.log(`[FinalCut] After threshold (>=${threshold}): ${final.length}, reserve used: ${reserveUsed}`);
  return { final, reserveUsed };
}

// ============================================================
// === FAS 10: PERSISTENS ======================================
// ============================================================

async function persistResults(foretag_id, final, brief, metrics) {
  // 1. Radera tidigare sökresultat för detta företag
  // (V1-pipen använder samma tabell; vi rensar alla rader för foretag_id)
  await runSql('DELETE FROM influencers WHERE foretag_id = $1', [foretag_id]);

  // 2. Insert final-set — enbart kolumner som finns i V1-schemat.
  //    Rich V9-metadata (match_score, obscurity, etc) sparas i search_metrics.
  for (const c of final) {
    try {
      await runSql(`
        INSERT INTO influencers (
          foretag_id, kanalnamn, plattform, namn, foljare,
          nisch, kontakt_epost, kontakt_info
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          foretag_id,
          c.handle || 'unknown',
          c.platform,
          c.name || c.handle || '',
          c.followers != null ? String(c.followers) : null,
          brief.primary_niche || '',
          c.email || null,
          c.kontakt_info || (c.motivation ? `match:${Math.round(c.match_score || 0)} — ${c.motivation}`.slice(0, 500) : null),
        ]
      );
    } catch (err) {
      console.warn(`[Persist] insert fail @${c.handle}: ${err.message}`);
    }
  }

  // 3. Log search_metrics
  try {
    await runSql(`
      INSERT INTO search_metrics (
        foretag_id, duration_ms, cost_usd, raw_candidates,
        after_swedish_gate, after_brand_filter, after_haiku, final_count,
        multi_platform_count, reserve_used, hashtag_triggered,
        lookalike_triggered, obscurity_validation_run, query_refinement_triggered,
        comment_discovery_channels_found, bio_harvest_new_handles,
        list_discovery_handles_found, fof_lookalike_added,
        cache_hit, scrapecreators_calls, serper_calls, hikerapi_calls
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        foretag_id,
        metrics.duration_ms || 0,
        metrics.cost_usd || 0,
        metrics.raw_candidates || 0,
        metrics.after_swedish_gate || 0,
        metrics.after_brand_filter || 0,
        metrics.after_haiku || 0,
        final.length,
        final.filter(c => c.is_multi_platform).length,
        metrics.reserve_used || 0,
        !!metrics.hashtag_triggered,
        !!metrics.lookalike_triggered,
        !!metrics.obscurity_validation_run,
        !!metrics.query_refinement_triggered,
        metrics.comment_discovery_channels_found || 0,
        metrics.bio_harvest_new_handles || 0,
        metrics.list_discovery_handles_found || 0,
        metrics.fof_lookalike_added || 0,
        !!metrics.cache_hit,
        metrics.scrapecreators_calls || 0,
        metrics.serper_calls || 0,
        metrics.hikerapi_calls || 0,
      ]
    );
  } catch (err) {
    console.warn(`[Persist] search_metrics log fail: ${err.message}`);
  }
  console.log(`[Persist] ${final.length} influencers inserted`);
}

// ============================================================
// === SEARCH LOCKS (concurrent guard) =========================
// ============================================================

async function acquireSearchLock(foretag_id) {
  try {
    // Rensa stale locks
    await runSql(
      `DELETE FROM search_locks
       WHERE locked_at < NOW() - INTERVAL '${LOCK_STALE_SEC} seconds'`
    );
    // OBS: RETURNING foretag_id explicit → bypass db/schema.js runSql's
    // auto-append av 'RETURNING id' (search_locks har ingen id-kolumn).
    await runSql(
      `INSERT INTO search_locks (foretag_id, locked_at, locked_by)
       VALUES ($1, NOW(), $2) RETURNING foretag_id`,
      [foretag_id, `v9-${process.pid}`]
    );
    return true;
  } catch (err) {
    if (/unique|duplicate|primary|23505/i.test(err.message || '')) {
      return false;
    }
    console.warn(`[SearchLock] Unexpected err: ${err.message}`);
    return true;  // Fail open
  }
}

async function releaseSearchLock(foretag_id) {
  try {
    await runSql('DELETE FROM search_locks WHERE foretag_id = $1', [foretag_id]);
  } catch {}
}

// ============================================================
// === ENTRY POINT — FULL PIPELINE =============================
// ============================================================

export async function runV9Pipeline({
  foretag,
  companyProfile,
  platforms = ['youtube', 'instagram', 'tiktok'],
  userQuery = null,
  bust_cache = false,
}) {
  const t0 = Date.now();
  const foretag_id = foretag?.id;
  if (!foretag_id) throw new Error('[V9] foretag.id krävs');

  // === Concurrent-lock ===
  const locked = await acquireSearchLock(foretag_id);
  if (!locked) {
    const err = new Error('Sökning för detta företag pågår redan. Vänta några minuter.');
    err.status = 429;
    throw err;
  }

  const metrics = {};
  try {
    // Global timeout guard
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('V9 pipeline timeout (180s)')), GLOBAL_TIMEOUT_MS)
    );
    return await Promise.race([
      runPipelineInner(foretag, companyProfile, platforms, userQuery, bust_cache, metrics, t0),
      timeoutPromise,
    ]);
  } catch (err) {
    // Alert på critical errors
    if (err.status !== 429) {
      notifyAlert({
        severity: 'critical',
        summary: `V9 pipeline error foretag_id=${foretag_id}: ${err.message}`,
        details: { foretag_id, metrics, duration_ms: Date.now() - t0 },
        source: 'sparkcollab-v9-orchestrator',
      }).catch(() => {});
    }
    throw err;
  } finally {
    await releaseSearchLock(foretag_id);
  }
}

async function runPipelineInner(foretag, companyProfile, platforms, userQuery, bust_cache, metrics, t0) {
  console.log(`[V9] ==================== PIPELINE START foretag_id=${foretag.id} ====================`);
  console.log(`[V9] Company: "${foretag.namn}" bransch="${foretag.bransch || '(tom)'}" beskrivning="${(foretag.beskrivning || '').slice(0, 100)}"`);
  console.log(`[V9] Platforms: ${platforms.join(', ')}, user_query: ${userQuery || '(ingen)'}`);

  // === Fas 0: Brief ===
  console.log(`[V9] >>> Fas 0: Brief Interpreter`);
  const brief = await interpretBrief(foretag, companyProfile, userQuery);
  console.log(`[V9] <<< Fas 0 klar: niche="${brief.primary_niche}", tier=${brief.size_tier_hint}, must_have=${(brief.must_have_signals || []).length}, exclusions=${(brief.exclusions || []).length}, hashtags=${(brief.hashtag_hints || []).length}`);

  // === Fas 1: Search terms ===
  console.log(`[V9] >>> Fas 1: Sökterms-generering (Sonnet ×2)`);
  const queries = await generateAllSearchTerms(foretag, brief);
  console.log(`[V9] <<< Fas 1 klar. YT-termer: [${(queries.yt_terms || []).join(' | ')}]`);
  console.log(`[V9]     IG-termer: [${(queries.ig_terms || []).join(' | ')}]`);
  console.log(`[V9]     Hashtags: [${(queries.hashtag_terms || []).join(' | ')}]`);
  console.log(`[V9]     Long-tail: [${(queries.long_tail_terms || []).join(' | ')}]`);
  console.log(`[V9]     Serper-IG-keywords: [${(queries.serper_keywords || []).join(' | ')}]`);

  // === Fas 2: Discovery ===
  console.log(`[V9] >>> Fas 2: Parallel Discovery`);
  let candidates = await discoverCandidates(brief, queries, foretag, platforms, metrics);
  const discPlat = platformCounts(candidates);
  console.log(`[V9] <<< Fas 2 klar. ${candidates.length} kandidater (yt=${discPlat.youtube} ig=${discPlat.instagram} tt=${discPlat.tiktok})`);
  logSourceQueryBreakdown('efter Discovery', candidates);

  // === Fas 2.5: Cross-platform merge ===
  console.log(`[V9] >>> Fas 2.5: Cross-platform merge`);
  candidates = mergeCrossPlatform(candidates);
  const multiPlat = candidates.filter(c => c.is_multi_platform).length;
  console.log(`[V9] <<< Fas 2.5 klar. ${candidates.length} unika entiteter (${multiPlat} multi-plattform)`);

  // === Fas 2.6: Comment discovery (additive) ===
  console.log(`[V9] >>> Fas 2.6: Comment Discovery (${process.env.USE_COMMENT_DISCOVERY === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const { handles: commentHandles, depth_map } = await discoverFromComments(
    candidates.filter(c => c.platform === 'youtube'),
    10,
    metrics,
  );
  for (const c of candidates) {
    const depth = depth_map.get((c.handle || '').toLowerCase());
    if (depth) c.comment_depth = depth;
  }
  console.log(`[V9] <<< Fas 2.6 klar. ${commentHandles.length} community-handles hittade`);

  // === Fas 2.7: Bio-link harvest (additive) ===
  console.log(`[V9] >>> Fas 2.7: Bio-link Harvest (${process.env.USE_BIO_HARVEST === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const { newCandidates: harvested } = await harvestBioLinks(candidates, metrics);
  candidates = mergeCrossPlatform([...candidates, ...harvested]);
  console.log(`[V9] <<< Fas 2.7 klar. +${harvested.length} nya, totalt ${candidates.length}`);

  // === Fas 2.8: List discovery (additive) ===
  console.log(`[V9] >>> Fas 2.8: List Discovery (${process.env.USE_LIST_DISCOVERY === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const listCands = await discoverFromLists(brief, metrics);
  candidates = mergeCrossPlatform([...candidates, ...listCands]);
  console.log(`[V9] <<< Fas 2.8 klar. +${listCands.length} från listor, totalt ${candidates.length}`);

  // === Fas 1.5: Query refinement (conditional, additive) ===
  console.log(`[V9] >>> Fas 1.5: Query Refinement (${process.env.USE_QUERY_REFINEMENT === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const refinedCands = await refineQueriesFromCaptions(candidates, brief, queries, foretag, metrics);
  candidates = mergeCrossPlatform([...candidates, ...refinedCands]);
  console.log(`[V9] <<< Fas 1.5 klar. +${refinedCands.length} refined, totalt ${candidates.length}`);

  // === Fas 3: Swedish Gate ===
  const { passed: swedishPassed, rejected: swedishRejected } = applySwedishGate(candidates);
  metrics.after_swedish_gate = swedishPassed.length;
  const sgPassByPlat = platformCounts(swedishPassed);
  const sgRejByPlat = platformCounts(swedishRejected);
  console.log(`[V9] Swedish Gate: ${swedishPassed.length} passed, ${swedishRejected.length} rejected`);
  console.log(`[V9]   Passed: yt=${sgPassByPlat.youtube} ig=${sgPassByPlat.instagram} tt=${sgPassByPlat.tiktok}`);
  console.log(`[V9]   Rejected: yt=${sgRejByPlat.youtube} ig=${sgRejByPlat.instagram} tt=${sgRejByPlat.tiktok}`);
  logSourceQueryBreakdown('efter Swedish Gate', swedishPassed);
  // Sampla några rejected IG-kandidater för diagnos
  const rejectedIg = swedishRejected.filter(c => c.platform === 'instagram').slice(0, 3);
  for (const c of rejectedIg) {
    console.log(`[V9]   IG-reject @${c.handle}: confidence=${c.swedish_confidence}, bio="${(c.bio || '').slice(0, 60)}" caption="${(c.caption_sample || '').slice(0, 60)}"`);
  }

  // === Fas 4: Enrichment (Apify) ===
  // Enricha ALLA som passerat Swedish Gate — behövs för att Brand Filter
  // och Haiku ska ha bio, followers, business_category att jobba med.
  console.log(`[V9] >>> Fas 4: Profile Enrichment (${swedishPassed.length} profiler)`);
  const enriched = await enrichProfiles(swedishPassed);
  for (const c of enriched) c._already_enriched = true;
  const enrichPlat = platformCounts(enriched);
  console.log(`[V9] <<< Fas 4 klar. ${enriched.length} enriched (yt=${enrichPlat.youtube} ig=${enrichPlat.instagram} tt=${enrichPlat.tiktok})`);

  // === Fas 5: Brand Filter (deterministisk, körs på enriched data) ===
  console.log(`[V9] >>> Fas 5: Brand Filter (deterministisk, på enriched data)`);
  const { kept: brandKept, ambiguous, brands } = applyBrandFilter(enriched);
  metrics.after_brand_filter = brandKept.length;
  console.log(`[V9] <<< Fas 5 klar. ${brandKept.length} kept (${ambiguous.length} ambiguous), ${brands.length} rejected as brand`);
  // Logga brand_score-distribution för debugging
  const scoreDist = {};
  for (const c of enriched) {
    const s = c.brand_score ?? 0;
    scoreDist[s] = (scoreDist[s] || 0) + 1;
  }
  console.log(`[V9]   Brand score distribution: ${Object.entries(scoreDist).sort((a,b) => Number(a[0]) - Number(b[0])).map(([s,n]) => `score=${s}:${n}`).join(', ')}`);
  // Logga rejected brands med signals
  for (const b of brands) {
    console.log(`[V9]   BRAND-REJECT @${b.handle} score=${b.brand_score} signals=${JSON.stringify(b.brand_signals)} bio="${(b.bio || '').slice(0, 80)}"`);
  }
  // Logga ambiguous (score=2) för insikt
  for (const a of ambiguous.slice(0, 5)) {
    console.log(`[V9]   AMBIGUOUS @${a.handle} score=${a.brand_score} signals=${JSON.stringify(a.brand_signals)}`);
  }

  // === Fas 6: Haiku Classifier (körs på enriched + brand-filtered data) ===
  console.log(`[V9] >>> Fas 6: Haiku Classifier (på enriched data)`);
  const { confirmed, reserve } = await classifyWithHaiku(brandKept);
  metrics.after_haiku = confirmed.length;
  const confPlat = platformCounts(confirmed);
  console.log(`[V9] <<< Fas 6 klar. confirmed=${confirmed.length} reserve=${reserve.length} (yt=${confPlat.youtube} ig=${confPlat.instagram} tt=${confPlat.tiktok})`);
  logSourceQueryBreakdown('efter Haiku', confirmed);

  // === Fas 6.5: Lookalike Expansion ===
  console.log(`[V9] >>> Fas 6.5: Lookalike Expansion (${process.env.USE_LOOKALIKE_EXPANSION === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const lookalikes = await expandWithLookalikes(confirmed, brief, metrics);
  const allScored = [...confirmed, ...lookalikes];
  console.log(`[V9] <<< Fas 6.5 klar. +${lookalikes.length} lookalikes, totalt: ${allScored.length}`);

  // === Fas 7: Two-Stage Scoring ===
  console.log(`[V9] >>> Fas 7: Two-Stage Scoring`);
  const scored = await scoreCandidates(allScored, brief, companyProfile);
  const highScore = scored.filter(c => (c.match_score || 0) >= 60).length;
  const midScore = scored.filter(c => (c.match_score || 0) >= 40 && (c.match_score || 0) < 60).length;
  const lowScore = scored.filter(c => (c.match_score || 0) < 40).length;
  console.log(`[V9] <<< Fas 7 klar. Scored ${scored.length}: high(>=60)=${highScore} mid(40-59)=${midScore} low(<40)=${lowScore}`);

  // === Fas 7.5: Obscurity Validation ===
  console.log(`[V9] >>> Fas 7.5: Obscurity Validation (${process.env.USE_OBSCURITY_VALIDATION === 'true' ? 'AKTIV' : 'SKIPPAD'})`);
  const validated = await validateObscurity(scored, brief, metrics);
  console.log(`[V9] <<< Fas 7.5 klar`);

  // === Fas 8: Dynamic Cut + Reserve Refill ===
  console.log(`[V9] >>> Fas 8: Dynamic Cut + Reserve Refill`);
  const { final, reserveUsed } = finalCut(validated, reserve);
  metrics.reserve_used = reserveUsed;
  const finalPlat = platformCounts(final);
  console.log(`[V9] <<< Fas 8 klar. Final: ${final.length} (yt=${finalPlat.youtube} ig=${finalPlat.instagram} tt=${finalPlat.tiktok}), reserve used: ${reserveUsed}`);
  logSourceQueryBreakdown('FINAL', final);

  // === Fas 9: Email Finder ===
  console.log(`[V9] >>> Fas 9: Email Finder (Serper waterfall)`);
  await findEmailsForFinal(final);
  const emailHits = final.filter(c => c.email).length;
  console.log(`[V9] <<< Fas 9 klar. ${emailHits}/${Math.min(25, final.length)} email-träffar`);

  // === Fas 10: Persistens ===
  console.log(`[V9] >>> Fas 10: Persistens`);
  metrics.duration_ms = Date.now() - t0;
  await persistResults(foretag.id, final, brief, metrics);
  console.log(`[V9] <<< Fas 10 klar. ${final.length} sparade i DB.`);

  console.log(`[V9] ==================== PIPELINE END ${metrics.duration_ms}ms — ${final.length} resultat (${emailHits} med e-post) ====================`);

  return {
    results: final,
    cached: false,
    duration_ms: metrics.duration_ms,
    cost_usd: metrics.cost_usd || 0,
    metrics: {
      raw: metrics.raw_candidates,
      afterSwedish: metrics.after_swedish_gate,
      afterBrand: metrics.after_brand_filter,
      afterHaiku: metrics.after_haiku,
      final: final.length,
      emailHits,
    },
  };
}

export const __test__ = { finalCut, acquireSearchLock, releaseSearchLock };
