from pathlib import Path

def edit(path, old, new):
    p=Path(path); s=p.read_text()
    if s.count(old)==1:
        p.write_text(s.replace(old,new))
    elif new not in s:
        raise RuntimeError('Expected exact source anchor in '+path)

edit('app/components/ParkesApp.tsx', "import GameLogo from './GameLogo';", "import GameLogo from './GameLogo';\nimport ActivityPresence from './ActivityPresence';")
edit('app/components/ParkesApp.tsx', '    <BackgroundSuits/>\n    {!room', '    <BackgroundSuits/>\n    <ActivityPresence roomCode={room?.code} token={tokenRef.current} name={name} accountId={account.user?.id??null}/>\n    {!room')
edit('app/components/ParkesApp.tsx', '<p className="settings-save-note">', '{account.user?.email.trim().toLowerCase()===\'dan@ibdcollective.net\'&&<div className="settings-games-row"><a className="button outline" href="/admin/activity">Owner activity dashboard</a><p>Live players and account activity. Private owner access.</p></div>}<p className="settings-save-note">')
edit('lib/room-server.ts', "import { isAllowedRoomWriteOrigin } from './request-origin';", "import { isAllowedRoomWriteOrigin } from './request-origin';\nimport { recordActivityGameStart } from '../db/activity';")
edit('lib/room-server.ts', '        if (await repository.insert(room, membership)) return reply({ room: publicRoom(room, host.id), token }, 201);', "        if (await repository.insert(room, membership)) {\n          if (quickPlay) await recordActivityGameStart(room);\n          return reply({ room: publicRoom(room, host.id), token }, 201);\n        }")
edit('lib/room-server.ts', '          const stillPresent = next.players.some(candidate => candidate.id === player.id);', "          if (action.type === 'start') await recordActivityGameStart(next);\n          const stillPresent = next.players.some(candidate => candidate.id === player.id);")
edit('app/privacy/page.tsx', '<strong>Effective:</strong> 11 October 2026', '<strong>Effective:</strong> 17 October 2026')
edit('app/privacy/page.tsx', '    <h2>Payments and purchases</h2>', '''    <h2>Player activity and owner dashboard</h2><p>While the game is visible, a small check-in records whether you are browsing, in a lobby, playing or viewing results. This uses your account identifier for signed-in play, or a random browser identifier for guests. It also records the table code and recent check-in time. The owner-only dashboard shows player counts and the Google sign-in name and email for active signed-in players. Guests are shown by their chosen name without an email. This does not grant access to Gmail messages, microphone recordings or other browser activity.</p><p>Check-ins stop while the game is in the background. The online view uses a 90-second window. Detailed check-in records are cleaned after 24 hours; daily identifiers, game-start totals and peak counts are cleaned after 30 days on the next activity request. The random guest identifier expires after 30 days. Signing in lets us count one account across devices; guest counts remain estimates. Account deletion also removes account-linked activity identifiers. These operational records are not sent to third-party analytics services.</p>
    <h2>Payments and purchases</h2>''')
edit('app/cookies/page.tsx', '    <h2>Advertising</h2>', '''    <h2>Game activity measurement</h2><p>The game stores a random guest-browser identifier for up to 30 days to estimate unique visitors and avoid counting multiple tabs as multiple guests. This identifier contains no name, email or game credentials. Signed-in counts use the existing account identifier. Foreground game check-ins support the private owner activity dashboard; background tabs stop reporting. Clearing browser storage resets the guest identifier. See the Privacy Policy for collection and retention details.</p>
    <h2>Advertising</h2>''')
edit('tests/activity.test.ts', "assert.equal((await API(null).pulse(req(pulse,'guest',bearer,'https://evil.test')))).status,403);", "assert.equal((await API(null).pulse(req(pulse,'guest',bearer,'https://evil.test'))).status,403);")
edit('.github/workflows/ci.yml', 'tests/meld-layout.test.ts tests/request-origin.test.ts', 'tests/meld-layout.test.ts tests/request-origin.test.ts tests/activity.test.ts')
edit('.github/workflows/ci.yml', '      - name: Verify compact melds, pending feedback and one-hand Quick Play', '''      - name: Verify private owner dashboard and foreground presence
        run: node --import tsx tests/activity-ui.mjs
      - name: Save owner dashboard screenshots
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: owner-activity-results
          path: owner-activity-results/
          if-no-files-found: ignore
          retention-days: 3
      - name: Verify compact melds, pending feedback and one-hand Quick Play''')
print('Owner activity integration applied; existing cards, turns and screen layout preserved.')
