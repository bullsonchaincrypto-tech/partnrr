// V9 — Rollout + bucket-hash tests
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { foretagBucket, shouldUseV9, v9Enabled } from '../services/v9-rollout.js';

function setEnv(overrides) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
}

describe('foretagBucket', () => {
  it('deterministisk — samma input → samma bucket', () => {
    assert.equal(foretagBucket(42), foretagBucket(42));
    assert.equal(foretagBucket(1), foretagBucket(1));
  });

  it('alltid inom 0-99', () => {
    for (let i = 1; i <= 1000; i++) {
      const b = foretagBucket(i);
      assert.ok(b >= 0 && b < 100, `bucket ${b} out of range för id=${i}`);
    }
  });

  it('distribuerar ungefär jämnt över 0-99', () => {
    const counts = Array(10).fill(0);
    for (let i = 1; i <= 10000; i++) {
      counts[Math.floor(foretagBucket(i) / 10)]++;
    }
    // Varje bucket av 10-range bör ha ~1000 ± tolerans
    for (const c of counts) {
      assert.ok(c > 700 && c < 1300, `bucket-distribution skev: ${counts.join(',')}`);
    }
  });
});

describe('v9Enabled', () => {
  it('true endast när USE_V9_PIPELINE=true', () => {
    setEnv({ USE_V9_PIPELINE: 'false' });
    assert.equal(v9Enabled(), false);
    setEnv({ USE_V9_PIPELINE: 'true' });
    assert.equal(v9Enabled(), true);
    setEnv({ USE_V9_PIPELINE: 'TRUE' });
    assert.equal(v9Enabled(), false);  // strict 'true'
    setEnv({ USE_V9_PIPELINE: undefined });
    assert.equal(v9Enabled(), false);
  });
});

describe('shouldUseV9', () => {
  beforeEach(() => {
    setEnv({ USE_V9_PIPELINE: 'true', V9_SEARCH_ROLLOUT_PCT: '0' });
  });

  it('false vid pct=0', () => {
    assert.equal(shouldUseV9(1), false);
    assert.equal(shouldUseV9(999), false);
  });

  it('true för ALLA vid pct=100', () => {
    setEnv({ V9_SEARCH_ROLLOUT_PCT: '100' });
    for (let i = 1; i <= 100; i++) assert.equal(shouldUseV9(i), true);
  });

  it('false för alla om USE_V9_PIPELINE=false (även pct=100)', () => {
    setEnv({ USE_V9_PIPELINE: 'false', V9_SEARCH_ROLLOUT_PCT: '100' });
    assert.equal(shouldUseV9(1), false);
  });

  it('pct=50 → ca 50% av foretag', () => {
    setEnv({ V9_SEARCH_ROLLOUT_PCT: '50' });
    let inV9 = 0;
    for (let i = 1; i <= 1000; i++) if (shouldUseV9(i)) inV9++;
    assert.ok(inV9 > 400 && inV9 < 600, `förväntade ~500 i V9, fick ${inV9}`);
  });

  it('stabil rollout — samma id går alltid samma väg', () => {
    setEnv({ V9_SEARCH_ROLLOUT_PCT: '25' });
    const r1 = shouldUseV9(42);
    const r2 = shouldUseV9(42);
    const r3 = shouldUseV9(42);
    assert.equal(r1, r2);
    assert.equal(r2, r3);
  });
});
