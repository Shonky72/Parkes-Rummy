import LegalPage from '../components/LegalPage';

export default function CookiesPage() {
  return <LegalPage title="Cookies & Storage" intro="What Parkes Rummy stores in your browser and why.">
    <h2>Essential storage</h2><p>Parkes Rummy uses cookies and browser storage for sign-in sessions, account security, saved settings, guest seats, hand ordering and gameplay continuity. These functions are required for features you choose to use.</p>
    <h2>Game activity measurement</h2><p>The game stores a random guest-browser identifier for up to 30 days to estimate unique visitors and avoid counting multiple tabs as multiple guests. This identifier contains no name, email or game credentials. Signed-in counts use the existing account identifier. Foreground game check-ins support the private owner activity dashboard; background tabs stop reporting. Clearing browser storage resets the guest identifier. See the Privacy Policy for collection and retention details.</p>
    <h2>Advertising</h2><p>When advertising is enabled, the advertising provider may use cookies or similar technologies for ad delivery, measurement and personalisation where permitted. Consent controls will be shown where required before non-essential advertising storage is used.</p>
    <h2>Choices</h2><p>You can use browser controls to remove stored data. Removing essential game storage may sign you out or remove guest-game references from that device. Buying Remove Ads stops Parkes Rummy ad placements for the signed-in account, but does not delete essential game storage.</p>
    <h2>Contact</h2><p>For questions, email <a href="mailto:dan@ibdcollective.net">dan@ibdcollective.net</a>.</p>
  </LegalPage>;
}
