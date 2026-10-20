/** Public game information is rendered by the server, independently of accounts. */
export default function PublicHomeInformation() {
  return <section className="public-home-content" aria-labelledby="public-home-title">
    <header className="public-home-heading">
      <p className="public-home-eyebrow">A card night with your house rules</p>
      <h2 id="public-home-title">Your table. Your friends.<br/>A new challenge every hand.</h2>
      <p>Parkes Rummy is an online multiplayer card game from IBD Collective. Bring two to eight players to a private table, mix friends with AI opponents, or start a one-hand Quick Play game. Play in your browser on a phone, tablet or computer.</p>
      <nav className="public-home-nav" aria-label="Learn Parkes Rummy">
        <a href="/how-to-play">How to play</a>
        <a href="/rules">Game rules</a>
        <a href="/scoring">Scoring</a>
        <a href="/tutorial">Guided practice</a>
        <a href="/help">Player help</a>
      </nav>
    </header>

    <div className="public-home-grid">
      <article className="public-home-card">
        <span className="public-home-number" aria-hidden="true">01</span>
        <h3>Build your opening</h3>
        <p>Each player works through ten opening requirements. Collect runs, matching ranks or a combination of both. Twos are wild, and your current requirement explains the cards needed to go down.</p>
        <p>Your first turn is draw and discard. From your next turn, lay your complete opening when ready. After going down, add cards to exposed melds from a later turn.</p>
        <a href="/how-to-play">Follow a worked turn <span aria-hidden="true">→</span></a>
      </article>
      <article className="public-home-card">
        <span className="public-home-number" aria-hidden="true">02</span>
        <h3>Keep your score low</h3>
        <p>When someone empties their hand, every card left in another player’s hand adds penalty points. Players who went down advance one requirement; everyone else attempts the same requirement again.</p>
        <p>A full game ends after a hand where a player completes requirement ten. The lowest total penalty score wins, so finishing your requirements and winning the game are separate achievements.</p>
        <a href="/scoring">See the scoring example <span aria-hidden="true">→</span></a>
      </article>
      <article className="public-home-card">
        <span className="public-home-number" aria-hidden="true">03</span>
        <h3>Choose your card night</h3>
        <p>Games 1, 2 and 3 each offer ten free requirements. Start with Game 1, practise against AI, or invite friends using your room code. The host chooses the rule collection, turn timer and hints.</p>
        <p>Guest play works without an account. Optional Google sign-in connects saved games and purchases across devices. Original Rules and other extras are available through the store.</p>
        <a href="/rules">Compare the free collections <span aria-hidden="true">→</span></a>
      </article>
    </div>

    <div className="public-home-bottom">
      <div><h3>New to the table?</h3><p>The guided practice hand walks through drawing, sorting, a wild two, your opening and the final discard.</p></div>
      <a className="button gold" href="/tutorial">Play the practice hand</a>
    </div>
    <p className="public-home-more">Explore <a href="/progress-help">records and achievements</a>, <a href="/install">add the game to your home screen</a>, or learn <a href="/about-help">about IBD Collective and support</a>.</p>
  </section>;
}
