// ============================================================
// V9 Pipeline — Brand & Swedish keywords (Fas 1, 3, 4)
// ============================================================
// Centraliserad ordlista för svensk-detection och brand-detection.
// Importeras av: ai-search.js, swedish-gate.js, brand-detector.js.

// --- ENGELSKA "MAGNET"-ORD (drar till internationellt content) ---
export const ENGLISH_MAGNETS = new Set([
  'tech', 'review', 'unboxing', 'gadget', 'home', 'alexa', 'apple', 'samsung',
  'gaming', 'vlog', 'tutorial', 'how to', 'vs', 'best', 'top 10', 'amazon',
  'aliexpress', 'iphone', 'android', 'setup', 'haul', 'challenge',
  'reaction', 'compilation', 'trick', 'hack', 'guide', 'lifestyle', 'daily',
  // OBS: 'youtuber' tas EJ med här — den fungerar som CREATOR_KEYWORDS i IG-validatorn,
  // och YT-validatorn kräver ändå svensk markör så ren-engelska "youtuber X" filtreras.
]);

// --- GARANTERAT SVENSKA ORD (räknas som svensk markör) ---
export const GUARANTEED_SWEDISH_WORDS = new Set([
  // Recension/test — OBS: ensamt 'test' är för generiskt (matchar 'product test'),
  // använd istället böjningar.
  'recension', 'recensioner', 'testar', 'testade', 'recenserar',
  // Tech
  'uppkopplade', 'smarta', 'prylar', 'pryl', 'hemautomation',
  'högtalare', 'robotdammsugare', 'apparater',
  // Hem & familj
  'hushåll', 'vardagsrum', 'lägenhet', 'familj', 'sommar', 'vinter',
  'mamma', 'pappa', 'barn', 'husdjur',
  // Mat
  'matlagning', 'bakning', 'recept',
  // Resor
  'resor', 'resa', 'utflykt', 'sverigeresan',
  // Ekonomi
  'sparar', 'ekonomi', 'aktie', 'aktier', 'sparpengar', 'pension',
  // Hälsa & träning
  'träning', 'gym', 'löpning', 'kost', 'hälsa', 'kosthållning',
  // Mode
  'mode', 'stil', 'kläder', 'skönhet', 'smink', 'sminktips',
  // Husdjur
  'hund', 'hundar', 'katt', 'katter', 'hundträning',
  // Allmänna svenska markör-ord
  'tips', 'tipsar', 'berättar', 'guidar', 'visar', 'svenska', 'svensk', 'sverige',
]);

// --- BRAND-MAGNET-ORD (drar till företagskonton) ---
export const BRAND_MAGNETS = new Set([
  'officiell', 'official', 'store', 'shop', 'butik', 'återförsäljare',
  'brand', 'ab', 'aktiebolag', 'sweden official', 'ab sweden',
  'webbshop', 'e-handel', 'shopping',
]);

// --- CREATOR-VOKABULÄR (krav i IG-söktermer) ---
export const CREATOR_KEYWORDS = new Set([
  'youtuber', 'bloggare', 'influencer', 'tiktokare', 'creator',
  'recenserar', 'tipsar', 'berättar', 'visar', 'skapar',
]);

// --- KOMMERSIELLA INSTAGRAM-KATEGORIER (brand-signal B2/B7) ---
export const COMMERCIAL_CATEGORIES = new Set([
  'Shopping & retail',
  'Retail company',
  'Product/service',
  'Brand',
  'Company',
  'E-commerce website',
  'Business service',
  'Local business',
  'Restaurant',
  'Bar',
  'Hotel',
]);

// --- BRAND-MÖNSTER I HANDLES ---
// OBS: Vi använder (?:^|[_\W]) istället för \b eftersom _ räknas som word-char i JS regex,
// vilket annars skulle missa "acme_official" (vanligt brand-handle-mönster).
export const BRAND_HANDLE_REGEX = /(?:^|[_\W])(official|officiell|store|shop|butik|brand|sverige|sweden|ab|hq)(?=$|[_\W])/i;

// --- E-HANDELS-URL-MÖNSTER ---
export const ECOMMERCE_URL_PATTERNS = [
  /shopify\./i,
  /\.myshopify\.com/i,
  /woocommerce/i,
  /\.bigcommerce\.com/i,
  /\.squarespace\.com\/shop/i,
  /\/shop\b/i,
  /\/store\b/i,
  /\/products?\b/i,
  /\/butik\b/i,
];

// --- VI-FORM-PRONOMEN (B5: brand bio i vi-form) ---
export const WE_PRONOUNS = [
  'vi ', 'oss ', 'vårt team', 'vårt företag', 'hos oss', 'kontakta oss',
  'our team', 'our company', 'we offer',
];
export const I_PRONOUNS = [' jag ', ' min ', ' mig ', ' mitt '];

// --- COMPANY INDICATORS (B8) ---
export const COMPANY_INDICATORS_STRINGS = [
  ' ab ', ' aktiebolag', ' hb ', ' inc ', ' ltd', '®', '™',
  'återförsäljare', 'e-handel', 'webbshop',
];
export const COMPANY_INDICATORS_REGEX = [/\d{6}-\d{4}/];

// --- HJÄLPFUNKTIONER ---

/**
 * Validera YouTube-sökterm enligt Fas 1 regler.
 * @returns {boolean} true om termen är godkänd
 */
export function isValidYtTerm(term) {
  if (!term || typeof term !== 'string') return false;
  const lc = term.toLowerCase();
  for (const m of ENGLISH_MAGNETS) if (lc.includes(m)) return false;
  for (const m of BRAND_MAGNETS) if (lc.includes(m)) return false;
  if (/[åäöÅÄÖ]/.test(term)) return true;
  if (/\b(sverige|svensk|svenska)\b/i.test(term)) return true;
  for (const w of GUARANTEED_SWEDISH_WORDS) if (lc.includes(w)) return true;
  return false;
}

/**
 * Validera Instagram/TikTok-sökterm enligt Fas 1 regler.
 * Krav: creator-vokabulär + svensk markör.
 */
export function isValidIgTerm(term) {
  if (!term || typeof term !== 'string') return false;
  const lc = term.toLowerCase();
  for (const m of ENGLISH_MAGNETS) if (lc.includes(m)) return false;
  for (const m of BRAND_MAGNETS) if (lc.includes(m)) return false;
  let hasCreator = false;
  for (const w of CREATOR_KEYWORDS) if (lc.includes(w)) { hasCreator = true; break; }
  if (!hasCreator) return false;
  if (/[åäöÅÄÖ]/.test(term)) return true;
  if (/\b(sverige|svensk|svenska)\b/i.test(term)) return true;
  return false;
}

/**
 * Validera hashtag (utan #) enligt Fas 1 regler.
 */
export function isValidHashtag(tag) {
  if (!tag || typeof tag !== 'string') return false;
  const cleaned = tag.replace(/^#/, '').toLowerCase();
  return /^[a-zåäö0-9_]{4,30}$/i.test(cleaned);
}
