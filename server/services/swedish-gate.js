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
  if (francInput.length >= 30) {
    try {
      const detected = franc(francInput, { minLength: 20 });
      if (detected === 'swe') sig.S7 = true;
    } catch {}
  }

  // S8: Discovery via svensk hashtag (om vi sparat hashtaggen i discovery_query)
  if (typeof c.discovery_query === 'string' && /^#?[a-zåäö_]*svensk/i.test(c.discovery_query)) {
    sig.S8 = true;
  }

  // Verdict
  const hard = sig.S1 || sig.S2_country || sig.S2_lang || sig.S3 || sig.S4;
  const soft = sig.S5 || sig.S6 || sig.S7 || sig.S8;

  if (hard) return { pass: true, confidence: 'hard', signals: sig };
  if (soft) return { pass: true, confidence: 'soft', signals: sig };

  // Pending = vi har inte tillräcklig data för att avgöra. Pipen behåller dem
  // för Fas 6 enrichment + omvärdering, men de prioriteras lägre.
  const hasMinimalData = bio.length >= 20 || caption.length >= 20;
  if (!hasMinimalData) return { pass: true, confidence: 'pending', signals: sig };

  // Vi har data och inga svenska signaler → reject
  return { pass: false, confidence: 'pending', signals: sig };
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
