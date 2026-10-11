import type { Card, Requirement, RuleDefinition } from './types';

const rankOf = (card: Card): number => card.rank === 1 ? 14 : card.rank;
const isRed = (card: Card): boolean => card.suit === 'D' || card.suit === 'H';
const rankPlural = (rank: number): string => ({ 11: 'jacks', 12: 'queens', 13: 'kings', 14: 'aces' }[rank] ?? `${rank}s`);
const countWord = (count: number): string => ({ 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Eleven' }[count] ?? String(count));

/**
 * Explain an opening already rejected by findOpeningMelds. This is feedback,
 * not a validator or a search for replacement cards. Only diagnose facts which
 * make the whole selection invalid without needing to partition several melds.
 */
export function getOpeningSelectionFeedback(selectedCards: Card[], rule: RuleDefinition): string {
  const requiredCount = rule.requirements.reduce((sum, requirement) => sum + requirement.count, 0);
  if (selectedCards.length !== requiredCount) {
    return `Your opening needs ${requiredCount} ${requiredCount === 1 ? 'card' : 'cards'}. ${selectedCards.length} ${selectedCards.length === 1 ? 'is' : 'are'} selected.`;
  }

  const wilds = selectedCards.filter(card => card.rank === 2);
  if (wilds.length && [rule.requirements, ...(rule.alternativeRequirements ?? [])].every(requirements => requirements.every(requirement => requirement.naturalOnly))) {
    return 'This opening needs natural cards only. Twos are not allowed.';
  }

  const fallback = `These cards do not match ${rule.title}.`;
  // A natural heart pair is mandatory even when the other group accepts wilds.
  if (rule.requirements.some(requirement => requirement.kind === 'set' && requirement.count === 2 && requirement.constraint === 'hearts' && requirement.naturalOnly)
      && !rule.alternativeRequirements?.length) {
    const hearts = selectedCards.filter(card => card.rank !== 2 && card.suit === 'H');
    if (!hearts.some((card, index) => hearts.some((other, otherIndex) => otherIndex !== index && rankOf(card) === rankOf(other)))) {
      return 'The heart pair needs two natural hearts of the same number. Twos belong in the eight-card set only.';
    }
  }
  // Matching ranks are expected across sets and may also occur in a set + run.
  // Leave the actual matcher responsible for assigning cards to those groups.
  if (rule.requirements.length !== 1) return fallback;

  const requirement = rule.requirements[0];
  const naturals = selectedCards.filter(card => card.rank !== 2);
  const ordered = [...naturals].sort((a, b) => rankOf(a) - rankOf(b));
  if (requirement.kind === 'run') {
    const duplicate = ordered.find((card, index) => index > 0 && rankOf(card) === rankOf(ordered[index - 1]));
    if (duplicate) {
      const rank = rankOf(duplicate);
      const count = naturals.filter(card => rankOf(card) === rank).length;
      return `A run needs different numbers. ${countWord(count)} ${rankPlural(rank)} are selected.`;
    }
    if (ordered.length > 1 && rankOf(ordered[ordered.length - 1]) - rankOf(ordered[0]) >= requirement.count) {
      return `These numbers are too far apart for a run of ${requirement.count}. Select consecutive numbers${requirement.naturalOnly ? '.' : '; twos fill gaps.'}`;
    }
  } else if (new Set(naturals.map(rankOf)).size > 1) {
    return 'A set needs matching numbers. Different numbers are selected.';
  }

  // An unconstrained wild represents another suit. Only its printed suit is
  // relevant when the opening explicitly requires wilds to match.
  const fixedSuits = requirement.wildsMatch ? selectedCards : naturals;
  const wildColourNote = requirement.wildsMatch && wilds.length ? ' Wild twos must match the colour too.' : '';
  const wildSuitNote = requirement.wildsMatch && wilds.length ? ' Twos count as their printed suit.' : '';
  const colourCount = new Set(fixedSuits.map(isRed)).size;
  const suitCount = new Set(fixedSuits.map(card => card.suit)).size;
  switch (requirement.constraint) {
    case 'same-colour':
      if (colourCount > 1) return `This ${requirement.kind} needs one colour: all red or all black.${wildColourNote}`;
      break;
    case 'red':
    case 'black': {
      const needsRed = requirement.constraint === 'red';
      if (fixedSuits.some(card => isRed(card) !== needsRed)) return `This ${requirement.kind} needs ${requirement.constraint} cards only.${wildColourNote}`;
      break;
    }
    case 'same-suit':
      if (suitCount > 1) return `This ${requirement.kind} needs every card in the same suit.${wildSuitNote}`;
      break;
    case 'hearts':
      if (fixedSuits.some(card => card.suit !== 'H')) return `This ${requirement.kind} needs hearts.${wildSuitNote}`;
      break;
    case 'one-each-suit':
    case 'one-each-suit-alternate':
      if (suitCount < fixedSuits.length) {
        return `${requirement.count === 4 ? 'Use one club, diamond, heart and spade.' : 'Use a different suit for each card.'}${wildSuitNote}`;
      }
      if (requirement.constraint === 'one-each-suit-alternate' && requirement.kind === 'run') return alternatingFeedback(ordered, selectedCards, requirement) ?? fallback;
      break;
    case 'alternate':
      if (requirement.kind === 'run') return alternatingFeedback(ordered, selectedCards, requirement) ?? fallback;
      break;
  }
  return fallback;
}

function alternatingFeedback(naturals: Card[], selectedCards: Card[], requirement: Requirement): string | null {
  const first = naturals[0];
  // Relative rank parity is independent of selection order and remains true
  // with any number of wild-filled gaps between these natural cards.
  if (first && naturals.some(card => (isRed(card) === isRed(first)) !== ((rankOf(card) - rankOf(first)) % 2 === 0))) {
    return 'This run must alternate red and black in number order. The selected colours do not alternate.';
  }
  if (requirement.wildsMatch) {
    const redCount = selectedCards.filter(isRed).length;
    if (Math.abs(redCount - (selectedCards.length - redCount)) > 1) {
      return 'An alternating run needs balanced red and black cards, with at most one extra of either colour. Twos keep their printed colour.';
    }
  }
  return null;
}
