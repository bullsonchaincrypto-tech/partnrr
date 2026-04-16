// ============================================================
// V9 Pipeline — Fas 3: Swedish Gate (8 signaler, hard-filter)
// ============================================================
// Default reject — kandidaten måste passera ≥1 av 8 signaler för att räknas
// som svensk creator. Tre confidence-nivåer:
//   - 'hard'   = stark deterministisk signal (åäö, country=SE, känd stad)
//   - 'soft'   = svag signal (svenskt namn, etablerad svensk hashtag, franc=swe)
//   - 'pending' = otillräcklig data — re-evalueras post-enrichment (Fas 6)

import { franc } from 'franc-min';
import { containsSwedishFirstName } from './data/swedish-names.js';
import { containsSwedishCity } from './data/swedish-cities.js';

const SWEDISH_HASHTAGS = new Set([
  'sverige', 'svensktiktok', 'svenskinfluencer', 'svenskayoutubers',
  'hemautomationsverige', 'smartahem', 'svenskkultur', 'stockholm',
  'göteborg', 'malmö', 'svenskahushåll', 'svenskmode', 'svenskmat',
]);

const SWEDISH_LANG_CODES = new Set(['sv', 'sv-SE', 'se']);

/**
 * Klassificera en candidate enligt 8 signaler. Returnera signal-bag + verdict.
 * @returns {{ pass: boolean, confidence: 'hard'|'soft'|'pending', signals: object }}
 */
export function classifySwedish(c) {
  const sig = {};
  const bio = String(c?.bio || '');
  const name = String(c?.name || '');
  const handle = String(c?.handle || '');
  const caption = String(c?.caption_sample || '');
  const haystack = `${bio} ${name} ${caption}`.toLowerCase();

  // S1: åäö-tecken (HARD)
  if (/[åäöÅÄÖ]/.test(`${bio} ${name} ${caption}`)) sig.S1 = true;

  // S2: YouTube country=SE eller default_language=sv (HARD)
  if (c.country === 'SE') sig.S2_country = true;
  if (c.default_language && SWEDISH_LANG_CODES.has(c.default_language)) sig.S2_lang = true;

  // S3: Svensk stad nämnd i bio/name (HARD)
  if (containsSwedishCity(`${bio} ${name}`)) sig.S3 = true;

  // S4: Svensk markör-ord
  if (/\b(sverige|svensk|svenska)\b/i.test(haystack)) sig.S4 = true;

  // S5: Svenskt förnamn (SOFT)
  if (containsSwedishFirstName(`${name} ${handle}`)) sig.S5 = true;

  // S6: Etablerad svensk hashtag (SOFT)
  for (const tag of SWEDISH_HASHTAGS) {
    if (haystack.includes(`#${tag}`) || haystack.includes(tag)) {
      sig.S6 = true;
      break;
    }
  }

  // S7: franc detekterar svenska från bio + caption (SOFT)
  // Kräver minst 30 tecken för att vara meningsfull
  const francInput = `${bio} ${caption}`.trim();
  let francDetected = null;
  if (francInput.length >= 30) {
    try {
      francDetected = franc(francInput, { minLength: 20 });
      if (francDetected === 'swe') sig.S7 = true;
    } catch {}
  }

  // ANTI-S7: franc detekterar ett ANNAT språk → blockera soft-only pass
  // Tyska, engelska etc. i bion ska inte kunna passera bara på namn/hashtag.
  const NON_SWEDISH_LANGS = new Set(['deu', 'eng', 'fra', 'spa', 'ita', 'por', 'nld', 'pol', 'fin', 'rus', 'tur', 'ara', 'jpn', 'zho', 'kor']);
  if (francDetected && NON_SWEDISH_LANGS.has(francDetected)) {
    sig.ANTI_S7 = francDetected;
  }

  // S8: Discovery via svensk hashtag (om vi sparat hashtaggen i discovery_query)
  if (typeof c.discovery_query === 'string' && /^#?[a-zåäö_]*svensk/i.test(c.discovery_query)) {
    sig.S8 = true;
  }

  // ========================================================
  // HARD REJECTS (för att skärpa svensk-filter)
  // ========================================================

  // HR1: YouTube med country-fält som INTE är SE → reject direkt.
  // V1 hade samma hard-filter och det fungerade bra.
  if (c.platform === 'youtube' && c.country && c.country !== 'SE') {
    sig.HR_YT_NON_SE = c.country;
    return { pass: false, confidence: 'hard-reject', signals: sig };
  }

  // HR2: default_language är non-Swedish explicit → reject
  if (c.default_language && !SWEDISH_LANG_CODES.has(c.default_language)) {
    sig.HR_LANG_NON_SV = c.default_language;
    return { pass: false, confidence: 'hard-reject', signals: sig };
  }

  // Verdict
  const hard = sig.S1 || sig.S2_country || sig.S2_lang || sig.S3 || sig.S4;
  const soft = sig.S5 || sig.S6 || sig.S7 || sig.S8;

  if (hard) return { pass: true, confidence: 'hard', signals: sig };

  // Om franc detekterar icke-svenska i bion → soft-signaler (namn, hashtag) räcker INTE
  if (sig.ANTI_S7 && !sig.S7) {
    return { pass: false, confidence: 'lang-reject', signals: sig };
  }

  if (soft) return { pass: true, confidence: 'soft', signals: sig };

  // Pending = otillräcklig data. Tidigare släppte vi igenom dessa, men det
  // gav för många false-positives. Nu: reject utom om IG/TT med tom bio
  // (då ger vi dem en chans att berikas i Fas 6).
  const hasMinimalData = bio.length >= 20 || caption.length >= 20;
  const isIgOrTt = c.platform === 'instagram' || c.platform === 'tiktok';

  // IG/TT utan data → pending (Fas 6 enrichment kan fylla i)
  if (isIgOrTt && !hasMinimalData) {
    return { pass: true, confidence: 'pending', signals: sig };
  }

  // Allt annat utan svensk signal → reject
  return { pass: false, confidence: 'no-signal-reject', signals: sig };
}

/**
 * Apply Swedish Gate på array av candidates. Mutates each candidate med
 * .swedish_confidence + .swedish_signals.
 */
export function applySwedishGate(candidates) {
  const passed = [];
  const rejected = [];
  for (const c of candidates) {
    const { pass, confidence, signals } = classifySwedish(c);
    c.swedish_confidence = confidence;
    c.swedish_signals = signals;
    if (pass) passed.push(c);
    else rejected.push(c);
  }
  return { passed, rejected };
}

export const __test__ = { classifySwedish, SWEDISH_HASHTAGS };
