import type { Metadata } from 'next';
import { RULES } from '../../lib/rummy';
import PublicGuide, { GuideCards } from '../components/PublicGuide';

export const metadata: Metadata = {
  title: 'Parkes Rummy rules | All 30 free openings',
  description: 'The complete free Parkes Rummy rule collections: Games 1, 2 and 3. Check opening sizes, runs, sets, colour requirements and wildcard exceptions.',
  alternates: { canonical: 'https://parkesrummy.com/rules' },
};

const collections = [
  { game: 1 as const, title: 'Game 1: the starting collection', description: 'Runs accept mixed suits. Build familiarity with sequences and matching ranks before adding the colour and suit requirements of later collections.', tags: ['10 openings', 'Mixed-suit runs', 'Twos are wild'] },
  { game: 2 as const, title: 'Game 2: colour and suit', description: 'This collection adds black and red sets, suit patterns, an opening without twos and longer combinations. Check the wording beside each opening: wildcard suit rules differ.', tags: ['10 openings', 'Colour and suit patterns', 'A natural-card opening'] },
  { game: 3 as const, title: 'Game 3: the harder collection', description: 'Larger combinations and stricter colour patterns test your card choices. Some runs require a two’s printed suit; others permit any two to represent the missing card.', tags: ['10 openings', 'Combined requirements', 'A natural heart pair'] },
];

export default function RulesPage() {
  return <PublicGuide title="The Parkes Rummy rules" currentPath="/rules" advertising
    intro="Three free collections. Ten personal openings in each. Read the exact requirement for your current rule, then select the complete opening together."
    sections={[{ href: '#essentials', label: 'Essentials' }, { href: '#game-1', label: 'Game 1' }, { href: '#game-2', label: 'Game 2' }, { href: '#game-3', label: 'Game 3' }, { href: '#original-rules', label: 'Original Rules' }]}>
    <section id="essentials">
      <h2>Reading an opening</h2>
      <p>A <strong>set</strong> contains cards of one rank. A <strong>run</strong> contains consecutive ranks, starting at 5 or higher and ending no later than Ace. Aces follow Kings. Threes and fours are removed, and multiple packs supply repeated rank-and-suit combinations.</p>
      <p>The number of cards in the table is the exact size of your opening. A rule requiring a triple plus a run needs both groups at once. A card belongs to only one group in the opening.</p>
      <div className="guide-example">
        <h3>Run or set?</h3>
        <GuideCards label="A five-card mixed-suit run: nine, ten, Jack, Queen, King" cards={[{ rank: '9', suit: '♣' }, { rank: '10', suit: '♦' }, { rank: 'J', suit: '♥' }, { rank: 'Q', suit: '♠' }, { rank: 'K', suit: '♣' }]}/>
        <p>This is a run of five, suitable for Game 1’s first opening. Three Queens form a set. The more demanding collections add their stated colour or suit conditions.</p>
      </div>
      <h3>Twos, printed suits and natural cards</h3>
      <p>A wild two represents a missing card. When a rule says twos follow their printed suit or colour, the suit on the physical two must fit the required position. A red two is a Heart or Diamond; a black two is a Club or Spade.</p>
      <p><strong>Natural cards</strong> means the opening uses the printed ranks without wildcard substitution. Where a free rule says “no twos”, exclude every two from the selected opening.</p>
      <div className="guide-note"><p>Complete your first draw-and-discard turn before going down. After your opening, wait until your following turn before adding to exposed groups. Games 1–3 relax their opening colour and suit restrictions for later additions.</p></div>
    </section>
    {collections.map(collection => <section id={'game-' + collection.game} key={collection.game}>
      <h2>{collection.title}</h2>
      <p>{collection.description}</p>
      <div className="guide-collection-summary">{collection.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
      <div className="guide-table-wrap"><table className="guide-table">
        <caption className="sr-only">Game {collection.game}: ten opening rules and required card counts</caption>
        <thead><tr><th className="guide-rule-number" scope="col">Rule</th><th scope="col">Opening requirement</th><th className="guide-rule-count" scope="col">Cards</th></tr></thead>
        <tbody>{RULES[collection.game].map(opening => <tr key={opening.number}>
          <th className="guide-rule-number" scope="row">{opening.number}</th>
          <td><strong>{opening.title}</strong><p>{opening.description}</p></td>
          <td className="guide-rule-count">{opening.requirements.reduce((sum, requirement) => sum + requirement.count, 0)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>)}
    <section id="original-rules">
      <h2>Original Rules: a separate optional collection</h2>
      <p>Original Rules is an additional ten-rule collection with its own opening conditions. Hosting this collection requires Original Rules access, either through the individual purchase, the Everything Pack or an owner-granted entitlement.</p>
      <p>Friends joining an entitled host’s table do not need to purchase the collection. The game displays the applicable rules at the table. The <a href="/store">Store</a> explains access and current prices.</p>
      <p>For the complete turn sequence, read <a href="/how-to-play">How to play</a>. For penalties and the final winner, open the <a href="/scoring">scoring guide</a>.</p>
    </section>
  </PublicGuide>;
}
