import type { Metadata } from 'next';
import PublicGuide from '../components/PublicGuide';

export const metadata: Metadata = {
  title: 'About Parkes Rummy | IBD Collective',
  description: 'Meet Parkes Rummy, the browser card game from IBD Collective. Learn about its house rules, ways to play, optional extras and support.',
  alternates: { canonical: 'https://parkesrummy.com/about-help' },
};

export default function AboutHelpPage() {
  return <PublicGuide title="About Parkes Rummy" currentPath="/about-help"
    intro="A browser card game from IBD Collective, built around the Parkes house rules. Gather your friends, add an AI player, and work through the next opening together.">
    <section>
      <h2>Your table, your house rules</h2>
      <p>Parkes Rummy brings runs, matching sets and wild twos to a shared online table. Each player works through ten personal opening requirements. Going down earns progress; the cards left in your hand add penalties. The lowest running total decides the full-game winner.</p>
      <p>Individual progress gives each hand a different shape. One player might chase a long run while another needs two sets. Once players are down and reach a later turn, exposed groups become opportunities for everyone at the table.</p>
      <p>The three free collections offer thirty openings, progressing from mixed-suit runs to more demanding colour, suit and natural-card combinations. Read the <a href="/rules">free rules</a> or follow the <a href="/how-to-play">playing guide</a> for a worked hand.</p>
    </section>
    <section>
      <h2>Choose how to play</h2>
      <p>Tables support two to eight players, including optional AI opponents. The host chooses the collection, turn timing and move hints. Room codes, invitation links and QR invitations help friends reach the same table, with host approval for new arrivals.</p>
      <p>Guest play is available without an account. Google sign-in adds account-linked tables across devices, personal records and access to purchased extras. The <a href="/tutorial">guided practice hand</a> provides a starting point, while Quick Play offers a single-hand session.</p>
      <p>Players interested in records, achievements, fixed challenges and the separate human ladder have a <a href="/progress-help">records and competition guide</a>. The guide explains how progress is measured and which results are comparable.</p>
    </section>
    <section>
      <h2>Optional extras</h2>
      <p>The <a href="/store">Store</a> offers account extras including player styles, voice chat, Remove Ads and the Original Rules collection. Original Rules hosting requires access; friends invited to an entitled host’s table join without purchasing the collection.</p>
      <p>Payments are processed through Stripe Checkout. Payment-card details are entered on Stripe’s checkout page. Product descriptions and current prices appear before purchase.</p>
      <p>For information about advertising choices, saved data or account requests, read <a href="/cookies">Cookies</a>, <a href="/privacy">Privacy</a> and <a href="/data-account">Data &amp; Account</a>.</p>
    </section>
    <section>
      <h2>Developed by IBD Collective</h2>
      <p>Parkes Rummy is developed by <a href="https://www.ibdcollective.net/">IBD Collective</a>. The game and its public guides are maintained together so the explanations follow the rules used at the table.</p>
      <p>For gameplay, account, advertising, voice or purchase support, email <a href="mailto:dan@ibdcollective.net">dan@ibdcollective.net</a>. Include the room code for a game issue, your device and browser, and a short description of the problem.</p>
      <p>The <a href="/help">Help page</a> covers joining, reconnecting, card selection and sound. Never send passwords, payment-card details, API keys or authentication codes.</p>
    </section>
  </PublicGuide>;
}
