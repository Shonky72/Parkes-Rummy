import type { Metadata } from 'next';
import PublicGuide, { GuideCards } from '../components/PublicGuide';

export const metadata: Metadata = {
  title: 'How to play Parkes Rummy | A step-by-step guide',
  description: 'Learn Parkes Rummy: drawing and discarding, your first opening, wild twos, adding to the table and progressing through ten personal rules. Includes a worked turn.',
  alternates: { canonical: 'https://parkesrummy.com/how-to-play' },
};

export default function HowToPlayPage() {
  return <PublicGuide title="How to play Parkes Rummy" currentPath="/how-to-play" advertising
    intro="Build runs and sets, work through your own ten rules, and keep your penalty score low. This guide takes you from your first seat to the final hand."
    sections={[{ href: '#take-a-seat', label: 'Take a seat' }, { href: '#your-turn', label: 'Your turn' }, { href: '#worked-turn', label: 'Worked example' }, { href: '#shared-table', label: 'Adding cards' }, { href: '#finish', label: 'Finishing' }]}>
    <section id="take-a-seat">
      <h2>1. Take a seat</h2>
      <p>Open the game, enter a display name and create a table, or join a friend using their room code or invitation link. The host approves new arrivals. A table supports <strong>two to eight players</strong>, including optional AI players with Easy, Medium or Hard difficulty.</p>
      <p>The host chooses a rule collection, a turn limit or unlimited turns, and whether valid places for selected cards are highlighted. Game 1 is a useful starting point because its runs allow mixed suits. Games 2 and 3 add colour, suit and natural-card requirements.</p>
      <p><strong>Guest play needs no Google account.</strong> Sign in for account-linked saved tables across devices and optional account extras. The <a href="/tutorial">guided practice hand</a> is a separate introduction with a scripted opponent and no timer.</p>
      <p>Each hand starts with ten cards per player. Threes and fours are removed from the packs. Ace is high, following King; twos usually act as wildcards. Several packs are used, so repeated copies of the same rank and suit belong in the game.</p>
    </section>
    <section id="your-turn">
      <h2>2. Draw, play, discard</h2>
      <ol>
        <li><strong>Draw one card.</strong> Choose the face-down draw pile or the visible top card of the discard pile. On a touch screen, tap a pile or hold and drag a card into your hand.</li>
        <li><strong>Play eligible cards.</strong> Once your first turn is complete, select the exact cards for your current opening rule and press <strong>Go Down</strong>. Later turns offer additions to existing table groups.</li>
        <li><strong>Discard one card.</strong> Select a card from your hand and press <strong>Discard</strong> to pass the turn. If an accepted play empties your hand, the hand ends immediately without an additional discard.</li>
      </ol>
      <div className="guide-note"><p><strong>Your first turn is draw and discard only.</strong> Even a complete opening dealt into your hand must wait until your second turn. After going down, wait until your following turn before adding cards to existing groups.</p></div>
      <h3>Your rule is personal</h3>
      <p>The opening shown beside your hand is your own requirement. Players advance individually. Two people at the same table often work on different rules, and the shared hand number is separate from each player’s rule number.</p>
      <p>A <strong>set</strong> is a group of matching ranks, such as three Queens. A <strong>run</strong> is a sequence, such as 5, 6, 7, 8, 9. Some openings need several groups together. Select exactly the required cards in one opening; extra selected cards prevent a valid laydown.</p>
      <p>Use <strong>Sort</strong> to organise your hand. Hold Sort to choose number, colour or suit grouping. The <a href="/rules">rules guide</a> lists all thirty free openings and explains their special requirements.</p>
    </section>
    <section id="worked-turn">
      <h2>3. A worked opening</h2>
      <p>You are on <strong>Game 1, Rule 1: Run of 5</strong>. Your first turn is already complete. Four relevant cards in your hand are 5♥, 6♣, 7♦ and 2♦. At the start of your next turn, pick up 9♠ from the discard pile.</p>
      <div className="guide-example">
        <h3>Five cards selected for Go Down</h3>
        <GuideCards label="A run from five to nine, with the two of diamonds representing eight" cards={[{ rank: '5', suit: '♥' }, { rank: '6', suit: '♣' }, { rank: '7', suit: '♦' }, { rank: '2', suit: '♦', represents: '8' }, { rank: '9', suit: '♠' }]}/>
        <p>The two fills the missing 8. Mixed suits are valid for this opening. Select these five cards, then press <strong>Go Down</strong>.</p>
        <p>You held eleven cards after drawing. Playing the five-card opening leaves six; discarding one leaves five. Further additions to the table start on your next turn.</p>
      </div>
      <p>A two already on the table keeps its assigned rank and suit. Replacing a laid wildcard or moving the wildcard to another position is not part of this game.</p>
    </section>
    <section id="shared-table">
      <h2>4. Add to the shared table</h2>
      <p>From the turn after your opening, draw as usual and look for cards fitting any exposed group, including another player’s group. Add matching ranks to a set, or extend a run from either end in consecutive order.</p>
      <p>For example, a run showing 5 through 9 accepts a 10 at its high end. A set of Queens accepts another Queen. Select several cards to add a complete sequence to one run end, or several matching cards to one set.</p>
      <p>In <strong>Games 1, 2 and 3</strong>, opening colour, suit and natural-card restrictions end after the opening. Later additions follow the set’s rank or the run’s number order, with twos available as wildcards. Original Rules includes additional exceptions; follow the rule wording at those tables.</p>
      <p>Ace finishes the high end of a run. Runs never wrap from Ace back to 5. You must go down yourself before adding to anyone’s cards.</p>
    </section>
    <section id="finish">
      <h2>5. End a hand and advance</h2>
      <p>The first player with an empty hand ends the hand. Everyone’s remaining cards are revealed and added to their running penalty total. Cards already placed on the table add no penalty.</p>
      <p>Every player who went down advances one personal rule, even without going out first. Players who did not go down repeat their current rule in the next hand.</p>
      <p>A full game finishes at the end of a hand in which at least one player completed their Rule 10 opening. <strong>The lowest total penalty score wins.</strong> Completing Rule 10 and winning the game are different results; equal lowest totals share the win.</p>
      <p>Read the <a href="/scoring">scoring guide</a> for card values and a complete example. Quick Play ends after one hand; records, fixed challenges and the human ladder have their own <a href="/progress-help">competition guide</a>.</p>
    </section>
  </PublicGuide>;
}
