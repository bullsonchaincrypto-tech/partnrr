// ============================================================
// V9 Pipeline — Social Provider Router
// ============================================================
// Abstraktionslager mellan discovery.js och konkreta providers.
// Alla V9-tjänster importerar HÄRIFRÅN, aldrig direkt från sc/hiker.
//
// Routing:
//   - Default: ScrapeCreators
//   - Om USE_HIKERAPI_FALLBACK=true: IG-anrop → HikerAPI, TT-anrop → SC kvar
//
// Fallback-flippas av provider-health.js när SC 5xx-rate > 10% / 60min.

import * as sc from './scrapecreators.js';
import * as hiker from './hikerapi.js';

function useHiker() {
  return process.env.USE_HIKERAPI_FALLBACK === 'true';
}

// ---------------- INSTAGRAM ----------------
export async function searchReels(term, limit) {
  return useHiker() ? hiker.searchReels(term, limit) : sc.searchReels(term, limit);
}
export async function searchIgHashtag(tag, limit) {
  return useHiker() ? hiker.searchIgHashtag(tag, limit) : sc.searchIgHashtag(tag, limit);
}
export async function getIgProfile(handle) {
  return useHiker() ? hiker.getIgProfile(handle) : sc.getIgProfile(handle);
}

// ---------------- TIKTOK (alltid SC) ----------------
export async function searchTikTokVideo(term, limit) {
  return sc.searchTikTokVideo(term, limit);
}
export async function searchTikTokHashtag(tag, limit) {
  return sc.searchTikTokHashtag(tag, limit);
}
export async function getTikTokProfile(handle) {
  return sc.getTikTokProfile(handle);
}

// Utilities — exponera vilken provider som är aktiv (för logging).
export function activeIgProvider() {
  return useHiker() ? 'hikerapi' : 'scrapecreators';
}
export function activeTtProvider() {
  return 'scrapecreators';
}
