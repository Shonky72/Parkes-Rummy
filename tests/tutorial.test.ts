import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialTutorialState, reduceTutorial, tutorialDiscardReady,
  tutorialLayoffTarget, tutorialOpeningReady, TUTORIAL_OPENING_IDS,
  TUTORIAL_LAYOFF_IDS, TUTORIAL_AI_PENALTY,
} from '../lib/tutorial';

test('rigged practice hand enforces the real draw/discard/opening sequence and ends in a guaranteed win', () => {
  let state = initialTutorialState();
  assert.equal(state.hand.length, 10);
  assert.equal(state.phase, 'intro');
  state = reduceTutorial(state, { type: 'start' });
  assert.equal(reduceTutorial(state, { type: 'go-down' }).phase, 'first-draw');
  assert.equal(reduceTutorial(state, { type: 'draw', source: 'discard' }).phase, 'first-draw');
  state = reduceTutorial(state, { type: 'draw', source: 'stock' });
  assert.equal(state.hand.length, 11);
  state = reduceTutorial(state, { type: 'select', id: '12D' });
  assert.equal(tutorialDiscardReady(state), true);
  state = reduceTutorial(state, { type: 'discard' });
  assert.equal(state.phase, 'second-draw');
  assert.equal(state.hand.length, 10);

  state = reduceTutorial(state, { type: 'draw', source: 'discard' });
  assert.equal(state.phase, 'opening');
  assert.equal(reduceTutorial(state, { type: 'go-down' }).phase, 'opening');
  for (const id of TUTORIAL_OPENING_IDS) state = reduceTutorial(state, { type: 'select', id });
  assert.equal(tutorialOpeningReady(state), true);
  state = reduceTutorial(state, { type: 'go-down' });
  assert.equal(state.phase, 'second-discard');
  assert.equal(state.yourRun.length, 5);
  assert.equal(state.yourRun[3].rank, 2);
  state = reduceTutorial(state, { type: 'select', id: '14S' });
  state = reduceTutorial(state, { type: 'discard' });
  assert.equal(state.phase, 'third-draw');
  assert.equal(state.hand.length, 5);
  assert.equal(state.opponentRun.length, 5);

  state = reduceTutorial(state, { type: 'draw', source: 'stock' });
  assert.equal(state.hand.length, 6);
  for (const [index, id] of TUTORIAL_LAYOFF_IDS.entries()) {
    state = reduceTutorial(state, { type: 'select', id });
    const target = index === TUTORIAL_LAYOFF_IDS.length - 1 ? 'opponent-run' : 'your-run';
    assert.equal(tutorialLayoffTarget(state), target);
    assert.equal(reduceTutorial(state, { type: 'layoff', target: target === 'your-run' ? 'opponent-run' : 'your-run' }).laidOffCount, index);
    state = reduceTutorial(state, { type: 'layoff', target });
  }
  assert.equal(state.yourRun.length, 9);
  assert.equal(state.opponentRun.length, 6);
  assert.equal(state.phase, 'final-discard');
  state = reduceTutorial(state, { type: 'select', id: '14H' });
  state = reduceTutorial(state, { type: 'discard' });
  assert.equal(state.phase, 'won');
  assert.equal(state.hand.length, 0);
  assert.equal(TUTORIAL_AI_PENALTY, 50);
});

test('incorrect cards and actions never advance a lesson or lose the practice hand', () => {
  let state = initialTutorialState();
  state = reduceTutorial(state, { type: 'start' });
  state = reduceTutorial(state, { type: 'draw', source: 'stock' });
  state = reduceTutorial(state, { type: 'select', id: '13D' });
  assert.equal(tutorialDiscardReady(state), false);
  assert.equal(reduceTutorial(state, { type: 'discard' }).phase, 'first-discard');
  assert.equal(reduceTutorial(state, { type: 'layoff', target: 'your-run' }).phase, 'first-discard');
  assert.equal(reduceTutorial(state, { type: 'restart' }).phase, 'intro');
});
