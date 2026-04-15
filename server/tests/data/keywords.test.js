// V9 — Brand-keywords valideringstester
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidYtTerm,
  isValidIgTerm,
  isValidHashtag,
} from '../../services/data/brand-keywords.js';
import { containsSwedishFirstName } from '../../services/data/swedish-names.js';
import { containsSwedishCity } from '../../services/data/swedish-cities.js';

describe('isValidYtTerm', () => {
  it('accepterar term med åäö', () => {
    assert.equal(isValidYtTerm('svenska smarta hem'), true);
    assert.equal(isValidYtTerm('hund träning sverige'), true);
  });

  it('avvisar engelska magnet-ord', () => {
    assert.equal(isValidYtTerm('tech recension sverige'), false);
    assert.equal(isValidYtTerm('best svenska prylar'), false);
  });

  it('avvisar brand-magnet-ord', () => {
    assert.equal(isValidYtTerm('officiell svensk butik'), false);
    assert.equal(isValidYtTerm('shop sverige svensk'), false);
  });

  it('avvisar term utan svensk markör', () => {
    assert.equal(isValidYtTerm('home cooking review'), false);
    assert.equal(isValidYtTerm('product test'), false);
  });

  it('accepterar term med garanterat svenskt ord', () => {
    assert.equal(isValidYtTerm('uppkopplade prylar recension'), true);
  });
});

describe('isValidIgTerm', () => {
  it('kräver creator-vokabulär + svensk markör', () => {
    assert.equal(isValidIgTerm('svensk youtuber smart hem'), true);
    assert.equal(isValidIgTerm('tipsar om hundar svenska'), true);
  });

  it('avvisar utan creator-ord', () => {
    assert.equal(isValidIgTerm('svenska prylar test'), false);
  });

  it('avvisar utan svensk markör', () => {
    assert.equal(isValidIgTerm('influencer fitness'), false);
  });
});

describe('isValidHashtag', () => {
  it('accepterar svenska hashtags utan #', () => {
    assert.equal(isValidHashtag('hemautomationsverige'), true);
    assert.equal(isValidHashtag('smartahem'), true);
    assert.equal(isValidHashtag('#smartahem'), true);
  });

  it('avvisar för korta', () => {
    assert.equal(isValidHashtag('abc'), false);
  });

  it('avvisar tecken utanför a-z åäö 0-9 _', () => {
    assert.equal(isValidHashtag('smart-hem'), false);
    assert.equal(isValidHashtag('hello world'), false);
  });
});

describe('containsSwedishFirstName', () => {
  it('hittar etablerade förnamn', () => {
    assert.equal(containsSwedishFirstName('Anna Svensson'), true);
    assert.equal(containsSwedishFirstName('Lars from Stockholm'), true);
  });

  it('false vid endast efternamn', () => {
    assert.equal(containsSwedishFirstName('Mr Brown'), false);
  });
});

describe('containsSwedishCity', () => {
  it('hittar storstäder', () => {
    assert.equal(containsSwedishCity('Bor i Stockholm'), true);
    assert.equal(containsSwedishCity('From Göteborg, Sweden'), true);
  });

  it('false för okänd stad', () => {
    assert.equal(containsSwedishCity('London based'), false);
  });
});
