// V9 — Brand Detector tests (Fas 4)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyBrand, applyBrandFilter } from '../services/brand-detector.js';

describe('classifyBrand', () => {
  it('rena creator → score 0', () => {
    const r = classifyBrand({
      bio: 'Hej! Jag heter Anna och tipsar om smarta hem-prylar.',
      name: 'Anna Svensson',
      handle: 'annasvensson',
      external_url: 'https://annasvensson.se',
    });
    assert.equal(r.brand_score, 0);
    assert.equal(r.class, 'creator');
  });

  it('B1 isBusinessAccount → score+1', () => {
    const r = classifyBrand({
      bio: 'creator',
      handle: 'foo',
      is_business_account: true,
    });
    assert.equal(r.signals.B1, true);
    assert.ok(r.brand_score >= 1);
  });

  it('B3 brand-mönster i handle → score+1', () => {
    const r = classifyBrand({
      bio: 'foo',
      handle: 'acme_official',
      name: 'Acme',
    });
    assert.equal(r.signals.B3, true);
  });

  it('B5 vi-form utan jag → score+1', () => {
    const r = classifyBrand({
      bio: 'Hos oss på Acme erbjuder vi premium-produkter. Kontakta oss för offert.',
      handle: 'acme',
    });
    assert.equal(r.signals.B5, true);
  });

  it('B5 INTE vi-form om jag förekommer också', () => {
    const r = classifyBrand({
      bio: 'Vi är ett team och jag är grundaren. Kontakta oss!',
      handle: 'foo',
    });
    assert.equal(r.signals.B5, undefined);
  });

  it('B8 företagsindikator (AB) → score+1', () => {
    const r = classifyBrand({
      bio: 'Acme AB säljer prylar online.',
      handle: 'acme',
    });
    assert.equal(r.signals.B8, true);
  });

  it('multi-signal brand → klass=brand', () => {
    const r = classifyBrand({
      bio: 'Hos oss på Acme AB erbjuder vi premium-produkter via vår webbshop.',
      handle: 'acme_official',
      name: 'Acme Official',
      is_business_account: true,
      business_category: 'Shopping & retail',
      external_url: 'https://acme.com/shop',
      followers: 50000,
      raw: { following_count: 30 },
    });
    assert.ok(r.brand_score >= 4);
    assert.equal(r.class, 'brand');
  });
});

describe('applyBrandFilter', () => {
  it('separerar brands från kept (kept inkluderar ambiguous)', () => {
    const cands = [
      { bio: 'svensk creator', handle: 'a' },                                // creator
      { bio: 'Acme AB shop', handle: 'acme', is_business_account: true,
        business_category: 'Shopping & retail',
        external_url: 'https://acme.com/shop',
        is_verified: true,
        followers: 50000,
        raw: { following_count: 30 } },                                       // brand (4+)
      { bio: 'creator', handle: 'foo', is_business_account: true,
        business_category: 'Brand' },                                          // ambiguous (B1+B2=2)
    ];
    const { kept, brands, ambiguous } = applyBrandFilter(cands);
    assert.equal(brands.length, 1);
    assert.equal(kept.length, 2);
    assert.equal(ambiguous.length, 1);
  });
});
