import type { Card, Suit } from './types';
import { findOpeningMelds, handPoints } from './rummy';

/**
 * A deterministic, entirely client-side introduction to Game 1, Rule 1.
 * The tutorial never creates a room, spends money or writes to player records.
 * Every permitted action leads toward the same winning hand.
 */
const card = (id: string, rank: number, suit: Suit): Card => ({ id, rank, suit });

export const TUTORIAL_OPENING_IDS = ['5H', '6C', '7D', '2D', '9S'] as const;
export const TUTORIAL_LAYOFF_IDS = ['10C', '11H', '12S', '13D', '10D'] as const;

export const TUTORIAL_INITIAL_HAND: readonly Card[] = [
  card('5H', 5, 'H'), card('6C', 6, 'C'), card('7D', 7, 'D'),
  card('2D', 2, 'D'), card('9S', 9, 'S'), card('10C', 10, 'C'),
  card('11H', 11, 'H'), card('12S', 12, 'S'), card('13D', 13, 'D'),
  card('10D', 10, 'D'),
];

export const TUTORIAL_AI_RUN: readonly Card[] = [
  card('5C', 5, 'C'), card('6H', 6, 'H'), card('7C', 7, 'C'),
  card('8H', 8, 'H'), card('9D', 9, 'D'),
];
export const TUTORIAL_AI_REMAINING: readonly Card[] = [
  card('5D', 5, 'D'), card('7H', 7, 'H'), card('10S', 10, 'S'),
  card('12C', 12, 'C'), card('2C', 2, 'C'),
];
export const TUTORIAL_AI_PENALTY = handPoints([...TUTORIAL_AI_REMAINING]);

const firstDraw = card('8D', 8, 'D');
const opponentFirstDiscard = card('6D', 6, 'D');
const opponentSecondDiscard = card('12D', 12, 'D');
const thirdDraw = card('14H', 14, 'H');
const startingDiscard = card('13C', 13, 'C');

export type TutorialPhase =
  'intro' | 'first-draw' | 'first-discard' | 'second-draw' | 'opening' |
  'second-discard' | 'third-draw' | 'layoff' | 'final-discard' | 'won';
export type TutorialTarget = 'your-run' | 'opponent-run';
export type TutorialAction =
  | { type: 'start' | 'restart' }
  | { type: 'draw'; source: 'stock' | 'discard' }
  | { type: 'select'; id: string }
  | { type: 'go-down' }
  | { type: 'layoff'; target: TutorialTarget }
  | { type: 'discard' };

export interface TutorialState {
  phase: TutorialPhase;
  hand: Card[];
  selected: string[];
  yourRun: Card[];
  opponentRun: Card[];
  topDiscard: Card;
  laidOffCount: number;
  turn: number;
}

export function initialTutorialState(): TutorialState {
  return {
    phase: 'intro', hand: [...TUTORIAL_INITIAL_HAND], selected: [],
    yourRun: [], opponentRun: [], topDiscard: startingDiscard,
    laidOffCount: 0, turn: 1,
  };
}

const selectedEquals = (selected: string[], required: readonly string[]) =>
  selected.length === required.length && required.every(id => selected.includes(id));

export function tutorialOpeningReady(state: TutorialState): boolean {
  if (state.phase !== 'opening' || !selectedEquals(state.selected, TUTORIAL_OPENING_IDS)) return false;
  const cards = state.hand.filter(item => state.selected.includes(item.id));
  return findOpeningMelds(cards, 1, 1) !== null;
}

export function tutorialDiscardReady(state: TutorialState): boolean {
  const expected = state.phase === 'first-discard' ? firstDraw.id
    : state.phase === 'second-discard' ? opponentFirstDiscard.id
    : state.phase === 'final-discard' ? thirdDraw.id : null;
  return expected !== null && selectedEquals(state.selected, [expected]);
}

export function tutorialLayoffTarget(state: TutorialState): TutorialTarget | null {
  if (state.phase !== 'layoff' || !selectedEquals(state.selected, [TUTORIAL_LAYOFF_IDS[state.laidOffCount]])) return null;
  return state.laidOffCount === TUTORIAL_LAYOFF_IDS.length - 1 ? 'opponent-run' : 'your-run';
}

export function tutorialExpectedCardIds(state: TutorialState): readonly string[] {
  if (state.phase === 'opening') return TUTORIAL_OPENING_IDS;
  if (state.phase === 'first-discard') return [firstDraw.id];
  if (state.phase === 'second-discard') return [opponentFirstDiscard.id];
  if (state.phase === 'layoff') return [TUTORIAL_LAYOFF_IDS[state.laidOffCount]];
  if (state.phase === 'final-discard') return [thirdDraw.id];
  return [];
}

export function reduceTutorial(state: TutorialState, action: TutorialAction): TutorialState {
  if (action.type === 'restart') return initialTutorialState();

  if (action.type === 'start') {
    return state.phase === 'intro' ? { ...state, phase: 'first-draw' } : state;
  }

  if (action.type === 'draw') {
    if (state.phase === 'first-draw' && action.source === 'stock') {
      return { ...state, phase: 'first-discard', hand: [...state.hand, firstDraw], selected: [] };
    }
    if (state.phase === 'second-draw' && action.source === 'discard') {
      return { ...state, phase: 'opening', hand: [...state.hand, opponentFirstDiscard], topDiscard: firstDraw, selected: [] };
    }
    if (state.phase === 'third-draw' && action.source === 'stock') {
      return { ...state, phase: 'layoff', hand: [...state.hand, thirdDraw], selected: [] };
    }
    return state;
  }

  if (action.type === 'select') {
    if (!['first-discard', 'opening', 'second-discard', 'layoff', 'final-discard'].includes(state.phase)) return state;
    if (!state.hand.some(item => item.id === action.id)) return state;
    if (state.selected.includes(action.id)) return { ...state, selected: state.selected.filter(id => id !== action.id) };
    return { ...state, selected: state.phase === 'opening'
      ? [...state.selected.slice(-(TUTORIAL_OPENING_IDS.length - 1)), action.id]
      : [action.id] };
  }

  if (action.type === 'go-down') {
    if (!tutorialOpeningReady(state)) return state;
    const chosen = new Set<string>(TUTORIAL_OPENING_IDS);
    return {
      ...state, phase: 'second-discard', selected: [],
      hand: state.hand.filter(item => !chosen.has(item.id)),
      yourRun: TUTORIAL_OPENING_IDS.map(id => state.hand.find(item => item.id === id) as Card),
    };
  }

  if (action.type === 'layoff') {
    if (tutorialLayoffTarget(state) !== action.target) return state;
    const expected = TUTORIAL_LAYOFF_IDS[state.laidOffCount];
    const chosen = state.hand.find(item => item.id === expected);
    if (!chosen) return state;
    const isOpponent = action.target === 'opponent-run';
    const count = state.laidOffCount + 1;
    return {
      ...state, selected: [], hand: state.hand.filter(item => item.id !== chosen.id),
      yourRun: isOpponent ? state.yourRun : [...state.yourRun, chosen],
      opponentRun: isOpponent ? [...state.opponentRun, chosen] : state.opponentRun,
      laidOffCount: count,
      phase: count === TUTORIAL_LAYOFF_IDS.length ? 'final-discard' : 'layoff',
    };
  }

  if (action.type === 'discard') {
    if (!tutorialDiscardReady(state)) return state;
    const selected = state.selected[0];
    const hand = state.hand.filter(item => item.id !== selected);
    if (state.phase === 'first-discard') {
      return { ...state, phase: 'second-draw', hand, selected: [], topDiscard: opponentFirstDiscard, turn: 2 };
    }
    if (state.phase === 'second-discard') {
      return { ...state, phase: 'third-draw', hand, selected: [], topDiscard: opponentSecondDiscard, opponentRun: [...TUTORIAL_AI_RUN], turn: 3 };
    }
    if (state.phase === 'final-discard' && hand.length === 0) {
      return { ...state, phase: 'won', hand, selected: [], topDiscard: thirdDraw };
    }
  }

  return state;
}
