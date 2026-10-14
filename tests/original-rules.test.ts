import test from 'node:test';
import assert from 'node:assert/strict';
import { findOpeningMelds, getLayoffTargets, RULES } from '../lib/rummy';
import type { Card, Suit } from '../lib/types';

let serial=0;
const c=(rank:number,suit:Suit):Card=>({id:`o-${++serial}`,rank,suit});

test('Original Rules exposes the ten-rule set',()=>{assert.equal(RULES[4].length,10);assert.match(RULES[4][9].title,/Hand of Hearts/);});

test('Original Rule 1 requires two same-suit pairs inside the four of a kind',()=>{
  assert.ok(findOpeningMelds([c(7,'H'),c(7,'H'),c(7,'C'),c(2,'C')],4,1));
  assert.equal(findOpeningMelds([c(7,'H'),c(7,'D'),c(7,'C'),c(7,'S')],4,1),null);
});

test('Original Rule 3 is a natural same-colour run of ten',()=>{
  const cards=Array.from({length:10},(_,i)=>c(5+i,i%2?'H':'D'));
  assert.ok(findOpeningMelds(cards,4,3));
  const withTwo=[...cards];withTwo[5]=c(2,'H');
  assert.equal(findOpeningMelds(withTwo,4,3),null);
});

test('Original Rule 5 keeps alternating colours after laydown',()=>{
  const meld=findOpeningMelds([c(5,'H'),c(6,'C'),c(7,'D'),c(8,'S'),c(9,'H'),c(10,'C')],4,5)![0];
  assert.equal(getLayoffTargets(c(11,'D'),[meld]).length,1);
  assert.equal(getLayoffTargets(c(11,'C'),[meld]).length,0);
});

test('Original Rule 6 is specifically a suited royal flush',()=>{
  assert.ok(findOpeningMelds([c(10,'H'),c(11,'H'),c(2,'H'),c(13,'H'),c(14,'H')],4,6));
  assert.equal(findOpeningMelds([c(9,'H'),c(10,'H'),c(11,'H'),c(12,'H'),c(13,'H')],4,6),null);
});

test('Original Rule 8 requires one pair of every suit',()=>{
  assert.ok(findOpeningMelds([c(5,'C'),c(5,'C'),c(6,'D'),c(6,'D'),c(7,'H'),c(2,'H'),c(8,'S'),c(8,'S')],4,8));
});

test('Original Rule 10 is the Hand of Hearts finale',()=>{
  assert.ok(findOpeningMelds([c(5,'H'),c(6,'H'),c(7,'H'),c(8,'H'),c(9,'H'),c(12,'H'),c(12,'H'),c(2,'H')],4,10));
  assert.equal(findOpeningMelds([c(5,'H'),c(6,'H'),c(7,'H'),c(8,'H'),c(9,'H'),c(12,'H'),c(12,'H'),c(2,'D')],4,10),null);
});
