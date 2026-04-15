// ============================================================
// V9 — Provider parity tester
// ============================================================
// Verifierar att SC och Hiker producerar identiska RawCandidate-objekt.
// Kör: `node --test server/tests/providers/parity.test.js`

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeIgReelToRaw,
  normalizeTtVideoToRaw,
} from '../../services/providers/scrapecreators.js';
import {
  normalizeHikerUserToRaw,
  normalizeHikerMediaToRaw,
  normalizeHikerProfileResponse,
} from '../../services/providers/hikerapi.js';

const RAW_CANDIDATE_KEYS = [
  'platform', 'handle', 'name', 'bio', 'followers',
  'country', 'default_language', 'external_url',
  'caption_sample', 'engagement_signal',
  'is_business_account', 'business_category', 'is_verified',
  'discovery_source', 'discovery_query', 'raw', 'comment_depth',
];

describe('SC normalizeIgReelToRaw', () => {
  it('mappar typisk reel-shape till RawCandidate', () => {
    const reel = {
      user: {
        username: 'svensk_creator',
        full_name: 'Anna Svensson',
        biography: 'Bor i Stockholm. Recenserar smarta hem-prylar.',
        follower_count: 12500,
        external_url: 'https://annasvensson.se',
        is_business: false,
        category: null,
        is_verified: false,
      },
      caption: { text: 'Min senaste recension av en svensk robotdammsugare!' },
      like_count: 230,
      comment_count: 18,
      share_count: 5,
    };
    const out = normalizeIgReelToRaw(reel, 'svensk smart hem');
    for (const k of RAW_CANDIDATE_KEYS) assert.ok(k in out, `saknar nyckel: ${k}`);
    assert.equal(out.platform, 'instagram');
    assert.equal(out.handle, 'svensk_creator');
    assert.equal(out.followers, 12500);
    assert.equal(out.engagement_signal, 230 + 5 * 18 + 10 * 5);
    assert.equal(out.discovery_query, 'svensk smart hem');
    assert.equal(out.discovery_source, 'main');
  });

  it('hanterar missing fields utan att kasta', () => {
    const out = normalizeIgReelToRaw({}, 'q');
    assert.equal(out.platform, 'instagram');
    assert.equal(out.handle, '');
    assert.equal(out.followers, null);
    assert.equal(out.engagement_signal, 0);
  });
});

describe('SC normalizeTtVideoToRaw', () => {
  it('mappar TikTok-video-shape', () => {
    const video = {
      author: {
        uniqueId: 'sv_creator',
        nickname: 'Sverige Creator',
        signature: 'Tipsar om svenska prylar',
        followerCount: 8000,
        verified: false,
      },
      desc: 'Testar en svensk produkt',
      stats: { diggCount: 1200, commentCount: 80, shareCount: 30 },
    };
    const out = normalizeTtVideoToRaw(video, 'svensk creator');
    assert.equal(out.platform, 'tiktok');
    assert.equal(out.handle, 'sv_creator');
    assert.equal(out.followers, 8000);
    assert.equal(out.engagement_signal, 1200 + 5 * 80 + 10 * 30);
  });
});

describe('Hiker → SC paritet', () => {
  it('normalizeHikerUserToRaw producerar samma fält-set som SC', () => {
    const user = {
      username: 'svensk_creator',
      full_name: 'Anna Svensson',
      biography: 'Bor i Stockholm.',
      follower_count: 5000,
      external_url: 'https://example.se',
      is_business: false,
      category_name: null,
      is_verified: true,
    };
    const out = normalizeHikerUserToRaw(user, 'q');
    for (const k of RAW_CANDIDATE_KEYS) assert.ok(k in out, `saknar nyckel: ${k}`);
    assert.equal(out.platform, 'instagram');
    assert.equal(out.handle, 'svensk_creator');
    assert.equal(out.followers, 5000);
    assert.equal(out.is_verified, true);
  });

  it('normalizeHikerProfileResponse wrappas i { user: {...} } för paritet med SC', () => {
    const raw = {
      user: {
        username: 'foo',
        full_name: 'Foo Bar',
        biography: 'bio',
        follower_count: 100,
        following_count: 50,
        external_url: 'https://x.se',
        is_business: false,
        category_name: null,
        is_verified: false,
        related_profiles: [],
      },
    };
    const out = normalizeHikerProfileResponse(raw);
    assert.ok(out.user);
    assert.equal(out.user.username, 'foo');
    assert.equal(out.user.follower_count, 100);
    assert.equal(out.user.following_count, 50);
    assert.deepEqual(out.user.related_profiles, []);
  });
});
