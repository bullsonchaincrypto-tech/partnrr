// ============================================================
// V9 Pipeline — Serper.dev klient
// ============================================================
// Google search-API ersättare för SerpAPI. Används av:
//   - Fas 2.8 list-discovery (Google search för "topp X svenska Y")
//   - Fas 7.5 obscurity-validator (Google rank för creator)
//   - Fas 9 email-finder (waterfall)
//
// API: https://serper.dev/api-key
// Auth: X-API-KEY header.

import { recordProviderEvent } from './provider-health.js';

const URL = 'https://google.serper.dev/search';
const TIMEOUT_MS = 10000;
const PROVIDER = 'serper';

function getKey() {
  const k = process.env.SERPER_API_KEY;
  if (!k) throw new Error('[Serper] SERPER_API_KEY saknas');
  return k;
}

/**
 * Standard Google search. Returnerar Serper's standard-shape:
 *   { searchParameters, organic[], peopleAlsoAsk?, relatedSearches?, ... }
 *
 * @param {string} q - query string
 * @param {object} opts
 * @param {string} [opts.gl='se'] - Geographic location (Sweden default)
 * @param {string} [opts.hl='sv'] - Interface language (Swedish default)
 * @param {number} [opts.num=10] - Antal resultat
 * @param {string} [opts.location] - Specifik plats t.ex. "Stockholm, Sweden"
 * @param {string} [opts.tbs] - Tidsfilter t.ex. "qdr:m" (senaste månaden)
 */
export async function serperSearch(q, { gl = 'se', hl = 'sv', num = 10, location, tbs } = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let status = 0;
  let success = false;
  let errMsg = null;
  try {
    const body = { q, gl, hl, num };
    if (location) body.location = location;
    if (tbs) body.tbs = tbs;
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': getKey(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    status = res.status;
    if (!res.ok) {
      // Försök läsa Serper's error-body för bättre diagnos
      let bodyTxt = '';
      try { bodyTxt = (await res.text()).slice(0, 300); } catch {}
      errMsg = `HTTP ${res.status}${bodyTxt ? ` — ${bodyTxt}` : ''}`;
      throw new Error(`[Serper] ${res.status} — ${bodyTxt || 'no body'}`);
    }
    const data = await res.json();
    success = true;
    return data;
  } catch (err) {
    if (!errMsg) errMsg = err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    recordProviderEvent({
      provider: PROVIDER,
      endpoint: '/search',
      status_code: status,
      duration_ms: Date.now() - t0,
      success,
      error_message: errMsg,
    }).catch(() => {});
  }
}
