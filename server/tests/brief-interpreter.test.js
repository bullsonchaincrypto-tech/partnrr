// V9 — brief-interpreter unit tester (validation-logik, ej API-anrop)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../services/brief-interpreter.js';

const { validateBrief, fallbackBrief, renderUserPrompt } = __test__;

describe('validateBrief', () => {
  const foretag = { namn: 'Acme', bransch: 'tech', nischer: '' };

  it('accepterar fullt giltig brief', () => {
    const raw = JSON.stringify({
      primary_niche: 'smart hem',
      secondary_niches: ['hemautomation'],
      target_audience: 'tech-intresserade svenskar',
      size_tier_hint: 'mid-tier',
      must_have_signals: ['recenserar produkter på kamera'],
      exclusions: ['b2b-enterprise'],
      platform_priority: ['youtube', 'instagram'],
      lookalike_seeds: [],
      hashtag_hints: ['smartahem', 'hemautomationsverige'],
    });
    const out = validateBrief(raw, foretag);
    assert.equal(out.primary_niche, 'smart hem');
    assert.equal(out.size_tier_hint, 'mid-tier');
    assert.deepEqual(out.platform_priority, ['youtube', 'instagram']);
  });

  it('parsar JSON inbäddad i markdown', () => {
    const raw = '```json\n{"primary_niche":"smart hem","size_tier_hint":"mid-tier"}\n```';
    const out = validateBrief(raw, foretag);
    assert.equal(out.primary_niche, 'smart hem');
  });

  it('faller tillbaka om primary_niche saknas', () => {
    const raw = JSON.stringify({ size_tier_hint: 'large' });
    const out = validateBrief(raw, foretag);
    assert.equal(out.primary_niche, 'tech');  // fallback från foretag.bransch
  });

  it('clampar arrays till max-längd', () => {
    const raw = JSON.stringify({
      primary_niche: 'foo',
      must_have_signals: Array(20).fill('x'),
      exclusions: Array(20).fill('y'),
      lookalike_seeds: Array(20).fill('z'),
      hashtag_hints: Array(20).fill('h'),
    });
    const out = validateBrief(raw, foretag);
    assert.equal(out.must_have_signals.length, 5);
    assert.equal(out.exclusions.length, 5);
    assert.equal(out.lookalike_seeds.length, 3);
    assert.equal(out.hashtag_hints.length, 5);
  });

  it('default size_tier_hint vid ogiltigt värde', () => {
    const raw = JSON.stringify({ primary_niche: 'x', size_tier_hint: 'gigantic' });
    const out = validateBrief(raw, foretag);
    assert.equal(out.size_tier_hint, 'mid-tier');
  });
});

describe('renderUserPrompt', () => {
  it('inkluderar userQuery när den finns', () => {
    const prompt = renderUserPrompt(
      { namn: 'A', bransch: 'B', beskrivning: 'C', nischer: '' },
      {},
      'extra fråga'
    );
    assert.match(prompt, /extra fråga/);
  });

  it('hoppar över userQuery vid tom string', () => {
    const prompt = renderUserPrompt(
      { namn: 'A', bransch: 'B', beskrivning: 'C', nischer: '' },
      {},
      ''
    );
    assert.doesNotMatch(prompt, /Användarens tilläggsfråga/);
  });
});

describe('fallbackBrief', () => {
  it('producerar en giltig brief även med tomt foretag', () => {
    const out = fallbackBrief({});
    assert.ok(out.primary_niche);
    assert.equal(out.size_tier_hint, 'mid-tier');
    assert.deepEqual(out.platform_priority, ['youtube', 'instagram', 'tiktok']);
  });
});
