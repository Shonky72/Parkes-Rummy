import LegalPage from '../components/LegalPage';
export default function AboutHelpPage() {
  return <LegalPage title="About & Help" intro="Parkes Rummy by IBD Collective.">
    <h2>About</h2><p>Parkes Rummy is a browser-based multiplayer card game built around the Parkes house rules. It supports multiple rule sets, guest play, optional accounts, player styles and table voice.</p>
    <h2>Getting help</h2><p>For gameplay, account, advertising, voice or purchase support, email <a href="mailto:dan@ibdcollective.net">dan@ibdcollective.net</a>. Include the room code for a game issue, but do not send passwords, payment-card details, API keys or authentication codes.</p>
    <h2>Payments</h2><p>Optional extras are processed through Stripe-hosted Checkout. Parkes Rummy does not ask for card details inside the game.</p>
    <h2>Developer</h2><p>Developed by IBD Collective.</p>
  </LegalPage>;
}
