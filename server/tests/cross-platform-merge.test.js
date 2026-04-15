// V9 — Cross-Platform Merge tests (Fas 2.5)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mergeCrossPlatform, __test__ } from '../services/cross-platform-merge.js';

const { extractCrossPlatformHandles, normalizeHandle, normalizeName, mergeKey } = __test__;

describe('extractCrossPlatformHandles', () => {
  it('hittar IG/TT/YT-länkar i bio', () => {
    const c = {
      bio: 'Find me on https://instagram.com/anna_creator and tiktok.com/@annatiktok',
      external_url: 'https://www.youtube.com/@annayt',
    };
    const r = extractCrossPlatformHandles(c);
    assert.equal(r.instagram, 'anna_creator');
    assert.equal(r.tiktok, 'annatiktok');
    assert.equal(r.youtube, 'annayt');
  });

  it('returnerar tomt objekt vid noll länkar', () => {
    const r = extractCrossPlatformHandles({ bio: 'no links here', external_url: null });
    assert.deepEqual(r, {});
  });
});

describe('normalize helpers', () => {
  it('normalizeHandle strippar @ + lowercase', () => {
    assert.equal(normalizeHandle('@AnnaSV_99'), 'annasv_99');
  });

  it('normalizeName strippar accent + non-alphanumeric', () => {
    // ä → a (via NFD + remove combining), ß bevaras (NFD strippar inte ß), ! tas bort
    assert.equal(normalizeName('Annä Svenßon!'), 'annasvenon');
  });
});

describe('mergeCrossPlatform', () => {
  it('grupperar samma handle på flera plattformar', () => {
    const cands = [
      { platform: 'instagram', handle: 'anna_sv', name: 'Anna', bio: '', followers: 5000, engagement_signal: 100, raw: {} },
      { platform: 'tiktok',    handle: 'anna_sv', name: 'Anna', bio: '', followers: 8000, engagement_signal: 200, raw: {} },
      { platform: 'youtube',   handle: 'unique1', name: 'Other', bio: '', followers: 1000, engagement_signal: 50, raw: {} },
    ];
    const merged = mergeCrossPlatform(cands);
    const annaMerged = merged.find(c => normalizeHandle(c.handle) === 'anna_sv');
    assert.ok(annaMerged);
    assert.equal(annaMerged.is_multi_platform, true);
    assert.equal(annaMerged.platform_count, 2);
    assert.equal(annaMerged.total_reach, 13000);
    // Övriga är fortfarande singel
    const other = merged.find(c => c.handle === 'unique1');
    assert.equal(other.is_multi_platform, false);
  });

  it('matchar via bio-cross-reference', () => {
    const cands = [
      {
        platform: 'instagram',
        handle: 'foo_ig',
        name: 'Foo',
        bio: 'TikTok: tiktok.com/@foo_tt',
        followers: 1000,
        engagement_signal: 50,
        raw: {},
      },
      {
        platform: 'tiktok',
        handle: 'foo_tt',
        name: 'Foo',
        bio: '',
        followers: 5000,
        engagement_signal: 200,
        raw: {},
      },
    ];
    const merged = mergeCrossPlatform(cands);
    // De har olika handles → grupperas inte av merge-key, men bio-ref binder dem
    const ig = merged.find(c => c.handle === 'foo_ig');
    const tt = merged.find(c => c.handle === 'foo_tt');
    assert.equal(ig.is_multi_platform, true);
    assert.equal(tt.is_multi_platform, true);
  });
});
