import type { Metadata } from 'next';
import PublicGuide from '../components/PublicGuide';

export const metadata: Metadata = {
  title: 'Parkes Rummy help | Joining, accounts and table support',
  description: 'Help with Parkes Rummy room codes, host approval, saved games, Go Down, AI players, voice chat, purchases and contacting IBD Collective.',
  alternates: { canonical: 'https://parkesrummy.com/help' },
};

export default function HelpPage() {
  return <PublicGuide title="Help for your next hand" currentPath="/help" advertising
    intro="Joining friends, returning to a saved table or checking a rule? Start with the answers below, then contact IBD Collective for individual support."
    sections={[{ href: '#joining', label: 'Joining friends' }, { href: '#accounts', label: 'Accounts & saved games' }, { href: '#play', label: 'Playing cards' }, { href: '#voice', label: 'Voice & sound' }, { href: '#purchases', label: 'Purchases' }, { href: '#support', label: 'Contact support' }]}>
    <section id="joining">
      <h2>Joining a table</h2>
      <h3>How do friends join my game?</h3>
      <p>Create a table, then share the invitation link or room code from the lobby. Friends open the link or enter the code on the homepage, choose a display name and request a seat. The host reviews and approves new players.</p>
      <h3>Why am I waiting for approval?</h3>
      <p>A submitted request reserves no immediate place in the game. Ask the host to check their pending requests and approve your seat. Stay on the waiting screen while approval completes. If the request is declined or the table has closed, the page explains the next step.</p>
      <h3>Does everyone need an account?</h3>
      <p>Guest players join and play without signing in. A Google account adds account-linked tables across devices, personal records and purchased extras. Joining an entitled host’s Original Rules table does not require your own Original Rules purchase.</p>
      <h3>How do I practise alone?</h3>
      <p>Open <a href="/tutorial">the guided practice hand</a> for a step-by-step introduction. For normal play, create a table and add an AI player. The host chooses Easy, Medium or Hard from each AI player’s menu. Quick Play offers a one-hand session.</p>
    </section>
    <section id="accounts">
      <h2>Accounts, saved tables and reconnecting</h2>
      <h3>Where is my previous game?</h3>
      <p>Open <strong>Your games</strong> on the homepage or from the table menu. Active table summaries show whose turn is next. Leaving the game screen keeps your saved seat available; returning through the saved-table list resumes the table.</p>
      <p>For guest play, return using the same browser and device. Clearing browser data or changing browsers removes access to browser-stored seat details. For account-linked tables, sign in with the same Google account on the other device.</p>
      <h3>What should I do after a connection failure?</h3>
      <p>Restore your connection and return through Your games. Let any pending action settle before attempting the same move again. If an error persists, refresh the page and sign in with your usual account, then reopen the saved table.</p>
      <p>If the host deleted the table, the saved game is no longer available for continued play. For account or deletion questions, read <a href="/data-account">Data &amp; Account</a>.</p>
      <h3>Why does my phone show a different account or set of purchases?</h3>
      <p>Check the Google account displayed in Settings on both devices. Extras and account-linked tables belong to the account used for them. Guest and signed-in sessions have separate access to saved seats.</p>
    </section>
    <section id="play">
      <h2>Playing and selecting cards</h2>
      <h3>Why is Go Down unavailable or my opening rejected?</h3>
      <p>Check these conditions in order:</p>
      <ol>
        <li>Your turn is active and you have drawn one card.</li>
        <li>Your first draw-and-discard turn in this hand is complete.</li>
        <li>You selected exactly the number of cards required by your current personal rule.</li>
        <li>Every required group is present, including colour, suit and natural-card conditions.</li>
      </ol>
      <p>A visually close run still needs every consecutive rank. The <a href="/rules">rules page</a> lists exact requirements and explains printed-suit restrictions for wild twos.</p>
      <h3>Why won’t a card add to someone’s group?</h3>
      <p>Go down first and wait until your following turn. After drawing, select cards fitting the target set or the selected run end. Several selected cards must fit together at one target. Existing twos keep their assigned values.</p>
      <h3>Why did another player advance while I stayed on the same rule?</h3>
      <p>Only players who completed their opening advance after a hand. Going out first ends the hand, but every player who went down earns progress. The <a href="/how-to-play">playing guide</a> explains personal progression, and the <a href="/scoring">scoring guide</a> separates progress from penalties.</p>
      <h3>How do I organise my cards?</h3>
      <p>Tap Sort for the current hand order. Hold Sort to choose number, colour or suit. Choose high-to-low or low-to-high order in Settings. Drag individual cards to arrange your hand, or select a group before choosing a table target.</p>
    </section>
    <section id="voice">
      <h2>Voice chat and sound</h2>
      <h3>How do I join table voice?</h3>
      <p>Sign in with a voice-enabled account and join a table. Open Settings, select <strong>Join voice</strong> and allow microphone access when your browser asks. Wait for the Connected status before closing Settings.</p>
      <p>Voice stays connected while Settings is closed. Mute your microphone, silence everyone, or mute a particular player from the voice controls. Individual player mute works both ways.</p>
      <h3>Why did voice stop after I changed apps?</h3>
      <p>Leaving the table or putting the game in the background stops your microphone. Return to the table and join voice again. If microphone access was denied, review this site’s microphone permission in your browser settings.</p>
      <h3>How do I change music or card sounds?</h3>
      <p>Settings contains separate music and sound-effect controls. The homepage sound button mutes game audio. Your sound preferences are remembered on the device.</p>
    </section>
    <section id="purchases">
      <h2>Purchases and advertising</h2>
      <p>The <a href="/store">Store</a> lists optional extras and current prices. Purchases use Stripe Checkout and attach to the signed-in account. Original Rules changes which collection the account is entitled to host; invited players join the host’s table without buying the collection.</p>
      <p>If an extra is missing, check your signed-in account and refresh after checkout completes. Contact support with the product name, purchase date and Stripe receipt reference. Send no payment-card details.</p>
      <p>Remove Ads is honoured for the entitled account while signed in. Advertising choices are explained on the <a href="/cookies">Cookies page</a>. For privacy and account requests, use <a href="/privacy">Privacy</a> and <a href="/data-account">Data &amp; Account</a>.</p>
    </section>
    <section id="support">
      <h2>Contact IBD Collective</h2>
      <p>Email <a href="mailto:dan@ibdcollective.net">dan@ibdcollective.net</a> for gameplay, account, voice or purchase support.</p>
      <p>For a game issue, include the room code, approximate time, device and browser, the action you attempted and the exact error wording. A screenshot of the affected screen helps explain the problem.</p>
      <p>Share only the details needed for the issue. Never send passwords, authentication codes, API keys or full payment-card details.</p>
    </section>
  </PublicGuide>;
}
