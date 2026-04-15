// V9 — Haiku Classifier tests (Fas 5)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../services/haiku-classifier.js';
const { parseClassifications, renderUserPrompt, truncate } = __test__;

describe('parseClassifications', () => {
  it('parsar ren JSON-array', () => {
    const raw = '[{"index":0,"class":"creator","confidence":0.9},{"index":1,"class":"brand","confidence":0.8}]';
    const out = parseClassifications(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0].class, 'creator');
  });

  it('truncation-recovery: extraherar kompletta objekt', () => {
    const truncated = '[{"index":0,"class":"creator","confidence":0.9},{"index":1,"class":"brand","confidence":0.8},{"index":2,"cla';
    const out = parseClassifications(truncated);
    assert.equal(out.length, 2);
    assert.equal(out[1].index, 1);
  });

  it('returnerar tom array vid helt trasig JSON', () => {
    const out = parseClassifications('not json at all');
    assert.deepEqual(out, []);
  });
});

describe('renderUserPrompt', () => {
  it('formaterar batch med alla profil-fält', () => {
    const batch = [{
      platform: 'instagram',
      handle: 'anna_sv',
      name: 'Anna',
      bio: 'svensk creator',
      followers: 5000,
      raw: { following_count: 300 },
      external_url: 'https://anna.se',
      is_business_account: false,
      business_category: null,
      caption_sample: 'testar en pryl',
    }];
    const prompt = renderUserPrompt(batch);
    assert.match(prompt, /@anna_sv/);
    assert.match(prompt, /svensk creator/);
    assert.match(prompt, /Followers: 5000/);
  });
});

describe('truncate', () => {
  it('trunkerar långa strings med ellipsis', () => {
    assert.equal(truncate('abcdefgh', 5), 'abcde…');
    assert.equal(truncate('abc', 10), 'abc');
    assert.equal(truncate(null, 10), '');
  });
});
