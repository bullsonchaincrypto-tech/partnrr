// ============================================================
// V9 Pipeline — Fas 7.5: Obscurity Validation (Serper)
// ============================================================
// För top 50 sorted: kör Google search på "{nisch} svensk {namn}" via Serper.
// Om creator rankar top-3 → obscurity cappad till 30. Top-10 → capped 50.
// Recalcuterar match_score med nya obscurity-värdet.
//
// Trigger: USE_OBSCURITY_VALIDATION=true
// Cache: 14 dagar via obscurity_cache.
// Kostnad: ~$0.032 amort.

import { serperSearch } from './serper.js';
import { runSql, queryOne } from '../db/schema.js';

function findCreatorRankInSerp(serp, c) {
  const organics = serp.organic || [];
  const handleLc = String(c.handle || '').toLowerCase().replace('@', '');
  const nameLc = String(c.name || '').toLowerCase();
  for (let i = 0; i < organics.length; i++) {
    const link = String(organics[i].link || '').toLowerCase();
    const title = String(organics[i].title || '').toLowerCase();
    if (handleLc && link.includes(handleLc)) return i + 1;
    if (nameLc && nameLc.length >= 5 && title.includes(nameLc)) return i + 1;
  }
  return null;
}

async function getCachedObscurity(handle, platform, niche) {
  try {
    const r = await queryOne(
      `SELECT google_rank, google_count FROM obscurity_cache
       WHERE handle = $1 AND platform = $2 AND niche = $3
         AND created_at > NOW() - INTERVAL '14 days'`,
      [handle, platform, niche]
    );
    return r || null;
  } catch { return null; }
}

async function setCachedObscurity(handle, platform, niche, rank, count) {
  try {
    await runSql(
      `INSERT INTO obscurity_cache (handle, platform, niche, google_rank, google_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (handle, platform, niche) DO UPDATE
         SET google_rank = EXCLUDED.google_rank,
             google_count = EXCLUDED.google_count,
             created_at = NOW()`,
      [handle, platform, niche, rank, count]
    );
  } catch (err) {
    console.warn(`[Obscurity] cache write failed: ${err.message}`);
  }
}

/**
 * @param {Candidate[]} scored - sorterad på match_score desc
 * @param {object} brief
 * @returns {Promise<Candidate[]>} - samma array med justerad obscurity + match_score
 */
export async function validateObscurity(scored, brief, metrics = {}) {
  if (process.env.USE_OBSCURITY_VALIDATION !== 'true') return scored;

  const top50 = scored.slice(0, 50);
  metrics.obscurity_validation_run = true;

  let cacheHits = 0;
  let freshQueries = 0;
  let cappedTop3 = 0;
  let cappedTop10 = 0;

  await Promise.all(top50.map(async c => {
    const cached = await getCachedObscurity(c.handle, c.platform, brief.primary_niche);
    let rank, count;
    if (cached) {
      rank = cached.google_rank;
      count = cached.google_count;
      cacheHits++;
    } else {
      const q = `${brief.primary_niche} svensk ${c.name || c.handle}`;
      try {
        const serp = await serperSearch(q, { gl: 'se', hl: 'sv', num: 10 });
        rank = findCreatorRankInSerp(serp, c);
        count = Number(serp.searchInformation?.totalResults || 0);
        await setCachedObscurity(c.handle, c.platform, brief.primary_niche, rank, count);
        freshQueries++;
      } catch (err) {
        console.warn(`[Obscurity] Serper fail @${c.handle}: ${err.message}`);
        rank = null;
        count = null;
      }
    }

    c.google_rank_position = rank;
    c.google_result_count = count;
    c.obscurity_validated = true;

    // Cap obscurity om creator rankar i Google
    if (rank != null && rank <= 3) {
      c.obscurity = Math.min(c.obscurity || 0, 30);
      cappedTop3++;
    } else if (rank != null && rank <= 10) {
      c.obscurity = Math.min(c.obscurity || 0, 50);
      cappedTop10++;
    }

    // Recompute match_score med ny obscurity
    c.match_score = Math.round(
      (c.nischfit || 0) * 0.40 +
      (c.audience_fit || 0) * 0.20 +
      (c.obscurity || 0) * 0.25 +
      (c.authenticity || 0) * 0.15
    );
  }));

  console.log(`[Obscurity] Cache hits: ${cacheHits}, fresh Serper queries: ${freshQueries}`);
  console.log(`[Obscurity] Top-3 cappade (30): ${cappedTop3}, Top-10 cappade (50): ${cappedTop10}`);
  return scored;
}

export const __test__ = { findCreatorRankInSerp, getCachedObscurity };
