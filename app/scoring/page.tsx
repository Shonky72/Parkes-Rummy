import type { Metadata } from 'next';
import { cardPoints, handPoints } from '../../lib/rummy';
import type { Card } from '../../lib/types';
import PublicGuide, { GuideCards } from '../components/PublicGuide';

export const metadata: Metadata = {
  title: 'Parkes Rummy scoring | Card values and winning',
  description: 'Learn card penalties, calculate a leftover hand and understand why completing Rule 10 differs from winning Parkes Rummy. Includes worked scoring examples.',
  alternates: { canonical: 'https://parkesrummy.com/scoring' },
};

const exampleCards: Card[] = [
  { id: 'guide-seven', rank: 7, suit: 'H' },
  { id: 'guide-queen', rank: 12, suit: 'C' },
  { id: 'guide-ace', rank: 14, suit: 'D' },
  { id: 'guide-two', rank: 2, suit: 'S' },
];
const exampleNames = ['7 of Hearts', 'Queen of Clubs', 'Ace of Diamonds', '2 of Spades'];
const values = [
  { label: '5, 6 and 7', card: { id: 'low', rank: 5, suit: 'C' } as Card },
  { label: '8, 9, 10, Jack, Queen and King', card: { id: 'middle', rank: 8, suit: 'C' } as Card },
  { label: 'Ace and 2', card: { id: 'high', rank: 14, suit: 'C' } as Card },
];

export default function ScoringPage() {
  const penalty = handPoints(exampleCards);
  return <PublicGuide title="Scoring: keep your total low" currentPath="/scoring" advertising
    intro="Cards left in your hand become penalty points when someone goes out. Your running total decides the winner of a full game."
    sections={[{ href: '#card-values', label: 'Card values' }, { href: '#example', label: 'Worked example' }, { href: '#progress', label: 'Rule progress' }, { href: '#winner', label: 'The final winner' }]}>
    <section id="card-values">
      <h2>Card values</h2>
      <div className="guide-table-wrap"><table className="guide-table">
        <caption className="sr-only">Penalty points for cards remaining in your hand</caption>
        <thead><tr><th scope="col">Cards</th><th className="guide-score-number" scope="col">Each</th></tr></thead>
        <tbody>{values.map(group => <tr key={group.label}><th scope="row">{group.label}</th><td className="guide-score-number">{cardPoints(group.card)} points</td></tr>)}</tbody>
      </table></div>
      <p>Threes and fours are absent from the deck. A two left in your hand scores 20 points, even if you hoped to use the two as a lower-value card.</p>
      <p><strong>Only cards remaining in your hand add penalties.</strong> Your opening and later additions already on the table add zero. Going down does not erase the value of cards still held.</p>
    </section>
    <section id="example">
      <h2>A leftover-hand example</h2>
      <p>Another player empties their hand. You are holding these four cards:</p>
      <GuideCards label="Remaining cards: seven of hearts, Queen of clubs, Ace of diamonds and two of spades" cards={[{ rank: '7', suit: '♥' }, { rank: 'Q', suit: '♣' }, { rank: 'A', suit: '♦' }, { rank: '2', suit: '♠' }]}/>
      <div className="guide-table-wrap"><table className="guide-table">
        <caption className="sr-only">A worked four-card penalty calculation</caption>
        <thead><tr><th scope="col">Remaining card</th><th className="guide-score-number" scope="col">Penalty</th></tr></thead>
        <tbody>{exampleCards.map((card, index) => <tr key={card.id}><th scope="row">{exampleNames[index]}</th><td className="guide-score-number">{cardPoints(card)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">Added this hand</th><td className="guide-score-number">{penalty}</td></tr></tfoot>
      </table></div>
      <div className="guide-example"><h3>From hand penalty to running total</h3><p>A previous total of 25 plus this hand’s {penalty} points gives a new total of <strong>{25 + penalty}</strong>. The player who went out adds zero because their hand is empty.</p></div>
      <p>The results screen shows each player’s remaining cards, the penalty from the completed hand and the accumulated total. Use the revealed cards to follow the calculation.</p>
    </section>
    <section id="progress">
      <h2>Points and rule progress are separate</h2>
      <p>Completing your opening earns progress to your next personal rule at the end of the hand. You still receive penalties for any cards left in your hand.</p>
      <p>For example, a player who goes down on Rule 4 and finishes with 30 points left adds 30 to their total, then moves to Rule 5. A player who never goes down repeats Rule 4, regardless of the value of their remaining cards.</p>
      <p>This creates a choice: keep useful cards while chasing your opening, or discard costly cards to reduce the penalty if another player goes out. Aces and twos are useful but cost 20 points each when stranded.</p>
    </section>
    <section id="winner">
      <h2>Who wins the full game?</h2>
      <p>A full game ends after a hand where at least one player completed their Rule 10 opening. The player with the <strong>lowest accumulated penalty total</strong> wins, even if another player completed Rule 10.</p>
      <div className="guide-table-wrap"><table className="guide-table">
        <caption className="sr-only">Example final result with different rule progress and scores</caption>
        <thead><tr><th scope="col">Player</th><th scope="col">Progress</th><th className="guide-score-number" scope="col">Total</th></tr></thead>
        <tbody><tr><th scope="row">Ava</th><td>Completed Rule 10</td><td className="guide-score-number">95</td></tr><tr><th scope="row">Ben</th><td>On Rule 8</td><td className="guide-score-number"><strong>80</strong></td></tr><tr><th scope="row">Lee</th><td>On Rule 9</td><td className="guide-score-number">110</td></tr></tbody>
      </table></div>
      <p><strong>Ben wins this example with 80.</strong> Ava’s completed Rule 10 brings the full game to its closing hand, but the total score decides the result. If two or more players share the lowest total, they share the win.</p>
      <p>Quick Play is one hand. Fixed challenges and the human ladder apply their separate comparison and rating rules, explained in <a href="/progress-help">Records &amp; competition</a>. The ordinary card penalties above remain the reference for a social game.</p>
    </section>
  </PublicGuide>;
}
