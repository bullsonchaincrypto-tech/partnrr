// ============================================================
// V9 Pipeline — Fas 9: Email Finder (Serper Waterfall)
// ============================================================
// För top 25 av final-set:
//   Step 1: Cache (30d TTL — återanvänder V1's email_cache-tabell)
//   Step 2: YouTube description regex (0 cost)
//   Step 3: Serper SERP-snippets regex + MX validering
//   Step 4: Serper page-follow top 3 länkar
//
// V1's email-finder.js är ORÖRD. Denna fil gatekeepas bakom USE_V9_PIPELINE.

import dns from 'node:dns/promises';
import { serperSearch } from './serper.js';
import { runSql, queryOne } from '../db/schema.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const KNOWN_PROVIDERS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com']);

function extractEmail(text) {
  if (!text) return null;
  const matches = String(text).match(EMAIL_RE) || [];
  for (const m of matches) {
    const lc = m.toLowerCase();
    if (lc.includes('noreply') || lc.includes('no-reply') || lc.includes('wixpress') ||
        lc.includes('sentry') || lc.endsWith('.png') || lc.endsWith('.jpg') ||
        lc.endsWith('.webp') || lc.endsWith('.gif')) continue;
    return m;
  }
  return null;
}

async function mxValidate(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  if (KNOWN_PROVIDERS.has(domain)) return true;
  try {
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch {
    return false;
  }
}

// OBS: V1's email_cache-schema är { id, kanalnamn UNIQUE, email, method, updated_at }.
// Vi återanvänder den så email-cachen delas mellan V1 och V9 (vilket är vad vi vill).
async function getCachedEmail(handle) {
  try {
    const r = await queryOne(
      `SELECT email FROM email_cache
       WHERE kanalnamn = $1 AND updated_at > NOW() - INTERVAL '30 days'`,
      [handle]
    );
    return r?.email || null;
  } catch { return null; }
}

async function setCachedEmail(handle, email, method = 'v9-serper') {
  try {
    await runSql(
      `INSERT INTO email_cache (kanalnamn, email, method, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (kanalnamn) DO UPDATE SET email = EXCLUDED.email, method = EXCLUDED.method, updated_at = NOW()`,
      [handle, email, method]
    );
  } catch (err) {
    console.warn(`[EmailFinder v9] cache write failed: ${err.message}`);
  }
}

async function fetchSafe(url, { timeout = 8000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow' });
    if (!r.ok) return null;
    return r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function findEmailViaSerper(c) {
  const name = c.name || c.handle;
  const handle = String(c.handle || '').replace(/^@/, '');
  const queries = [
    `"@${handle}" email OR kontakt OR contact`,
    `"${name}" email ${c.platform}`,
    `"${name}" "${handle}" samarbete OR business OR mail`,
  ];

  for (const q of queries) {
    let serp;
    try {
      serp = await serperSearch(q, { gl: 'se', hl: 'sv', num: 10 });
    } catch (err) {
      console.warn(`[EmailFinder v9] Serper "${q}" → ${err.message}`);
      continue;
    }

    // Step 3: regex på snippets
    for (const r of (serp.organic || [])) {
      const hay = `${r.title || ''} ${r.snippet || ''}`;
      const email = extractEmail(hay);
      if (email && await mxValidate(email)) {
        return { email, source: 'serp-snippet' };
      }
    }

    // Step 4: page-follow top 3
    for (const r of (serp.organic || []).slice(0, 3)) {
      if (!r.link) continue;
      const html = await fetchSafe(r.link);
      if (!html) continue;
      const email = extractEmail(html);
      if (email && await mxValidate(email)) {
        return { email, source: 'serp-page' };
      }
    }
  }
  return null;
}

/**
 * Mutates first 25 candidates in place with .email + .email_source.
 */
export async function findEmailsForFinal(finalCandidates) {
  const top25 = finalCandidates.slice(0, 25);
  const stats = { cache: 0, yt: 0, snippet: 0, page: 0, failed: 0 };

  // Chunk 5 parallellt
  for (let i = 0; i < top25.length; i += 5) {
    const chunk = top25.slice(i, i + 5);
    await Promise.all(chunk.map(async c => {
      // Step 1: Cache
      const cached = await getCachedEmail(c.handle);
      if (cached) {
        c.email = cached;
        c.email_source = 'cache';
        stats.cache++;
        return;
      }

      // Step 2: YouTube description
      if (c.platform === 'youtube' && c.bio) {
        const email = extractEmail(c.bio);
        if (email && await mxValidate(email)) {
          c.email = email;
          c.email_source = 'yt-description';
          await setCachedEmail(c.handle, email, 'v9-yt-description');
          stats.yt++;
          return;
        }
      }

      // Step 3+4: Serper
      const result = await findEmailViaSerper(c);
      if (result) {
        c.email = result.email;
        c.email_source = result.source;
        await setCachedEmail(c.handle, result.email, `v9-${result.source}`);
        if (result.source === 'serp-snippet') stats.snippet++;
        else stats.page++;
      } else {
        c.email = null;
        c.kontakt_info = 'Se profil för kontakt';
        stats.failed++;
      }
    }));
  }

  console.log(`[EmailFinder v9] Top 25 processed — cache:${stats.cache}, yt:${stats.yt}, snippet:${stats.snippet}, page:${stats.page}, failed:${stats.failed}`);
}

export const __test__ = { extractEmail, mxValidate };
