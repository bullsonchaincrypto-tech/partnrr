// ============================================================
// V9 Pipeline — Fas 7: Two-Stage Scoring
// ============================================================
// 7a: Haiku provisional scoring (0-100) för ALLA kandidater, snabb och billig.
// 7b: Sonnet deep scoring för top 50 på 4 dimensioner (nischfit, audience_fit,
//     obscurity, authenticity) med truncation-recovery och follower-cap.
//
// V1's scoring.js är ORÖRD. Denna fil gatekeepas bakom USE_V9_PIPELINE.
// Kostnad: ~$0.103 totalt.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

// ============================================================
// === HAIKU PROVISIONAL (Fas 7a) ==============================
// ============================================================

const HAIKU_SYSTEM = (brief) => `Du är pre-score-ranker för SparkCollab. Ge varje profil 0-100 provisional_score
baserat på:

1. Nischmatch mot ${brief.primary_niche}: hur tätt matchar content-nischen?
2. Follower-storlek vs size_tier_hint (${brief.size_tier_hint}):
   - mid-tier (10K-100K) prioriteras om hint = "mid-tier"
   - mega (>500K) straffas om hint ≠ "large"
   - nano (<1K) straffas om hint ≠ "nano"
3. Multi-platform-bonus: is_multi_platform = true → +10 points
4. Bio-kvalitet: konkreta content-beteenden = hög; generiska buzzwords = låg

Returnera STRIKT JSON-array (ingen markdown):
[{"index": N, "provisional_score": 0-100}]`;

function renderProvisionalPrompt(companyProfile, brief, profiles) {
  const lines = [
    `Företag: ${companyProfile?.namn || ''}`,
    `Nisch: ${brief.primary_niche}`,
    `Size tier: ${brief.size_tier_hint}`,
    '',
    'Profiler att scora:',
  ];
  profiles.forEach((c, i) => {
    lines.push(
      `[${i}] ${(c.platforms || [c.platform]).join('+')} @${c.handle} — ${c.name || ''}`,
      `  Följare: ${c.total_reach ?? c.followers ?? '?'}`,
      `  Multi-plattform: ${!!c.is_multi_platform}`,
      `  Bio: ${truncate(c.bio, 150)}`,
    );
  });
  return lines.join('\n');
}

/** Strip unpaired surrogates that break JSON serialization (common in IG bios with emojis). */
function sanitizeUnicode(str) {
  if (typeof str !== 'string') return str;
  // Remove lone surrogates: high surrogate not followed by low, or lone low surrogate
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD')
            .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

async function callModel(model, system, user, maxTokens, temperature) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[Scoring v9] ANTHROPIC_API_KEY saknas');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: sanitizeUnicode(system),
      messages: [{ role: 'user', content: sanitizeUnicode(user) }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`[Scoring v9] ${model} ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function haikuProvisional(candidates, brief, companyProfile) {
  const raw = await callModel(
    HAIKU,
    HAIKU_SYSTEM(brief),
    renderProvisionalPrompt(companyProfile, brief, candidates),
    3000,
    0.1
  );
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    // Regex fallback
    const matches = raw.match(/\{[^{}]*"index"[^{}]*\}/g) || [];
    parsed = [];
    for (const m of matches) try { parsed.push(JSON.parse(m)); } catch {}
  }
  for (let i = 0; i < candidates.length; i++) {
    const r = parsed.find(x => x.index === i);
    candidates[i].provisional_score = r ? Math.max(0, Math.min(100, Number(r.provisional_score || 30))) : 30;
    candidates[i].provisional = true;
  }
  console.log(`[Scoring v9] Fas 7a Haiku provisional: ${candidates.length} profiler scored`);
}

// ============================================================
// === SONNET DEEP (Fas 7b) ====================================
// ============================================================

const SONNET_SYSTEM = (companyProfile, brief) => `Du bedömer hur väl svenska influencers matchar ett företag för samarbete.

Företag: ${companyProfile?.namn || ''}
Bransch: ${companyProfile?.bransch || ''}
Beskrivning: ${companyProfile?.beskrivning || ''}
Nisch: ${brief.primary_niche}
Sekundära nischer: ${(brief.secondary_niches || []).join(', ')}
Målgrupp: ${brief.target_audience}${brief.location ? `\nPLATS-KRAV: ${brief.location} — influencers från/i denna stad/region ska prioriteras.` : ''}

GE VARJE INFLUENCER match_score (0-100) och motivation (max 90 tecken).

STEG 1 — NISCH-SCORE (bas-poäng, viktigast):
Fråga: "Skapar denna person content som företagets kunder tittar på?"
  90-95 bas: Exakt nisch + recenserar/testar/tipsar i nischen
  85-89 bas: Exakt nisch + skapar content i nischen
  75-84 bas: Relaterad nisch, content överlappar
  60-74 bas: Angränsande nisch, viss koppling
  40-59 bas: Svag koppling, bred kanal
  Under 40: Fel nisch

STEG 2 — FÖLJAR-JUSTERING (lägg till/dra av från bas):
  0 eller null:     −50  (ingen data = opålitlig)
  1–50:             −45  (oetablerad, nästan ingen publik)
  50–100:           −35
  100–500:          −20
  500–1000:         −10
  1000–3000:        −3
  3000–10000:       ±0
  10000–50000:      +5
  50000–200000:     +8
  200000+:          +10

STEG 3 — SPRÅK-CHECK:
  Om influencerns bio/content är på ENGELSKA, TYSKA eller annat icke-svenskt
  språk → −20 (dessa borde inte vara med, men om de sluppit igenom vill vi
  inte att de rankas högt).
${brief.location ? `
STEG 4 — PLATS-BONUS (om PLATS-KRAV finns):
  Om influencerns bio, kanalnamn eller content nämner "${brief.location}"
  eller närliggande region → +5 bonus.
  Om influencern tydligt INTE är i rätt region → −5.
  Om oklart/ej nämnt → ±0 (straffa INTE om plats inte framgår).
` : ''}
HÅRDA REGLER (bryt ALDRIG dessa):
- Konto med under 50 följare → ALDRIG över 50 match_score, oavsett nisch
- Konto med under 500 följare → ALDRIG över 65 match_score
- Konto med 1000+ följare i EXAKT rätt nisch → ALDRIG under 75
- Konto med 10000+ följare i RELATERAD nisch → minst 65
- Konto med 50000+ följare i RELATERAD nisch → minst 70
- Icke-svenskt content → ALDRIG över 40
- Använd HELA 0-100-skalan — sprid ut poängen

Returnera STRIKT JSON-array:
[{"index": N, "match_score": 0-100, "motivation": "max 90 tecken"}]
Motivation: nämn INTE namn/följarantal. Fokusera på VARFÖR.`;

function renderDeepPrompt(profiles) {
  const lines = ['Profiler att djup-scora:'];
  profiles.forEach((c, i) => {
    lines.push(
      `[${i}] ${(c.platforms || [c.platform]).join('+')} @${c.handle} — ${c.name || ''}`,
      `  Följare (total reach): ${formatNumber(c.total_reach ?? c.followers)}`,
      `  Bio: ${truncate(c.bio, 300)}`,
      `  Sample caption/titel: ${truncate(c.caption_sample, 200) || '—'}`,
      `  Verified: ${!!c.is_verified}, Business: ${!!c.is_business_account} (${c.business_category || '—'})`,
      `  External: ${c.external_url || '—'}`,
      `  Multi-platform: ${!!c.is_multi_platform} (${c.platform_count || 1})`,
      `  Discovery source: ${c.discovery_source || 'main'}`,
      `  Swedish confidence: ${c.swedish_confidence || 'unknown'}`,
      `  Comment depth: ${c.comment_depth || 0}`,
      ''
    );
  });
  return lines.join('\n');
}

function formatNumber(n) {
  if (n == null) return '?';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Parsa Sonnet-response med truncation-recovery.
 */
export function parseScoredWithTruncation(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const re = /\{[^{}]*"index"\s*:\s*\d+[^{}]*\}/g;
    const matches = raw.match(re) || [];
    const parsed = [];
    for (const m of matches) {
      try { parsed.push(JSON.parse(m)); } catch {}
    }
    console.warn(`[Scoring v9] Truncation recovery: parsed ${parsed.length} objects`);
    return parsed;
  }
}

/**
 * Programmatisk follower-cap som backup — säkerställer att Sonnet-scores
 * respekterar hårda gränser även om LLM:en inte följer prompten perfekt.
 */
export function applyFollowerCap(c) {
  let score = c.match_score || 0;
  const followers = c.total_reach ?? c.followers ?? null;

  if (followers != null) {
    if (followers < 50 && score > 50) {
      console.log(`[FollowerCap] @${c.handle}: ${score} → 50 (under 50 följare)`);
      score = 50;
    } else if (followers < 500 && score > 65) {
      console.log(`[FollowerCap] @${c.handle}: ${score} → 65 (under 500 följare)`);
      score = 65;
    }
  }

  return score;
}

const DEEP_BATCH_SIZE = 25;

async function sonnetDeepBatch(batch, brief, companyProfile) {
  const raw = await callModel(
    SONNET,
    SONNET_SYSTEM(companyProfile, brief),
    renderDeepPrompt(batch),
    4000,
    0.2
  );
  const parsed = parseScoredWithTruncation(raw);
  let scored = 0;
  for (let i = 0; i < batch.length; i++) {
    const r = parsed.find(x => x.index === i);
    if (!r) continue;
    batch[i].match_score = Math.max(0, Math.min(100, Number(r.match_score || 0)));
    batch[i].motivation = String(r.motivation || '').slice(0, 120);
    batch[i].provisional = false;
    scored++;
  }
  return { scored, total: batch.length, parsed: parsed.length };
}

async function sonnetDeep(profiles, brief, companyProfile) {
  let totalScored = 0;
  const batches = Math.ceil(profiles.length / DEEP_BATCH_SIZE);
  for (let b = 0; b < batches; b++) {
    const batch = profiles.slice(b * DEEP_BATCH_SIZE, (b + 1) * DEEP_BATCH_SIZE);
    try {
      const { scored, total, parsed } = await sonnetDeepBatch(batch, brief, companyProfile);
      totalScored += scored;
      console.log(`[Scoring v9] Fas 7b batch ${b + 1}/${batches}: ${scored}/${total} scored (parsed ${parsed} objects)`);
    } catch (err) {
      console.warn(`[Scoring v9] Fas 7b batch ${b + 1}/${batches} failed: ${err.message}`);
    }
  }
  console.log(`[Scoring v9] Fas 7b total: ${totalScored}/${profiles.length} deep scored`);
}

// ============================================================
// === ENTRY POINT =============================================
// ============================================================

/**
 * @param {Candidate[]} candidates - enriched (Fas 6 output, 45-250)
 * @param {object} brief
 * @param {object} companyProfile
 * @returns {Promise<Candidate[]>} - alla candidates med provisional_score,
 *   top 50 med full match_score + dimensioner.
 */
export async function scoreCandidates(candidates, brief, companyProfile) {
  const t0 = Date.now();
  if (candidates.length === 0) return [];

  // 7a: Haiku provisional för alla (snabb sortering)
  await haikuProvisional(candidates, brief, companyProfile);

  // 7b: Sonnet deep för ALLA — batchar i grupper om 25
  const sorted = [...candidates].sort((a, b) => (b.provisional_score || 0) - (a.provisional_score || 0));
  await sonnetDeep(sorted, brief, companyProfile);

  console.log(`[Scoring v9] Done in ${Date.now() - t0}ms`);
  return candidates;
}

export const __test__ = { parseScoredWithTruncation, applyFollowerCap, renderDeepPrompt };
