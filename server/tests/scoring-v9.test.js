// V9 — Scoring tests (Fas 7)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../services/scoring-v9.js';
const { parseScoredWithTruncation, applyFollowerCap, renderDeepPrompt } = __test__;

describe('parseScoredWithTruncation', () => {
  it('parsar ren JSON-array', () => {
    const raw = '[{"index":0,"match_score":80,"nischfit":85,"audience_fit":70,"obscurity":60,"authenticity":75,"motivation":"bra"}]';
    const out = parseScoredWithTruncation(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].match_score, 80);
  });

  it('truncation-recovery via regex', () => {
    const raw = '[{"index":0,"match_score":80,"nischfit":85,"audience_fit":70,"obscurity":60,"authenticity":75,"motivation":"bra"},{"index":1,"match_score';
    const out = parseScoredWithTruncation(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].index, 0);
  });
});

describe('applyFollowerCap', () => {
  it('<100 followers → cap 10', () => {
    const c = { followers: 50, match_score: 85 };
    assert.equal(applyFollowerCap(c), 10);
  });

  it('<500 followers → cap 25', () => {
    const c = { followers: 400, match_score: 85 };
    assert.equal(applyFollowerCap(c), 25);
  });

  it('<1000 followers → cap 40', () => {
    const c = { followers: 800, match_score: 85 };
    assert.equal(applyFollowerCap(c), 40);
  });

  it('null followers → cap 10', () => {
    const c = { followers: null, match_score: 85 };
    assert.equal(applyFollowerCap(c), 10);
  });

  it('>= 1000 followers → ingen cap', () => {
    const c = { followers: 5000, match_score: 85 };
    assert.equal(applyFollowerCap(c), 85);
  });

  it('använder total_reach om followers saknas', () => {
    const c = { followers: null, total_reach: 5000, match_score: 85 };
    assert.equal(applyFollowerCap(c), 85);
  });
});

describe('renderDeepPrompt', () => {
  it('inkluderar alla scoring-relevanta fält', () => {
    const profiles = [{
      platform: 'instagram',
      platforms: ['instagram', 'tiktok'],
      handle: 'anna_sv',
      name: 'Anna',
      bio: 'svensk creator',
      followers: 8000,
      total_reach: 13000,
      is_multi_platform: true,
      platform_count: 2,
      discovery_source: 'lookalike',
      swedish_confidence: 'hard',
      comment_depth: 2,
      caption_sample: 'testar smarta hem-prylar',
      engagement_signal: 500,
      is_verified: false,
      is_business_account: false,
    }];
    const prompt = renderDeepPrompt(profiles);
    assert.match(prompt, /@anna_sv/);
    assert.match(prompt, /13\.0k/);
    assert.match(prompt, /Multi-platform: true/);
    assert.match(prompt, /Discovery source: lookalike/);
    assert.match(prompt, /Swedish confidence: hard/);
    assert.match(prompt, /Comment depth: 2/);
  });
});
