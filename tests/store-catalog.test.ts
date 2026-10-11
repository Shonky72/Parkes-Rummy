import test from 'node:test';
import assert from 'node:assert/strict';
import { FONT_STYLES, PLAYER_SYMBOLS, STORE_PRODUCTS } from '../lib/store-catalog';
test('store uses owner-approved one-off prices',()=>{
  assert.equal(STORE_PRODUCTS.remove_ads.amount,199);
  assert.equal(STORE_PRODUCTS.fonts_pack.amount,199);
  assert.equal(STORE_PRODUCTS.symbols_pack.amount,199);
  assert.equal(STORE_PRODUCTS.voice_access.amount,299);
  assert.equal(STORE_PRODUCTS.everything_pack.amount,599);
});
test('everything pack grants every premium entitlement',()=>{
  assert.deepEqual([...STORE_PRODUCTS.everything_pack.grants],['remove_ads','premium_fonts','premium_symbols','voice_chat']);
});
test('catalog has twenty premium fonts and forty premium symbols',()=>{
  assert.equal(Object.keys(FONT_STYLES).length-1,20);
  assert.equal(Object.keys(PLAYER_SYMBOLS).length-1,40);
});
