# Parkes Rummy: approved build

The five approved mockups in this conversation are the visual specification. Preserve dark forest felt, ivory cards, gold controls, layout, names/initial avatars, four-player shared board, and clean invitation flow. Make responsive arrangements without restyling. The accepted reference images are preserved in design/reference/. Do not substitute another theme. Later explicit user rules below supersede illustrative numbers in the mockups.

## Confirmed house rules

- No threes or fours, no jokers. Twos are wild. Ace follows king.
- Deal ten cards to each player. Game 1 runs allow mixed suits.
- Each player has an individual rule number. Only players who melded during a hand advance to the next rule when the next hand is dealt. A player who did not meld repeats the same rule, even when another player wins the hand.
- No going down during a player's first turn of a hand (first lap of the table).
- An opening meld contains exactly the cards required by the current rule, never extras.
- A player who goes down must wait until their next turn before adding to any exposed meld, including their own.
- A player must be down before adding to exposed cards.
- First player with an empty hand ends the hand. Remaining cards score 5–7 = 5; 8–K = 10; A and 2 = 20. The lowest cumulative score wins; ties remain ties.
- Hand display defaults to descending A, K, Q … 5. A personal setting switches to ascending order. This does not change the rank of an ace.
- Optional AI players: each has easy, medium or hard difficulty, selected individually in the lobby. Bots obey the same rules and never inspect opponents' hidden hands or future stock cards.

## Screens and interaction

- Home: name, Create game, room-code fallback Join game, How to play, sound toggle and Your games list.
- Lobby: host, up to eight players, automatically ready on join, native share/Facebook/copy-link invitations, live QR for the room, Game 1/2/3, rules list, Your games switcher and host Start with N players. Add AI from an open seat without adding an unrelated setup screen.
- Guest invite: known room, one name field, Join game. No account or download. Returning browser restores existing seat.
- Table: visual opponent card backs, rules at left, draw/discard, four clearly owned meld zones with all faces upright, own hand fixed at bottom, valid layoff targets highlighted for selected card, Go down/Add selected/Discard as appropriate. Eight players use additional meld rows.
- Scores: each player's own rule progress/status, complete current rule list, cumulative points and round details. Results show who melded and advances, and who repeats the same rule.
- Sound: card taps/draws, shuffle/deal, going down, layoff, discards, joining, own turn, hand end and game end; mute and volume settings remembered on device. User supplied Three-Note Motif.mp3 for looping background music. Play following first user interaction, with separate music/effects volume and remembered controls.

## Implementation choices where not specified

- Two 44-card packs for 2–4 players, three for 5–6, four for 7–8; duplicates have unique IDs.
- Shuffle the discard pile except its top card when the draw pile is exhausted.
- Laid wildcards keep their represented rank and suit; no wildcard-replacement mechanic.
- Joining is allowed in the lobby. Existing players rejoin ongoing games. New participants wait for a new lobby/rematch.
- The match ends after a hand in which at least one player completes Rule 10; the existing lowest-total-score winner format is retained.

## Game 1
1. Run of 5
2. 2 × 3 of a kind
3. 3 of a kind + run of 4
4. Run of 7
5. 2 × 4 of a kind
6. 4 of a kind + run of 5
7. Run of 8
8. 2 of a kind + 5 of a kind
9. Run of 9
10. 3 of a kind + 5 of a kind

## Game 2
1. Run of 4, one of each suit; twos follow suit.
2. 2 × 3 of a kind: one black set, one red set; twos match.
3. Run of 6, all black or all red; twos match.
4. Run of 7, alternating red and black; twos match.
5. 2 of a kind + 5 of a kind, without twos.
6. 3 × 3 of a kind.
7. 6 of a kind.
8. Run of 8, all the same suit.
9. 4 of a kind + 3 of a kind + a pair.
10. 8 of a kind + a pair of hearts.

## Game 3

Approved as the next difficulty tier after Game 2. Each opening uses at most ten cards. Expose Game 3 through the existing lobby selector, rules viewer and scores screen, preserving the green, gold and ivory design. Show the opening restrictions beside the current rule.

1. Run of 4, one of each suit, alternating red and black. A two keeps its printed suit; the run uses all four suits and alternates colours, starting with either colour.
2. Four of a kind in one colour + three of a kind in the opposite colour. Accept either four red plus three black or four black plus three red. Twos match their set's printed colour.
3. Run of 5, all one suit. Twos match the printed suit of the run.
4. Run of 7, alternating red and black + a pair. Twos in the run match the printed colour needed at their position; the pair accepts any two as a wild.
5. Three of a kind + five of a kind, using natural cards only. No twos in either opening group.
6. Three sets of three: one red, one black and one unrestricted. Twos match the printed colour in each coloured set; the unrestricted set accepts any two.
7. Six of a kind + a pair. Any two works as an ordinary wild.
8. Run of 9, all represented in one suit. Any two works as an ordinary wild, including representing a suit different from its printed suit.
9. Two sets of four + a pair. Any two works as an ordinary wild.
10. Eight of a kind + a natural pair of hearts. Any two works in the eight of a kind. The pair must contain two natural hearts of the same rank, with no twos or wild replacement.

A pair means two matching ranks, and every group uses separate physical cards. The natural heart pair uses the copies from two packs, for example Q♥ + Q♥. Opening restrictions stop applying to later additions. Players who never meld during the round repeat their current rule.

## Later confirmed additions
- Host turn timer in Game rules: Unlimited (default), or a selected number of seconds. Server enforces timeout with draw if needed, automatic discard, then next turn. No automatic opening or layoff on timeout.
- Mobile support is required, with touch targets, fixed own hand and scrolling upright shared melds.
- The final card played to empty a hand uses slow motion before revealing the round result. Reduced-motion preferences and animation cleanup remain supported.
- Stretch the winning-card moment substantially: an enlarged, brightly gold-lit card, a visible flight to the discard pile or meld, a glowing destination and a final-card announcement before the results. Preserve the existing felt/card design.
- The rule shown on screen must match the authenticated player's server rule, including players repeating a requirement. Stale pages must refresh safely; selected cards, saved seats, scores and individual progress must not be silently changed to fit an incorrect display.

## Approved mobile hand and room refinements

- Option A is selected: show all ten mobile hand cards in two complete rows of five; after drawing, use six plus five. No sideways hand scrolling or overlapping card faces. Keep the large single centre suit and a clear rank.
- Put player name, score and hand count above the full-width hand; selected cards have a gold outline and small inset tick, without covering neighbouring targets. Keep hold-and-drag, cross-row ordering, keyboard ordering and table/drop interactions.
- Remove the small repeated Parkes Rummy name from page headers. Retain the card mark, the large home title, exit and settings controls.
- New room codes have four characters. Centre room-code entry and displays. Preserve existing six-character rooms, invite links and saved seats.
- Animate the quiet outlined gold background suits with gentle diagonal movement. Keep them noninteractive and stationary for reduced motion.
- Enlarge the draw and discard cards and separate their individual tap targets with a clear inactive gap. Preserve the main table at the top of the mobile screen and readable rule text.

## Opening and later additions

- Colour, suit and natural-card restrictions belong to the opening requirement only. Once additions are eligible, match a set by its represented number or extend a run in sequence, using any colour or suit. Twos are ordinary wilds for later additions.
- Keep the opening requirements strict, including Games 2 and 3 colour patterns, suit and wildcard restrictions, and consecutive distinct run numbers. Keep the existing draw-first, own-turn, go-down-first and wait-until-next-turn conditions for additions.
- Existing exposed wild cards retain their assigned values. Apply the clarified additions to existing rooms without resetting cards, scores or rule progress.
- Allow multi-card selection after melding. One target places the whole valid selection onto one matching set or one chosen run end. Selection order is irrelevant; extending below an exposed 8 with 7, 6 and 5 applies those three additions in descending order. Runs remain consecutive and within 5 through ace, wild twos fill gaps, and sets accept matching numbers and wilds.
- Validate grouped additions atomically against the latest turn, hand and meld. Invalid groups keep every card in hand. Emit public physical-card events in placement order and finish/scoring only once. Preserve individual hand-card dragging and the gold final-card sequence.
- Move hints apply to the complete selected group. Show **Add N** for multi-card targets. With hints off, expose the same neutral set and run-end controls and validate only upon submission. Keep the selection guidance within its existing reserved space.
- Remove the partly hidden feature badges underneath the decorative home cards.
- Explain invalid opening selections clearly. The later screenshot selected 5♣, 6♣, 7♣, 8♣, 9♠ and 9♣; replacing either nine with the held 10♠ produces the valid black run. Do not weaken run matching to accept duplicate ranks.

## Fold mobile controls and saved sorting

- Support dragging from the draw pile or visible discard directly into a chosen hand slot. Desktop uses normal dragging; mobile uses a brief hold followed by movement. Show an insertion line across either mobile row without adding layout height. Keep normal tap and keyboard drawing.
- Render the unknown stock card face down while dragging. Request the draw only after a valid hand drop, then insert the one newly confirmed physical card while preserving the other cards and the sort preference. Guard room, player, turn, credential and anchor changes; accept a poll-first confirmation once. Invalid drops, early touch scrolling, Escape, pointer cancellation, hidden pages and navigation do not commit a draw.

- Remove the home subtext “Your next card night starts here”. Keep the large Parkes Rummy title.
- Place the mobile draw and discard piles inside the fixed hand panel, directly above the cards, with clear spacing between touch targets. Preserve the full ten-card Option A hand.
- Give the current rule the full mobile table width. Start the mobile table at the rule and exposed-card area, with the header and opponent strip available by scrolling up. Do not reset scroll during normal turns, selections, updates or resizing.
- Remove the redundant bottom Down/Not Down indicator. Go down/Add selected and Discard occupy most of the bottom row; Sort stays small at the right. Keep Clear selection beside the turn guidance.
- Settings owns the preferred High → low or Low → high order. Sort reapplies the saved direction after manual arrangements and never reverses the preference.
- Keep a single pair of live pile controls across responsive layouts. Preserve card travel, the gold winning-card sequence, sound and touch/drag placement when a Fold changes width.

## Stable desktop selection and grouped sorting

- On desktop, group player details with Go down/Add selected, Discard and Sort at the left of the hand to reduce mouse travel. Place the actions in a row beneath the details, keeping Sort smaller, and let cards occupy the remaining width to the right. Preserve the mobile layout.
- Desktop card selection must not move the hand down when selection guidance or Clear selection appears. Reserve a stable feedback band and placement-heading/scrollbar dimensions.
- A normal Sort press reapplies the selected grouping and saved rank direction. Holding Sort opens number, colour and suit choices in an overlay without changing the hand layout.
- Colour sorting places red cards before black cards. Suit sorting uses hearts, diamonds, clubs, spades, keeping the red suits adjacent and the black suits adjacent.
- The preferred high/low direction applies within each group. Wild twos finish each colour or suit group; ordinary number sorting keeps all twos together at the end.
- Save grouping independently from the Settings direction. Preserve manual card arrangements through room updates until the next deliberate Sort.
- Holding, cancelling a hold and dismissing the Sort menu must not trigger an unintended sort. Keep touch, mouse and keyboard access.

## Turn alerts and clearer player labels

- During the player's own turn, pulse a gold frame around the visible viewport on a 2.4-second cycle. Keep the frame fixed to the visible phone screen through scrolling, folding and resizing, with no pointer interception or layout movement.
- Reduced motion uses a steady gold frame. Preserve the separate winning-card gold sequence.
- Offer **Vibrate on your turn** in Settings. Supported phones receive one short 80 ms vibration per turn after browser interaction, with the preference remembered on the device.
- Polls, drawing, melding, additions, switching tables and refreshing must not repeat a delivered vibration for the same turn. Hidden pages stop vibration.
- Remove the duplicated current-player name from the turn guidance. The current-rule heading reads **YOUR RULE** without repeating the player's name. Keep the main player identity and opponent labels.

## Multiple saved games

- Show **Your games** on home, and provide a switcher from the table, lobby and Settings. Players retain existing seats while opening another table or creating a further game.
- Each row shows the room code, Game 1/2/3, host and players, the current turn, the player's own rule and the most recent gameplay-move time. Own-turn rows take priority. Lobby, completed-hand and finished-game states have distinct labels.
- Completed matches leave the active list and all active-game counters. A completed hand remains active while the match continues. Keep final results in a separate **Finished games** disclosure, collapsed initially, with its own count.
- Offer **Delete from this device** on every saved game, including finished and unavailable entries. Confirm before removing the local seat and room-specific hand order; explain that the player loses access to that saved seat on this browser. Preserve other rooms, names, sort preferences and other players' games. Reject an older confirmation when the saved seat token has changed.
- Finished games expose **View results** and a host-only **Rematch** control. The current finished table's results remain reopenable. Final scores also provide Rematch and deletion. Rematches retain the room code, participants and all lobby settings, reset scores and rule progress, and return to the lobby and active list.
- Rematch requests include the displayed room version. Enforce host ownership, finished status and exact version on the server, returning the authoritative room for stale requests. Repeated requests reset once. Preserve the existing host-controlled return-to-lobby action between hands.
- Retain a separate manual hand arrangement for each room. Switching tables preserves the order, saved sort preferences and seat. Fresh deals reject arrangements belonging to older card IDs.
- Saved games belong to the browser and device used to join. Cross-device account sync is pending.
- Read summaries only for explicitly supplied, authenticated saved seats. Keep summaries free of hands and credentials, and preserve successful rows when another room fails to respond. Unavailable rows offer retry and removal from the local list.
- Preserve the most recent gameplay timestamp independently of trimmed event history. Settings and joins do not move the timestamp. A rematch resets the value; legacy rooms use retained gameplay events without inventing a date.
- Guard delayed responses using the active room, saved credential, player identity, navigation state and version. A changed credential clears the previous seat's metadata. An old failed poll must not override a newer successful room update.
- Summary reads remain read-only. While the page is visible, separately request due bot steps or expired turns in inactive games through the existing authorized action route. Do not choose optional moves for a human player. Background activity pauses when the page is hidden.
- Keep saved seats, manual hand order and preferences available for the active page through an in-memory fallback when browser storage is blocked or writes fail.

## Friend invitations

- The lobby offers **Share invite**, **Facebook** and **Copy link**, with the existing QR and room-code flow preserved.
- Native sharing opens the device's sharing options when supported and falls back to copying the link. Facebook opens its sharing interface for the public room invitation.
- The player chooses recipients or audience and completes sending in the selected sharing service. These controls provide invitations without linking a Facebook account or importing friends.

## Pending requirement: Facebook account linking

Facebook account linking was requested but is **not implemented**. A registered Meta App ID and app setup, plus a supported Sites integration for external identity, are required before implementation. Facebook friend-list access and cross-device account sync also remain pending. Record these as outstanding requirements; do not describe the sharing buttons as a completed account-linking integration.

## Checks for turn alerts, invitations and saved games

Run `tests/saved-games.test.ts`, `tests/turn-alerts.test.ts` and `tests/invite-share.test.ts` alongside the existing checks. Saved-game coverage includes per-seat metadata, credential changes, version races, failure isolation and authorized background scheduling. Turn-alert coverage includes once-per-turn delivery, storage fallback, visibility, browser activation and preference handling. Invitation coverage includes current and legacy public room links and malformed-link rejection. API integration and client protocol suites also cover authenticated read-only summaries, independent move times, multi-room storage and preserved hand arrangements.
