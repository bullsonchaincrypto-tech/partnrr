// V9 — Orchestrator tests: Fas 8 finalCut + email-finder utils
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ as orch } from '../services/search-v9-orchestrator.js';
import { __test__ as email } from '../services/email-finder-v9.js';

describe('Fas 8 finalCut', () => {
  it('filtrerar på threshold och applicerar follower-cap', () => {
    // Tillräckligt många kandidater så hårda-golvet (15) inte kicker in och adderar d
    const scored = Array.from({ length: 20 }, (_, i) => ({
      handle: `filler${i}`,
      match_score: 50,
      followers: 5000,
      provisional: false,
    }));
    scored.push(
      { handle: 'd_below', match_score: 20, followers: 2000, provisional: false },  // under threshold
      { handle: 'e_capped', match_score: 90, followers: 200, provisional: false },   // followers cappar till 25
    );
    const { final, reserveUsed } = orch.finalCut(scored, [], { threshold: 25, targetMin: 2, capMax: 40 });
    assert.equal(reserveUsed, 0);
    // 'd_below' ska inte finnas (match_score 20 < threshold 25)
    assert.ok(!final.find(c => c.handle === 'd_below'), 'd_below ska ha filtrerats bort');
    // 'e_capped' ska ha match_score cappat till 25
    const e = scored.find(c => c.handle === 'e_capped');
    assert.equal(e.match_score, 25);
  });

  it('reserve-refill när final < targetMin', () => {
    const scored = [
      { handle: 'a', match_score: 85, followers: 8000, provisional: false },
    ];
    const reserve = [
      { handle: 'res1', provisional_score: 60 },
      { handle: 'res2', provisional_score: 55 },
      { handle: 'res3', provisional_score: 30 },  // under 40, exkluderas
    ];
    const { final, reserveUsed } = orch.finalCut(scored, reserve, { targetMin: 3, capMax: 40, threshold: 25 });
    assert.equal(reserveUsed, 2);
    assert.equal(final.length, 3);
    assert.ok(final.find(c => c.handle === 'res1'));
    assert.ok(!final.find(c => c.handle === 'res3'));
  });

  it('sorterar deep-scored före provisional', () => {
    const scored = [
      { handle: 'prov', provisional_score: 95, provisional: true },
      { handle: 'deep', match_score: 70, provisional: false, followers: 10000 },
    ];
    const { final } = orch.finalCut(scored, [], { targetMin: 2, capMax: 10, threshold: 25 });
    assert.equal(final[0].handle, 'deep');  // deep kommer först trots lägre score
  });
});

describe('Email-finder utils', () => {
  it('extractEmail hittar första rimliga email', () => {
    const text = 'Kontakta mig på samarbete@example.se eller via DM';
    assert.equal(email.extractEmail(text), 'samarbete@example.se');
  });

  it('extractEmail filtrerar noreply-adresser', () => {
    const text = 'noreply@foo.com eller anna@annasvensson.se';
    const result = email.extractEmail(text);
    assert.equal(result, 'anna@annasvensson.se');
  });

  it('extractEmail returnerar null vid ingen match', () => {
    assert.equal(email.extractEmail('no email here'), null);
    assert.equal(email.extractEmail(''), null);
    assert.equal(email.extractEmail(null), null);
  });
});
