// V9 — Swedish Gate tests (Fas 3)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifySwedish, applySwedishGate } from '../services/swedish-gate.js';

describe('classifySwedish — hard signals', () => {
  it('S1 åäö i bio → hard', () => {
    const r = classifySwedish({ bio: 'jag älskar smarta hem-prylar' });
    assert.equal(r.confidence, 'hard');
    assert.equal(r.signals.S1, true);
  });

  it('S2 country=SE → hard', () => {
    const r = classifySwedish({ bio: 'lifestyle creator', country: 'SE' });
    assert.equal(r.confidence, 'hard');
    assert.equal(r.signals.S2_country, true);
  });

  it('S2 default_language=sv → hard', () => {
    const r = classifySwedish({ bio: 'tech reviews', default_language: 'sv' });
    assert.equal(r.confidence, 'hard');
  });

  it('S3 svensk stad i bio → hard', () => {
    const r = classifySwedish({ bio: 'Born in Stockholm, lifestyle' });
    assert.equal(r.confidence, 'hard');
    assert.equal(r.signals.S3, true);
  });

  it('S4 svensk markör → hard', () => {
    const r = classifySwedish({ bio: 'I cover svenska tech topics' });
    assert.equal(r.confidence, 'hard');
  });
});

describe('classifySwedish — soft signals', () => {
  it('S5 svenskt förnamn → soft', () => {
    const r = classifySwedish({ name: 'Anna', bio: 'creator' });
    assert.equal(r.confidence, 'soft');
    assert.equal(r.signals.S5, true);
  });

  it('S6 svensk hashtag → soft', () => {
    const r = classifySwedish({ bio: 'love #smartahem content' });
    assert.equal(r.signals.S6, true);
  });

  it('S7 franc detection (svensk text) → soft', () => {
    const r = classifySwedish({
      bio: 'Jag tipsar om matlagning och visar mina favoritrecept varje vecka.',
    });
    // Note: bio innehåller åäö → S1 hard kicks in. Test S7 with non-åäö text:
    const r2 = classifySwedish({
      bio: 'Tipsar om matlagning och visar recept varje vecka. Plus snabba tips.',
    });
    assert.equal(r2.signals.S7, true);
  });
});

describe('classifySwedish — pending/reject', () => {
  it('tom bio → pending', () => {
    const r = classifySwedish({ bio: '', name: '', handle: 'foo' });
    assert.equal(r.confidence, 'pending');
    assert.equal(r.pass, true);
  });

  it('tydligt engelsk bio utan signaler → reject', () => {
    const r = classifySwedish({
      bio: 'I am a content creator from Los Angeles. I make lifestyle videos every week for my followers.',
      name: 'Mike Brown',
    });
    assert.equal(r.pass, false);
  });
});

describe('applySwedishGate', () => {
  it('separerar passed/rejected', () => {
    const cands = [
      { bio: 'svensk creator från Stockholm' },
      { bio: 'I am from Brazil and make food videos every single day for my many followers.' },
      { bio: '', name: 'unknown' },
    ];
    const { passed, rejected } = applySwedishGate(cands);
    assert.equal(passed.length, 2);  // 1 hard, 1 pending
    assert.equal(rejected.length, 1);
    // Mutates cand med metadata
    assert.ok(cands[0].swedish_confidence);
    assert.ok(cands[0].swedish_signals);
  });
});
