import LegalPage from '../components/LegalPage';
export default function DataAccountPage() {
  return <LegalPage title="Data & Account" intro="Account access, deletion and purchase-data information.">
    <h2>Access across devices</h2><p>Sign in with the same supported account on each device to access account-linked games, player styles and permanent purchases.</p>
    <h2>Delete a guest game from one device</h2><p>The Your Games controls let a guest remove a saved game reference from that browser. This does not delete the shared room for other players.</p>
    <h2>Account-data deletion</h2><p>To request deletion of a Parkes Rummy account and associated personal game data, email <a href="mailto:dan@ibdcollective.net?subject=Parkes%20Rummy%20account%20deletion">dan@ibdcollective.net</a> from the address connected to the account. Include “Parkes Rummy account deletion” in the subject.</p><p>Some transaction, fraud-prevention or legal records may need to be retained after deletion. Deleting an account also removes access to account-linked entitlements where the law does not require otherwise.</p>
    <h2>Payment questions</h2><p>For a purchase question, include the approximate purchase date and the email used at checkout. Never send card numbers, banking credentials or API keys by email.</p>
    <h2>Voice privacy</h2><p>Leaving voice, leaving the table or backgrounding the installed game stops the local microphone stream. Parkes Rummy does not provide voice recording or transcription.</p>
  </LegalPage>;
}
