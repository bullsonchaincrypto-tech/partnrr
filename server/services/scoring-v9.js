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

const SONNET_SYSTEM = (companyProfile, brief) => `Du är SparkCollab's influencer-matchnings-expert. Du scorar svenska kreatörer
mot ett brand.

Företag: ${companyProfile?.namn || ''}
Bransch: ${companyProfile?.bransch || ''}
Beskrivning: ${companyProfile?.beskrivning || ''}
Nisch: ${brief.primary_niche}
Sekundära nischer: ${(brief.secondary_niches || []).join(', ')}
Målgrupp: ${brief.target_audience}
Must-have signals: ${(brief.must_have_signals || []).join('; ')}
Exclusions: ${(brief.exclusions || []).join(', ')}
Size tier hint: ${brief.size_tier_hint}

Scora varje profil på FYRA dimensioner (var och en 0-100):

1. NISCHFIT (40% vikt) — Hur exakt matchar content-nischen företagets bransch?
   Kolla bio, sample captions/titlar, business category. Must-have signals
   måste speglas för hög nischfit.

2. AUDIENCE-FIT (20% vikt) — Matchar deras publik företagets målgrupp?
   Bedöm från content-ton, ämnesval, språknivå.

3. OBSCURITY / NON-OBVIOUS VALUE (25% vikt) — KRITISKT.
   En brand kan redan Googla "svensk teknikbloggare" och hitta topp-5. Straffa
   hårt profiler som är uppenbara toppsök-träffar.

   Belöna:
   - Mid-tier creators (5K-100K followers) med hög engagement relativt storlek
   - Nischade specialister hellre än breda generalister
   - multi_platform = true → +5 bonus
   - discovery_source = "comment" → +5 (community-engagerad)
   - discovery_source = "lookalike" → +3 (peer-validerad)
   - discovery_source = "lookalike_fof" → +4 (djup-peer-validerad)
   - discovery_source = "hashtag" → +3
   - discovery_source = "bio_harvest" → +2
   - discovery_source = "long_tail" → +4

   Straffa:
   - discovery_source = "list" → -3 (finns redan på publicerade listor)
   - Mega-influencers (>500K) som alla redan känner
   - Generalister som täcker många nischer ytligt
   - Standard-bios med bara "influencer", "creator" utan content-detaljer

4. AUTENTICITET (15% vikt) — Datakvalitet:
   - Riktig bio, extern URL, postar nyligen → hög
   - Tom bio, inget externt → låg
   - Saknar followers-data (null) → autenticitet max 40 (okänt ≠ dåligt)
   - Har bio/caption men saknar followers → autenticitet max 50
   - comment_depth >= 2 → +10 authenticity
   - platform_count >= 3 → +5 authenticity

match_score = round(nischfit*0.40 + audience_fit*0.20 + obscurity*0.25 + authenticity*0.15)

Hårda capar på match_score:
- < 1000 followers → cap 40
- < 500 followers → cap 25
- < 100 followers (bekräftat) → cap 10
- followers = null (okänt, data saknas) → cap 50 (straffa INTE okänt lika hårt som noll)
- Inget must-have-signal speglat i bio/captions → nischfit cap 60

Returnera STRIKT JSON-array:
[{"index": N, "match_score": 0-100, "nischfit": N, "audience_fit": N,
  "obscurity": N, "authenticity": N, "motivation": "max 90 tecken"}]`;

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
      `  Engagement-signal: ${c.engagement_signal || 0}`,
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

export function applyFollowerCap(c) {
  const raw = c.followers ?? c.total_reach;
  let cap = 100;
  if (raw == null) {
    // Okänt antal följare (t.ex. SC nere) — straffa INTE hårt.
    // Cap 50 = kan fortfarande rankas men inte slå ut berikade profiler.
    cap = 50;
  } else if (raw === 0 || raw < 100) {
    cap = 10;
  } else if (raw < 500) {
    cap = 25;
  } else if (raw < 1000) {
    cap = 40;
  }
  return Math.min(c.match_score || 0, cap);
}

async function sonnetDeep(top50, brief, companyProfile) {
  const raw = await callModel(
    SONNET,
    SONNET_SYSTEM(companyProfile, brief),
    renderDeepPrompt(top50),
    5000,
    0.2
  );
  const parsed = parseScoredWithTruncation(raw);
  let scored = 0;
  let capped = 0;
  for (let i = 0; i < top50.length; i++) {
    const r = parsed.find(x => x.index === i);
    if (!r) continue;
    top50[i].match_score = Math.max(0, Math.min(100, Number(r.match_score || 0)));
    top50[i].nischfit = Number(r.nischfit || 0);
    top50[i].audience_fit = Number(r.audience_fit || 0);
    top50[i].obscurity = Number(r.obscurity || 0);
    top50[i].authenticity = Number(r.authenticity || 0);
    top50[i].motivation = String(r.motivation || '').slice(0, 120);
    top50[i].provisional = false;
    scored++;
    const beforeCap = top50[i].match_score;
    top50[i].match_score = applyFollowerCap(top50[i]);
    if (top50[i].match_score < beforeCap) {
      capped++;
      console.log(`[Scoring v9] Cap @${top50[i].handle}: ${beforeCap}→${top50[i].match_score} (followers=${top50[i].followers}, total_reach=${top50[i].total_reach})`);
    }
  }
  console.log(`[Scoring v9] Fas 7b parsed ${scored}/${top50.length} complete objects (truncation: ${parsed.length < top50.length ? 'yes' : 'no'})`);
  console.log(`[Scoring v9] Follower caps applied: ${capped}`);
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

  // 7a: Haiku provisional för alla
  await haikuProvisional(candidates, brief, companyProfile);

  // 7b: Top 50 → Sonnet deep
  const sorted = [...candidates].sort((a, b) => (b.provisional_score || 0) - (a.provisional_score || 0));
  const top50 = sorted.slice(0, 50);
  await sonnetDeep(top50, brief, companyProfile);

  console.log(`[Scoring v9] Done in ${Date.now() - t0}ms`);
  return candidates;
}

export const __test__ = { parseScoredWithTruncation, applyFollowerCap, renderDeepPrompt };
