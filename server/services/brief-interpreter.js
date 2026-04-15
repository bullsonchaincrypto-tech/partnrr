// ============================================================
// V9 Pipeline — Fas 0: Brief Interpreter (Haiku)
// ============================================================
// Tolkar svensk företagsprofil + valfri user-fritext till en strukturerad Brief
// som driver alla efterföljande faser (sökterms-generering, scoring, etc).
//
// Output: Brief — STRIKT JSON enligt v9 spec §5 Fas 0.
// Kostnad: ~$0.002 per anrop.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Du är SparkCollab's briefing-analytiker för svensk influencer-discovery.
Ditt jobb är att tolka en svensk företagsprofil och returnera en strukturerad
brief. Företaget söker svenska INFLUENCERS/KREATÖRER (enskilda människor,
persons-duos eller familjer som skapar content för en publik), INTE företag,
brands, butiker, eller officiella konton.

Returnera STRIKT JSON enligt schema — inga extra tecken, ingen
markdown-wrapping, ingen text före eller efter:

{
  "primary_niche": string,
  "secondary_niches": string[],
  "target_audience": string,
  "size_tier_hint": "nano"|"micro"|"mid-tier"|"large"|"any",
  "must_have_signals": string[],
  "exclusions": string[],
  "platform_priority": ("youtube"|"instagram"|"tiktok")[],
  "lookalike_seeds": string[],
  "hashtag_hints": string[]
}

Regler:
1. primary_niche: max 3 ord, svenska, konkret. Ex: "smart hem", inte "tech".
2. size_tier_hint baseras på företagstyp:
   - B2C lifestyle/tech/hem/mode → "mid-tier"
   - B2B eller specialistprodukt → "micro"
   - Stort mainstream-varumärke → "large"
   - Okänt/otydligt → "mid-tier"
3. must_have_signals: 2-5 st. Ska vara KONKRETA content-beteenden:
   Bra: "recenserar produkter på kamera", "visar installation steg-för-steg",
        "jämför olika modeller sida vid sida"
   Dåligt: "engagerad audience", "äkta personlighet", "bra content"
4. exclusions: 1-5 adjacenta men FEL områden.
5. lookalike_seeds: 0-3 KÄNDA svenska creators i nischen som du VET
   existerar (från träningsdata). Om osäker → tom array.
6. hashtag_hints: 3-5 svenska hashtags (utan #-tecken) aktiva creators i
   nischen använder.
7. platform_priority: rangordna efter var målgruppen faktiskt finns.`;

async function callHaiku(systemPrompt, userPrompt, maxTokens = 600, temperature = 0.2) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('[Brief] ANTHROPIC_API_KEY saknas');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[Brief] Haiku ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function fallbackBrief(foretag) {
  return {
    primary_niche: foretag?.bransch || 'allmänt',
    secondary_niches: [],
    target_audience: 'svensk publik',
    size_tier_hint: 'mid-tier',
    must_have_signals: [],
    exclusions: [],
    platform_priority: ['youtube', 'instagram', 'tiktok'],
    lookalike_seeds: [],
    hashtag_hints: [],
  };
}

function validateBrief(raw, foretag) {
  try {
    // Försök att hitta JSON även om Claude omger med text
    const m = raw.match(/\{[\s\S]*\}/);
    const json = m ? m[0] : raw;
    const b = JSON.parse(json);
    if (typeof b.primary_niche !== 'string' || !b.primary_niche.trim()) {
      throw new Error('primary_niche saknas');
    }
    return {
      primary_niche: String(b.primary_niche).trim().slice(0, 60),
      secondary_niches: Array.isArray(b.secondary_niches) ? b.secondary_niches.slice(0, 4) : [],
      target_audience: typeof b.target_audience === 'string' && b.target_audience.trim()
        ? b.target_audience : 'svensk publik',
      size_tier_hint: ['nano', 'micro', 'mid-tier', 'large', 'any'].includes(b.size_tier_hint)
        ? b.size_tier_hint : 'mid-tier',
      must_have_signals: Array.isArray(b.must_have_signals) ? b.must_have_signals.slice(0, 5) : [],
      exclusions: Array.isArray(b.exclusions) ? b.exclusions.slice(0, 5) : [],
      platform_priority: Array.isArray(b.platform_priority) && b.platform_priority.length > 0
        ? b.platform_priority : ['youtube', 'instagram', 'tiktok'],
      lookalike_seeds: Array.isArray(b.lookalike_seeds) ? b.lookalike_seeds.slice(0, 3) : [],
      hashtag_hints: Array.isArray(b.hashtag_hints) ? b.hashtag_hints.slice(0, 5) : [],
    };
  } catch (err) {
    console.warn(`[Brief] Fallback triggered: ${err.message}`);
    return fallbackBrief(foretag);
  }
}

function renderUserPrompt(foretag, companyProfile, userQuery) {
  const lines = [
    `Företag: ${foretag?.namn || 'okänt'}`,
    `Bransch: ${foretag?.bransch || 'okänd'}`,
    `Beskrivning: ${foretag?.beskrivning || (companyProfile?.beskrivning) || ''}`,
    `Nischer: ${foretag?.nischer || 'ej specificerat'}`,
  ];
  if (userQuery && userQuery.trim()) {
    lines.push('');
    lines.push(`Användarens tilläggsfråga: ${userQuery.trim()}`);
  }
  return lines.join('\n');
}

/**
 * Fas 0 entry point.
 * @returns {Promise<Brief>}
 */
export async function interpretBrief(foretag, companyProfile = {}, userQuery) {
  const t0 = Date.now();
  const id = foretag?.id ?? '?';
  console.log(`[Brief] Started foretag_id=${id}`);
  try {
    const raw = await callHaiku(SYSTEM_PROMPT, renderUserPrompt(foretag, companyProfile, userQuery));
    const brief = validateBrief(raw, foretag);
    console.log(
      `[Brief] Done in ${Date.now() - t0}ms — niche="${brief.primary_niche}", ` +
      `tier=${brief.size_tier_hint}, seeds=${brief.lookalike_seeds.length}, ` +
      `hashtags=${brief.hashtag_hints.length}`
    );
    return brief;
  } catch (err) {
    console.warn(`[Brief] API-fel: ${err.message} — använder fallback`);
    return fallbackBrief(foretag);
  }
}

export const __test__ = { validateBrief, fallbackBrief, renderUserPrompt };
