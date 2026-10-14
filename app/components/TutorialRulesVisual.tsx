import { BookOpen, ArrowRight } from 'lucide-react';

function SmallCard({ rank, suit, wild = false }: { rank: string; suit: '♥' | '♦' | '♣' | '♠'; wild?: boolean }) {
  return <span className={'tutorial-mini-card ' + (suit === '♥' || suit === '♦' ? 'red' : 'black') + (wild ? ' mini-wild' : '')} aria-label={rank + ' of ' + ({'♥':'hearts','♦':'diamonds','♣':'clubs','♠':'spades'} as Record<string,string>)[suit]}>
    <b>{rank}</b><span>{suit}</span>{wild && <small>WILD</small>}
  </span>;
}

export default function TutorialRulesVisual() {
  return <section className="tutorial-rules-visual" aria-label="House rules and card points">
    <h2><BookOpen size={18}/>House rules</h2>
    <div className="tutorial-rule-tiles">
      <div className="tutorial-rule-tile">
        <SmallCard rank="2" suit="♥" wild/>
        <span><strong>2 is wild</strong><small>Use a 2 as a missing number.</small></span>
      </div>
      <div className="tutorial-rule-tile">
        <span className="tutorial-no-cards"><s>3</s><s>4</s></span>
        <span><strong>No 3s or 4s</strong><small>They aren&apos;t in the deck.</small></span>
      </div>
    </div>
    <div className="tutorial-patterns">
      <div><strong>RUN</strong><span className="tutorial-pattern-cards"><SmallCard rank="5" suit="♥"/><SmallCard rank="6" suit="♣"/><SmallCard rank="7" suit="♦"/></span><small>Numbers in order</small></div>
      <div><strong>SET</strong><span className="tutorial-pattern-cards"><SmallCard rank="7" suit="♥"/><SmallCard rank="7" suit="♣"/><SmallCard rank="7" suit="♦"/></span><small>Same number</small></div>
    </div>
    <h3>Points on cards left in your hand</h3>
    <p className="tutorial-points-intro">The fewer points you finish with, the better!</p>
    <div className="tutorial-points-grid">
      <div><span className="tutorial-point-cards"><SmallCard rank="5" suit="♥"/><SmallCard rank="6" suit="♣"/><SmallCard rank="7" suit="♦"/></span><span>5 to 7</span><strong>5 <small>each</small></strong></div>
      <div><span className="tutorial-point-cards"><SmallCard rank="8" suit="♠"/><SmallCard rank="J" suit="♥"/><SmallCard rank="K" suit="♣"/></span><span>8 to King</span><strong>10 <small>each</small></strong></div>
      <div><span className="tutorial-point-cards"><SmallCard rank="A" suit="♠"/><SmallCard rank="2" suit="♥" wild/></span><span>Ace or 2</span><strong>20 <small>each</small></strong></div>
    </div>
    <div className="tutorial-lowest"><span>LOWEST SCORE</span><ArrowRight size={14}/><strong>WINS</strong></div>
    <p className="tutorial-rules-footer">There are 10 different card goals. Finish your goal to move to the next one.</p>
  </section>;
}
