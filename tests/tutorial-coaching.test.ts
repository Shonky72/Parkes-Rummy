import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTutorialState, reduceTutorial, tutorialDiscardReady, tutorialExpectedCardIds, tutorialLayoffTarget, tutorialOpeningReady } from '../lib/tutorial';
import { placeTutorialCoach, tutorialCoachingStep } from '../lib/tutorial-coaching';

test('Every practice action has a teaching popup at the next real control', () => {
  let state = initialTutorialState();
  const visited = new Set<string>();
  for (let move = 0; move < 80 && state.phase !== 'won'; move++) {
    const lesson = tutorialCoachingStep(state);
    assert.ok(lesson);
    visited.add(lesson.id);
    assert.ok(lesson.body.split(/\s+/).length <= 60, lesson.id);
    assert.ok(lesson.target.length > 5);
    assert.ok(lesson.body.length > 50, 'The explanation must be in the popup, not only “Tap here”');
    if (state.phase === 'sort') state = reduceTutorial(state, { type: 'sort' });
    else if (state.phase === 'sort-mode') {
      assert.match(tutorialCoachingStep(state, true)!.target, /sort-option/);
      state = reduceTutorial(state, { type: 'sort-mode', mode: 'colour' });
    } else if (state.phase === 'settings') state = reduceTutorial(state, { type: 'settings-done' });
    else if (['first-draw', 'third-draw'].includes(state.phase)) state = reduceTutorial(state, { type: 'draw', source: 'stock' });
    else if (state.phase === 'second-draw') state = reduceTutorial(state, { type: 'draw', source: 'discard' });
    else if (state.phase === 'opening' && tutorialOpeningReady(state)) {
      assert.match(lesson.target, /go-down/);
      state = reduceTutorial(state, { type: 'go-down' });
    } else if (tutorialDiscardReady(state)) {
      assert.match(lesson.target, /discard-button/);
      state = reduceTutorial(state, { type: 'discard' });
    } else if (tutorialLayoffTarget(state)) {
      const target = tutorialLayoffTarget(state)!;
      assert.match(lesson.target, target === 'opponent-run' ? /opponent-run/ : /your-run/);
      state = reduceTutorial(state, { type: 'layoff', target });
    } else {
      const id = tutorialExpectedCardIds(state).find(value => !state.selected.includes(value))!;
      assert.equal(lesson.target, `[data-tutorial-card="${id}"]`);
      state = reduceTutorial(state, { type: 'select', id });
    }
  }
  assert.equal(state.phase, 'won');
  assert.equal(state.hand.length, 0);
  assert.equal(tutorialCoachingStep(state), null);
  assert.ok(visited.has('opening:2D'), 'Explain the wild 2 on the actual card');
  assert.ok(visited.has('first-discard:button'));
  assert.ok(visited.has('layoff:place-4'), 'Teach adding to the other player');
});

test('Popup stays inside desktop, mobile, landscape and zoomed viewports without covering its target', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390], [720, 450]]) {
    for (const offset of [0, 28]) {
      for (const fraction of [0.05, 0.3, 0.5, 0.8]) {
        for (const targetWidth of [55, width - 50]) {
          const target = { left: (width - targetWidth) / 2, top: offset + fraction * (height - 90), right: (width + targetWidth) / 2, bottom: offset + fraction * (height - 90) + 60 };
          const p = placeTutorialCoach(target, 264, { left: 0, top: offset, width, height });
          const h = Math.min(264, p.maxHeight);
          assert.ok(p.left >= 0 && p.top >= offset, JSON.stringify(p));
          assert.ok(p.left + p.width <= width + 1);
          assert.ok(p.top + h <= offset + height + 1);
          assert.ok(p.maxHeight > 0);
          const overlaps = p.left < target.right && p.left + p.width > target.left && p.top < target.bottom && p.top + h > target.top;
          assert.equal(overlaps, false, JSON.stringify({ width, height, target, p }));
        }
      }
    }
  }
});
