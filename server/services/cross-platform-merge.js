// ============================================================
// V9 Pipeline — Fas 2.5: Cross-Platform Merge
// ============================================================
// Slår ihop kandidater från flera plattformar baserat på fuzzy-name + bio-link
// matching. Resultatet får is_multi_platform=true + platform_count + platforms[]
// + total_reach (summerad follower-count).
//
// Detta gör att samma creator som finns på YT + IG + TT räknas som EN entitet
// och får hög score i Fas 7 (multi-platform-bonus).

const URL_HANDLE_RE = /(?:instagram\.com|tiktok\.com|youtube\.com)\/(?:@?)([a-zA-Z0-9._-]+)/g;

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[^a-z0-9]/g, '');
}

function normalizeHandle(s) {
  return String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.-]/g, '');
}

/**
 * Extrahera referenser till andra plattformar från bio + external_url.
 * Returnerar { instagram?: handle, tiktok?: handle, youtube?: handle }
 */
export function extractCrossPlatformHandles(c) {
  const text = `${c.bio || ''} ${c.external_url || ''}`;
  const result = {};
  let m;
  URL_HANDLE_RE.lastIndex = 0;
  while ((m = URL_HANDLE_RE.exec(text))) {
    const fullUrl = m[0];
    const handle = m[1];
    if (fullUrl.includes('instagram.com')) result.instagram = handle;
    else if (fullUrl.includes('tiktok.com')) result.tiktok = handle;
    else if (fullUrl.includes('youtube.com')) result.youtube = handle;
  }
  return result;
}

/**
 * Skapa en merge-key för en kandidat. Föredrar normaliserad handle, faller
 * tillbaka på normaliserat namn om handle saknas.
 */
function mergeKey(c) {
  const h = normalizeHandle(c.handle);
  if (h && h.length >= 3) return `h:${h}`;
  const n = normalizeName(c.name);
  if (n && n.length >= 3) return `n:${n}`;
  return null;
}

/**
 * Matcha kandidat-A mot kandidat-B via cross-platform-handle i bio.
 */
function bioReferencesOther(a, b) {
  const aRefs = extractCrossPlatformHandles(a);
  const bHandle = normalizeHandle(b.handle);
  if (!bHandle) return false;
  if (b.platform === 'instagram' && normalizeHandle(aRefs.instagram) === bHandle) return true;
  if (b.platform === 'tiktok' && normalizeHandle(aRefs.tiktok) === bHandle) return true;
  if (b.platform === 'youtube' && normalizeHandle(aRefs.youtube) === bHandle) return true;
  return false;
}

/**
 * Slå ihop kandidater från flera plattformar.
 * @param {RawCandidate[]} candidates
 * @returns {RawCandidate[]} merged-list med multi-platform-flagga.
 */
export function mergeCrossPlatform(candidates) {
  // Steg 1: Gruppera på merge-key (handle eller namn-normaliserat)
  const groups = new Map();
  const unkeyed = [];
  for (const c of candidates) {
    const k = mergeKey(c);
    if (!k) {
      unkeyed.push(c);
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  // Steg 2: För grupper med flera plattformar → merge
  const merged = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(annotateSingle(group[0]));
    } else {
      merged.push(mergeGroup(group));
    }
  }

  // Steg 3: Bio-cross-reference matching för unkeyed (best effort)
  for (const u of unkeyed) merged.push(annotateSingle(u));

  // Steg 4: Bio-reference enrichment över redan-merged
  // Om profile A:s bio refererar @profileB, slå ihop dem om båda finns
  for (const a of merged) {
    if (a.platform_count >= 2) continue;  // redan multi
    for (const b of merged) {
      if (a === b) continue;
      if (a.platform === b.platform) continue;
      if (bioReferencesOther(a, b)) {
        a.is_multi_platform = true;
        b.is_multi_platform = true;
        a.cross_platform_refs = a.cross_platform_refs || [];
        a.cross_platform_refs.push({ platform: b.platform, handle: b.handle });
      }
    }
  }

  return merged;
}

function annotateSingle(c) {
  return {
    ...c,
    platforms: [c.platform],
    platform_count: 1,
    is_multi_platform: false,
    total_reach: c.followers || 0,
    platforms_data: { [c.platform]: c.raw },
  };
}

function mergeGroup(group) {
  const platforms = [...new Set(group.map(c => c.platform))];
  // Välj en "primary" — preferera den med högst engagement
  const primary = [...group].sort((a, b) => (b.engagement_signal || 0) - (a.engagement_signal || 0))[0];
  const total_reach = group.reduce((sum, c) => sum + (c.followers || 0), 0);
  const platforms_data = {};
  for (const c of group) platforms_data[c.platform] = c.raw;
  return {
    ...primary,
    platforms,
    platform_count: platforms.length,
    is_multi_platform: platforms.length >= 2,
    total_reach,
    platforms_data,
    discovery_source: primary.discovery_source,
  };
}

export const __test__ = { extractCrossPlatformHandles, mergeKey, normalizeHandle, normalizeName };
