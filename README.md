# Parkes Rummy

A browser card game for two to eight seats, including optional computer players. This fresh deployment uses **Next.js, Vercel, Neon PostgreSQL and Better Auth**. Preserve the approved forest-green felt, ivory cards, gold controls and responsive interactions.

The visual references are in `design/reference/`; detailed gameplay requirements and design history are in `design/APPROVED_SPEC.md`. This README describes the current implementation and supersedes historical hosting/account notes in that design record.

**Release status:** Google sign-in and cross-device account support are implemented in source. The production build and local account/backend checks passed. The eight database tables were created and verified in Neon. External Google OAuth configuration and live application sign-in/restoration still require verification. A successful build or configuration flag does not establish that Google login works.

**Fresh start:** the user authorized new games across the board. This deployment does not migrate rooms, scores, accounts, guest tokens or card arrangements from the previous Sites/D1 service. It does not use the Sites hosting wrapper or old-game recovery notices.

## Player experience and approved design

- **Home and lobby:** join with a name as a guest, or use Google once configured. Create a room with a centred four-character code and invite using its link, QR, native sharing, copy link or Facebook's public-link sharing interface. The host chooses Game 1/2/3, optional easy/medium/hard bots, a turn limit or Unlimited, and whether valid-move hints are shown. Start with at least two participants.
- **Shared table:** show opponents' remaining cards visually and exposed melds upright by owner. Display the current player's authoritative rule prominently. Select or drag cards to a valid destination, extend a set or one run end with multiple selected cards, and drag a draw directly into a chosen hand position. Invalid grouped additions leave the entire hand unchanged.
- **Mobile:** preserve approved Option A: all ten cards in two rows of five, six plus five after drawing, without sideways scrolling or overlapping selection. Draw/discard sit directly above the hand with large separated targets. The rule and exposed cards lead the mobile display; Go down/Add selected and Discard take most of the bottom action row, with a smaller Sort button.
- **Desktop:** keep actions and player details together to the left of the hand. Selection guidance uses reserved space and does not push the cards down. Holding Sort opens number, colour or suit grouping; ordinary Sort reapplies the saved grouping and high/low direction without toggling it. Suit order keeps red suits together and black suits together.
- **Motion and sound:** retain drifting gold background suits, card travel, dealing, the prolonged gold final-card flight and glowing destination, the own-turn gold border, and optional supported-phone vibration. Respect reduced motion. The original user-supplied `Three-Note Motif.mp3` opens each fresh page visit after browser interaction. Five additional uploads follow in shuffled batches, with every added song played before a repeat and no immediate repeat between batches. Music/effects volume and mute controls are remembered on the device; pausing preserves the current song and position. Selection uses a soft paper tap.
- **Games and results:** show active games with current turn, individual rule and last gameplay-move time. Completed matches leave active counts and appear under collapsed Finished games. A completed hand remains active until the match finishes. Host Rematch returns the same participants and settings to the lobby, resetting scores and rule progress.

### Guest and account persistence

| Behavior | Guest | Signed-in account |
| --- | --- | --- |
| Seat access | Random bearer credential saved on that browser/origin | Verified HttpOnly session cookie plus server membership |
| Game list | Saved locally on that browser | Discovered from the account's memberships on each device |
| Resume elsewhere | No automatic cross-device access | Sign into the same Google account to restore the same seat, hand, score and rule |
| Manual card arrangement | Saved locally; survives refresh when storage is available | Memory-only for the active page; survives table switching but clears on refresh/logout/identity change |
| Delete list entry | Delete from this device removes the local credential, order and matching shortcut | Delete from my games hides the entry across the account's devices and retains its membership |

Guest games remain separate when signing in and are not claimed by the account. Signing out leaves server account games available for later sign-in and restores the browser's separate guest context. Actual account hands are restored from the server; manual arrangement and cosmetic preferences are not synchronized between devices. Account markers, game lists and hand card IDs are never persisted to localStorage. Guest state has an in-memory fallback when browser storage is blocked.

Deleting a guest credential loses access to that existing guest seat. Deleting an account list entry does not affect other players or remove the player's seat; background polling cannot restore it, but explicitly reopening its link or joining with the same account reveals the existing seat again. Both UI controls ask for confirmation. Whole-room deletion is a separate server API requiring the current host and current room version.

## House rules

- Deal ten cards. Exclude threes, fours and jokers. Twos are wild; ace follows king.
- Use two 44-card packs for up to four players, three for five/six, four for seven/eight. Physical duplicates have distinct IDs. Recycle discards when needed, keeping the top discard visible.
- Draw one from the stock or top discard. Discard ends the turn. No opening during the player's first turn of a hand, and the opening uses exactly the current requirement.
- A player must have melded and reached their following turn before adding to exposed cards. Later additions match set numbers or extend consecutive run order regardless of colour/suit; opening restrictions remain strict. Laid wild assignments stay fixed.
- First empty hand ends the hand. Remaining 5–7 score five each; 8–K score ten; ace/two score twenty. Each player who melded advances one rule on the next deal; anyone who did not meld repeats their rule.
- End the match after a hand in which someone completes Rule 10. Lowest total wins; equal lowest totals tie.
- Unlimited is the default timer. A timed-out turn draws if needed, discards a high-value card and passes; it does not automatically meld.

All thirty opening contracts, including Game 3's added difficulty and precise colour/suit/wild restrictions, are implemented in `lib/rummy.ts` and documented in `design/APPROVED_SPEC.md`. Keep them aligned. A stale displayed opening rule returns the authoritative room rather than silently playing different cards.

## Runtime and authorization

| Area | Source |
| --- | --- |
| Screens and responsive styling | `app/components/`, `app/*.css` |
| Game rules, scoring and bots | `lib/rummy.ts`, `lib/types.ts` |
| Room authorization and actions | `lib/room-server.ts`, `app/api/rooms/` |
| PostgreSQL transactions and membership | `db/index.ts`, `db/room-repository.ts` |
| Better Auth and verified sessions | `lib/auth.ts`, `lib/auth-config.ts`, `app/api/auth/` |
| Client identity isolation and account discovery | `lib/account-client.ts`, `lib/client-identity.ts`, `lib/client.ts`, `app/api/account/` |
| Provisioning | `db/schema.sql`, `db/schema-editor.sql`, `scripts/provision-db.ts` |

Rooms are versioned JSON documents in PostgreSQL. Mutations use atomic version checks; membership changes share the transaction. Duplicate action IDs are idempotent. Simultaneous joins from the same account converge on one seat without rotating another device's access. Rematches preserve surviving memberships; leaving/removing players cleans them up.

Guest credentials are stored server-side only as hashes. Account authority comes exclusively from a verified cookie session and membership. A client marker such as `account:<userId>` is a nonsecret identity hint, never authentication. Accounts cannot fall back to guest credentials, and guest tokens cannot access account-owned seats.

`X-Parkes-Identity` pins each request to the identity displayed by the client. Stale identity/cookie combinations return `401` with `code: ACCOUNT_IDENTITY_CHANGED` before private access or mutation. The client aborts stale requests and clears private views on identity changes. Mutations require the current room protocol and same-origin JSON; private responses are not cacheable. Keep origin checks, trusted origins and protocol enforcement enabled.

Public room projections contain only the caller's hand, exposed melds and public counts. Account list responses contain authorized summaries and a nonsecret marker, never hidden hands, raw rooms or session/guest secrets. Bots receive the same public information as human players. Animations never determine authoritative state.

Visible clients request due bot actions and expired turns, including for inactive saved games; the server validates them. Summary reads are read-only. There is no continuous background scheduler when every client is closed; processing resumes with client activity. Grouped layoffs commit atomically and finish a hand once. Draw placement is presentation state guarded against stale room, turn, identity and card anchors.

## Database and Google setup

### Provision PostgreSQL

The schema contains Better Auth user/session/provider/verification/rate-limit tables, rooms, memberships and room-creation limits. It is repeatable and does not delete data.

- **Vercel/Neon SQL editor:** run all of `db/schema-editor.sql`. It is one `DO $$ ... $$` statement because the editor rejects multiple top-level commands in a prepared query. The exact file was checked twice through a prepared PostgreSQL query and successfully created the live eight-table schema.
- **CLI:** with `DATABASE_URL` already supplied to the process, run `npm run db:provision`. To explicitly load a local file, run `node --env-file=.env.local --import tsx scripts/provision-db.ts`. This executes transaction-wrapped `db/schema.sql` with the same definitions.

There is no public database bootstrap endpoint or old-data migration. Use Neon's prescribed connection/TLS settings; do not disable certificate verification.

### Configure server-only variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string; the integration's pooled URL is appropriate for the application |
| `BETTER_AUTH_URL` | Optional explicit canonical origin. On Netlify, the app falls back to Netlify `URL`; otherwise it falls back to `NEXT_PUBLIC_SITE_URL`. Set explicitly when you want to pin the origin. |
| `BETTER_AUTH_SECRET` | Cryptographically random application secret of at least 32 characters, stable across releases |
| `GOOGLE_CLIENT_ID` | Google web OAuth client ID ending in `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Secret for that same client |

Set production values privately through Vercel. Never put actual secrets in source, the ZIP or browser code. Guest play needs a configured database; Google requires all five values. Missing/invalid auth configuration disables the Google UI. `GET /api/account/config` returns `{ enabled }`; `GET /api/account/session` returns `{ configured, user }`. An enabled flag checks configuration presence, not successful external setup.

Configure Google's consent application and a **Web application** OAuth client. For production, register origin `https://parkesrummy.com` and this exact redirect URI:

```text
https://parkesrummy.com/api/auth/callback/google
```

If verifying first on a dedicated hosting hostname, register that exact origin/callback separately. On Netlify the runtime `URL` is used when `BETTER_AUTH_URL` is unset; you can also set `BETTER_AUTH_URL` explicitly to the origin under test. Redeploy after environment changes. Add permitted testers while Google's application is restricted to test users, and configure its intended audience before release.

Better Auth handles the standard Google authorization-code flow using only `openid`, `email` and `profile`. Password login and automatic provider linking are disabled. PostgreSQL stores sessions; secure HTTPS cookies and the Next.js cookie-forwarding plugin support session renewal. Cookie session caching is disabled for current server-side validation.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/sign-in/social` | Begin Google sign-in with a safe application callback path |
| `GET /api/auth/callback/google` | Registered provider callback |
| `POST /api/auth/sign-out` | End the current session |
| `GET /api/account/session` | Discover the actual cookie identity without trusting the previous client pin |
| `GET /api/account/games` | Current account's non-hidden summaries |
| `DELETE /api/account/games/:code` | Hide from that account's list |
| `POST /api/rooms/:code/join` | Join a lobby or restore an existing seat; explicit account restoration unhides it |
| `DELETE /api/rooms/:code` | Host-only whole-room deletion with `expectedVersion` |

## Development and verification

Use **Node.js 24.x**. Netlify/Windows handoff uses npm to avoid pnpm symlink collisions in the Netlify Next.js adapter. Preserve the lockfile and the dependency-release/approved-build policies in `pnpm-workspace.yaml`.

```sh
npm install
cp .env.example .env.local
```

Set local `DATABASE_URL`, provision the schema, then run `npm run dev`. Next.js loads `.env.local`. Google may stay unconfigured during guest development. Local Google testing additionally needs a registered localhost callback and `BETTER_AUTH_URL=http://localhost:3000`; HTTP is allowed only on localhost outside production.

```sh
npm run typecheck
npm run test:backend
node --test tests/account-client.test.mjs tests/client-protocol.test.mjs
node --import tsx --test tests/client-identity.test.ts
npm run build
npm start
```

For the complete test collection:

```sh
node --import tsx --test tests/*.test.ts tests/*.test.mjs
```

The backend suite executes real PostgreSQL SQL, constraints and transactions through PGlite. It covers both schema forms, private-hand projection, cross-device membership, spoofed markers, identity races, simultaneous joins, rollback/CAS, replayed draws, hidden lists, cleanup/rematch, deletion, origin and protocol checks. Only the already-verified session boundary is substituted; this does not test a live Google callback. Client tests cover sign-in/sign-out races and private-state isolation. Existing game/interaction tests cover opening contracts, progression, scoring, drag/drop, grouped additions, card order, saved games, invitations, turn alerts and motion.

Backend/configuration tests, TypeScript and the optimized production build passed before handoff. `pnpm lint` is separately available; no unrun check is claimed as passing. Build-time initialization is lazy and does not require secrets, but runtime gameplay still requires the provisioned database. Live Google, database connectivity and deployed mobile/desktop behavior remain separate release checks.

## Vercel Drop release

`vercel.json` selects Next.js, frozen-lockfile installation, the production build and Sydney functions (`syd1`) near Neon. Static assets use Vercel's CDN. `next.config.ts` redirects `www.parkesrummy.com` to the HTTPS apex. Invitations use the current origin.

1. Create a source ZIP with `package.json`, lock/workspace files, Vercel/Next/TypeScript/PostCSS configuration and application directories at its root. Include `public/` for audio/assets and retain database scripts, tests and design references. Exclude dependencies, generated `.next` output, Git internals and configured environment files; retain the blank `.env.example`.
2. Upload through **Vercel Drop**. Subsequent source updates belong to the existing non-Git project's deployment flow. Connect Neon to that project, confirm `DATABASE_URL` reaches the intended environment, and provision the schema if not already applied. Add private Google/Better Auth values and redeploy.
3. Verify deployed guest creation/join/gameplay, then the complete Google redirect/callback, account session and same-account restoration on another device. Check logout/account switching clears private views; account list deletion stays hidden across devices; explicit restoration returns the same seat. Check approved mobile/desktop layout and audio.
4. Only after those checks pass, switch the canonical domain to the new service and verify its certificate, exact Google callback and game flows again. Keep the previous working service available until the replacement is verified.

## Facebook scope and references

Native share, copy link, QR and Facebook public-link sharing are implemented; the player chooses recipients and completes sharing. Facebook account linking and friends-list access remain unimplemented and would need separate Meta app/provider setup. Google account continuity is independent of those invitation controls.

- [Better Auth Google](https://better-auth.com/docs/authentication/google), [Next.js integration](https://better-auth.com/docs/integrations/next), [PostgreSQL](https://better-auth.com/docs/adapters/postgresql)
- [Vercel Drop](https://vercel.com/docs/drop), [configuration](https://vercel.com/docs/project-configuration/vercel-json), [regions](https://vercel.com/docs/regions), [PostgreSQL integrations](https://vercel.com/docs/postgres)
