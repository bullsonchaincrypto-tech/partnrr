// V9 — List Discovery + Comment Discovery tests (Fas 2.6 + 2.8)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ as listTest } from '../services/list-discovery.js';
import { __test__ as commentTest } from '../services/comment-discovery.js';

describe('List Discovery — extractHandlesFromText', () => {
  it('extraherar IG/TT/YT-handles från text-blob', () => {
    const text = `
      Topp svenska creators:
      - https://instagram.com/anna_sv
      - https://www.tiktok.com/@bjorn_creator
      - https://youtube.com/@karl_yt
      - https://instagram.com/lisa.lifestyle
    `;
    const found = listTest.extractHandlesFromText(text);
    assert.ok(found.find(f => f.platform === 'instagram' && f.handle === 'anna_sv'));
    assert.ok(found.find(f => f.platform === 'tiktok' && f.handle === 'bjorn_creator'));
    assert.ok(found.find(f => f.platform === 'youtube' && f.handle === 'karl_yt'));
    assert.ok(found.find(f => f.platform === 'instagram' && f.handle === 'lisa.lifestyle'));
  });

  it('returnerar tom array vid noll länkar', () => {
    assert.deepEqual(listTest.extractHandlesFromText('no links here'), []);
  });
});

describe('List Discovery — buildQueries', () => {
  it('genererar 3 svenska queries', () => {
    const qs = listTest.buildQueries({ primary_niche: 'smart hem' });
    assert.equal(qs.length, 3);
    for (const q of qs) {
      assert.match(q, /smart hem/);
      assert.match(q, /sverige|svensk/i);
    }
  });
});

describe('Comment Discovery — extractMentionsFromComments', () => {
  it('extraherar @-mentions och deduplicerar', () => {
    const comments = [
      'Kolla också in @anna_sv och @karl_yt',
      'Tack @anna_sv för tipset!',
      'Borde följa @karl_yt',
      '@here ignore generic',
    ];
    const m = commentTest.extractMentionsFromComments(comments);
    assert.ok(m.includes('anna_sv'));
    assert.ok(m.includes('karl_yt'));
    assert.ok(!m.includes('here'));  // filtreras
  });

  it('filtrerar för korta handles (<4 chars)', () => {
    const m = commentTest.extractMentionsFromComments(['Hello @ab @abc @abcd']);
    assert.ok(!m.includes('ab'));
    assert.ok(!m.includes('abc'));
    assert.ok(m.includes('abcd'));
  });
});
