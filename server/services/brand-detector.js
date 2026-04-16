// ============================================================
// V9 Pipeline — Fas 4: Deterministic Brand Filter (8 signaler)
// ============================================================
// Körs EFTER enrichment (Fas 4) så bio/followers/category finns tillgängligt.
// Fångar brands deterministiskt innan Haiku-classifier (Fas 6).
// Verdict:
//   - score >= 3 → 'brand' (REJECT)
//   - score 2   → 'ambiguous' (skicka till Haiku)
//   - score 0-1 → 'creator' (passera direkt)

import {
  COMMERCIAL_CATEGORIES,
  BRAND_HANDLE_REGEX,
  ECOMMERCE_URL_PATTERNS,
  WE_PRONOUNS,
  I_PRONOUNS,
  COMPANY_INDICATORS_STRINGS,
  COMPANY_INDICATORS_REGEX,
} from './data/brand-keywords.js';

/**
 * @returns {{ class: 'brand'|'ambiguous'|'creator', brand_score: number, signals: object }}
 */
export function classifyBrand(c) {
  let score = 0;
  const sig = {};
  const bio = String(c?.bio || '').toLowerCase();
  const handle = String(c?.handle || '');
  const name = String(c?.name || '');

  // B1: isBusinessAccount (IG)
  if (c.is_business_account === true) { score++; sig.B1 = true; }

  // B2: Kommersiell business-kategori
  if (c.business_category && COMMERCIAL_CATEGORIES.has(c.business_category)) {
    score++; sig.B2 = c.business_category;
  }

  // B3: Brand-mönster i handle eller namn
  if (BRAND_HANDLE_REGEX.test(handle) || BRAND_HANDLE_REGEX.test(name)) {
    score++; sig.B3 = true;
  }

  // B4: E-handels-URL
  if (c.external_url && ECOMMERCE_URL_PATTERNS.some(p => p.test(c.external_url))) {
    score++; sig.B4 = true;
  }

  // B5: Pronomen-analys — "vi" utan "jag" (utrymme runt orden för word-boundary)
  const bioPadded = ` ${bio} `;
  const hasWe = WE_PRONOUNS.some(p => bioPadded.includes(p));
  const hasI = I_PRONOUNS.some(p => bioPadded.includes(p));
  if (hasWe && !hasI) { score++; sig.B5 = true; }

  // B6: Follower/following ratio extrem (brands följer få)
  const following = c.raw?.following_count ?? c.raw?.user?.following_count;
  if (c.followers != null && c.followers > 5000 && following != null && following < 50) {
    score++; sig.B6 = true;
  }

  // B7: Verifierad + commercial category
  if (c.is_verified && c.business_category && COMMERCIAL_CATEGORIES.has(c.business_category)) {
    score++; sig.B7 = true;
  }

  // B8: Företagsindikatorer i bio
  let b8 = false;
  for (const s of COMPANY_INDICATORS_STRINGS) {
    if (bioPadded.includes(s)) { b8 = true; break; }
  }
  if (!b8) {
    for (const re of COMPANY_INDICATORS_REGEX) {
      if (re.test(bio)) { b8 = true; break; }
    }
  }
  if (b8) { score++; sig.B8 = true; }

  let klass;
  if (score >= 3) klass = 'brand';
  else if (score >= 2) klass = 'ambiguous';
  else klass = 'creator';

  return { class: klass, brand_score: score, signals: sig };
}

/**
 * Apply brand-filter. Mutates each candidate.
 */
export function applyBrandFilter(candidates) {
  const kept = [];
  const ambiguous = [];
  const brands = [];
  for (const c of candidates) {
    const r = classifyBrand(c);
    c.brand_score = r.brand_score;
    c.brand_signals = r.signals;
    c.classification = r.class;
    if (r.class === 'brand') brands.push(c);
    else if (r.class === 'ambiguous') {
      ambiguous.push(c);
      kept.push(c);  // Keeps i pipen, men flaggas för Haiku
    } else kept.push(c);
  }
  return { kept, ambiguous, brands };
}
