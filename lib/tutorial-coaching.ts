import {
  TUTORIAL_OPENING_IDS, tutorialDiscardReady, tutorialExpectedCardIds,
  tutorialLayoffTarget, tutorialOpeningReady, type TutorialState,
} from './tutorial';

export interface CoachingStep {
  id: string;
  number: number;
  title: string;
  body: string;
  cue: string;
  target: string;
}

const names: Record<string, string> = {
  '5H': '5 of hearts', '6C': '6 of clubs', '7D': '7 of diamonds',
  '2D': 'wild 2', '9S': '9 of spades', '12D': 'queen of diamonds',
  '14S': 'ace of spades', '10C': '10 of clubs', '11H': 'jack of hearts',
  '12S': 'queen of spades', '13D': 'king of diamonds',
  '10D': '10 of diamonds', '14H': 'ace of hearts',
};
const cardTarget = (id: string) => `[data-tutorial-card="${id}"]`;

/** Each lesson lives in one popup, beside the next real control or card. */
export function tutorialCoachingStep(state: TutorialState, sortMenuOpen = false): CoachingStep | null {
  const step = (number: number, title: string, body: string, cue: string, target: string, suffix = ''): CoachingStep => ({
    id: `${state.phase}:${suffix}`, number, title, body, cue, target,
  });
  switch (state.phase) {
    case 'sort': return step(1, 'Tidy your cards',
      'These are your cards. Tap Sort to put the numbers in order. A tidy hand makes matching cards easier to spot.',
      'Tap Sort.', '[data-tutorial-sort] .sort-button');
    case 'sort-mode': return sortMenuOpen
      ? step(2, 'Group matching colours',
        'Choose By colour to put red cards together and black cards together. By suit groups hearts, diamonds, clubs and spades instead.',
        'Choose By colour.', '.sort-options-popover .sort-option:nth-of-type(2)', 'menu')
      : step(2, 'Try another order',
        'Press and hold Sort until a small menu opens. Keep holding for about half a second. With a keyboard, press the down arrow on Sort.',
        'Press and hold Sort.', '[data-tutorial-sort] .sort-button', 'hold');
    case 'settings': return step(3, 'Find your settings',
      'The gear opens Settings. This is where you change sounds and choose whether big or small cards come first. Open Settings, then press Done when ready.',
      'Tap Settings.', '[data-tutorial-settings]');
    case 'first-draw': return step(4, 'Pick up one card',
      'Every turn starts by picking up one card. This face-down pile holds surprise cards. Tap the pile to take the top card.',
      'Tap the draw pile.', '[data-tutorial-stock]');
    case 'first-discard':
    case 'second-discard':
    case 'final-discard': {
      const final = state.phase === 'final-discard';
      const first = state.phase === 'first-discard';
      const number = first ? 5 : final ? 11 : 8;
      if (tutorialDiscardReady(state)) return step(number, final ? 'Empty your hand!' : 'Put the card away',
        final ? 'Only one card is left. Press Discard to put this card down and finish the hand.'
          : 'Your chosen card is raised up. Press Discard to put this card on the face-up pile and end your turn.',
        'Press Discard.', '[data-tutorial-discard-button]', 'button');
      const id = tutorialExpectedCardIds(state)[0];
      return step(number, final ? 'Your last card' : first ? 'Choose a card to discard' : 'Your run is down!',
        first ? 'You have 11 cards now. On your first turn, draw and discard only. Tap the glowing queen of diamonds to choose a card to put away.'
          : final ? 'One card remains: the ace of hearts. Tap this card first. Then we will put the card on the discard pile.'
          : 'Your run is on the table. Wait until your next turn to add more cards. For now, tap the ace of spades. An ace left in your hand costs 20 points.',
        `Tap the ${names[id]}.`, cardTarget(id), 'card');
    }
    case 'second-draw': return step(6, 'Take a useful card',
      'Alex put a 9 of spades on the face-up pile. Your run needs this 9. Take the top face-up card instead of drawing a surprise card.',
      'Tap the 9 on the discard pile.', '[data-tutorial-discard-pile]');
    case 'opening': {
      if (tutorialOpeningReady(state)) return step(7, 'Place your run on the table',
        'Your five chosen cards make 5, 6, 7, 8, 9. The wild 2 fills the gap for 8. Press Go Down to place the whole run on the table.',
        'Press Go Down.', '[data-tutorial-go-down]', 'ready');
      const id = TUTORIAL_OPENING_IDS.find(value => !state.selected.includes(value)) ?? TUTORIAL_OPENING_IDS[0];
      const body = id === '5H' ? 'A run is numbers in order, such as 5, 6, 7, 8, 9. We will choose five cards together. Start with the glowing 5.'
        : id === '2D' ? 'This 2 is wild. A wild card pretends to be a missing number. We need an 8, so this 2 will be our 8. Tap the wild 2.'
        : id === '9S' ? 'The wild 2 is our 8. Add this 9 to finish the run: 5, 6, 7, 8, 9. Tap the glowing 9.'
        : `Good! Keep the raised cards selected. Now tap the ${names[id]} to add the next number to your run.`;
      return step(7, id === '2D' ? 'Meet the wild card' : 'Build your run', body,
        `Tap the ${names[id]}.`, cardTarget(id), id);
    }
    case 'third-draw': return step(9, 'Start your next turn',
      'Alex has put a run on the table too. You will add spare cards to both runs soon. First, pick up one card from the draw pile.',
      'Tap the draw pile.', '[data-tutorial-stock]');
    case 'layoff': {
      const target = tutorialLayoffTarget(state);
      if (target) {
        const opponent = target === 'opponent-run';
        return step(10, opponent ? 'Add to Alex’s run' : 'Make your run longer',
          opponent ? 'Alex’s run ends in 9. Your 10 fits next. After going down on an earlier turn, you are allowed to add cards to another player’s run too.'
            : 'This card is the next number after the end of your run. Tap the glowing run to move the card from your hand to the table.',
          opponent ? 'Tap Alex’s glowing run.' : 'Tap your glowing run.',
          opponent ? '[data-tutorial-opponent-run]' : '[data-tutorial-your-run]', `place-${state.laidOffCount}`);
      }
      const id = tutorialExpectedCardIds(state)[0];
      return step(10, id === '10D' ? 'Help yourself to Alex’s run' : 'Use your spare cards',
        `Tap the glowing ${names[id]}. Next, we will add this card to ${id === '10D' ? 'Alex’s' : 'your'} run on the table.`,
        `Tap the ${names[id]}.`, cardTarget(id), `pick-${id}`);
    }
    case 'won': return null;
  }
}

export interface CoachRect { left: number; top: number; right: number; bottom: number }
export interface CoachViewport { left: number; top: number; width: number; height: number }
export interface CoachPlacement { left: number; top: number; width: number; maxHeight: number; side: 'left' | 'right' | 'above' | 'below' }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, Math.max(low, high)));

/** Keep the popup inside the visible viewport and outside its click target. */
export function placeTutorialCoach(target: CoachRect, naturalHeight: number, viewport: CoachViewport): CoachPlacement {
  const edge = 12, gap = 20;
  const left = viewport.left + edge, top = viewport.top + edge;
  const right = viewport.left + viewport.width - edge, bottom = viewport.top + viewport.height - edge;
  const width = Math.min(340, Math.max(0, right - left));
  const height = Math.min(naturalHeight, Math.max(0, bottom - top));
  const centredTop = clamp((target.top + target.bottom - height) / 2, top, bottom - height);
  if (right - target.right - gap >= width) return { left: target.right + gap, top: centredTop, width, maxHeight: bottom - top, side: 'right' };
  if (target.left - left - gap >= width) return { left: target.left - gap - width, top: centredTop, width, maxHeight: bottom - top, side: 'left' };
  const above = Math.max(0, target.top - gap - top), below = Math.max(0, bottom - target.bottom - gap);
  const x = clamp((target.left + target.right - width) / 2, left, right - width);
  if (above >= naturalHeight || above >= below) return { left: x, top: Math.max(top, target.top - gap - Math.min(height, above)), width, maxHeight: above, side: 'above' };
  return { left: x, top: target.bottom + gap, width, maxHeight: below, side: 'below' };
}
