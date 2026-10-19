# Pre-launch security release

Prepared against production commit `a8270b5bb7e380c410ea87e94538e88763f1af66`.
This branch must be reviewed before merging or publishing to production.

## Behaviour and compatibility

- Card rules, engine, scoring, decks, bots, turns and stored game state are unchanged.
- Newcomers request a seat; only the current host can approve it while the lobby
  has space. Existing account memberships and guest tokens return directly.
- Invitations no longer reveal names or player IDs before approval. Four- and
  six-character codes, shared links and saved games remain supported.
- Requests expire after ten minutes and are stored separately from rooms.
  Approval uses a room lock, version increment and membership transaction.
  Rejection, cancellation, expiry and removed-seat replays grant no access.
- Protocol `host-approval-v7` prompts old clients to refresh before writes.
  Saved seats and game progress are retained; no rejected action is replayed.
- Voice joins are invalidated on exit, background, account or room changes and
  authorization loss, including delayed permission and HTTP responses.

## Dependencies and database

Next.js and eslint-config-next are pinned to the registry-verified 16.4.2 release.
`package-lock.json` and `npm ci` make CI and Netlify application dependencies
repeatable. The Netlify-managed Next.js adapter remains automatically managed.

`db/security-migration.sql` is additive and idempotent. It creates quota/probe
and join-request tables only. Handlers also safely initialize these tables on
first use, so existing games do not need conversion. No secrets are added.

Runtime PostgreSQL must have the same table-creation permissions already used
by the existing store/activity setup, or an operator must apply this migration
before release. New tables use foreign keys to existing rooms/accounts.

## Request limits and privacy

- Only Netlify's connection-IP header is trusted in production. Missing trusted
  identity returns 503; untrusted forwarding headers do not supply a fallback.
- Quotas are atomic and database-backed across workers. IP/actor keys are hashed;
  rate-limit and distinct-code records are cleaned automatically.
- Initial budgets include 15 room creations per five minutes; 12 distinct room
  probes per five minutes; 60 repeated previews/minute; 24 join submissions per
  five minutes; 120 presence requests/minute/IP; and separate read/action/voice
  budgets. Shared-IP limits allow normal eight-player polling. Endpoint-wide
  limits additionally bound aggregate workload.
- HTTP 429 includes Retry-After. Room and presence clients and voice polling
  respect cooldowns without retrying card mutations.
- Guest presence uses a signed HttpOnly visitor cookie rather than trusting
  caller-supplied visitor IDs. It reuses the existing Better Auth signing secret.
  If that secret is absent, telemetry fails safely; card play remains available.
- Advertising scripts load only with explicit consent, advertising enabled and
  confirmed non-ad-free eligibility. Account uncertainty and declined consent
  prevent initial loading. Withdrawal reloads the page to stop loaded scripts.
- Cookies offers an accessible advertising-choice control. Privacy/cookie text
  reflects visitor cookies and host approval.

## Browser policy

HTML responses receive fresh 128-bit CSP nonces and dynamic rendering, avoiding
cached/reused nonces. Next.js bootstrap scripts receive their nonce through the
forwarded request CSP. Framing is denied; microphone is limited to self, and
camera/geolocation are disabled. Referrer and MIME policies cover APIs too.

AdSense uses nonce-bearing script loading and strict-dynamic according to
Google's CSP guidance. Advertising-enabled builds additionally permit script
evaluation and HTTPS ad network resources as required by that integration;
advertising-disabled builds omit those exceptions. No unsafe-inline script
permission is added. Actual ad serving still depends on Google's account/site
approval; automated browser tests intercept the provider, never real ads.

## Verification and release

The security suite uses real PostgreSQL SQL in PGlite with injected session and
profile/entitlement boundaries. The browser suite uses the actual production
application, Chromium and fixture-only intercepted API responses. It creates no
production accounts, games or purchases and adds no deployed authentication bypass.

Run:

```sh
npm ci --ignore-scripts
npm run typecheck
node --import tsx --test tests/*.test.ts
node --test tests/account-client.test.mjs tests/client-protocol.test.mjs
npm audit --omit=dev --audit-level=high
npm run build
node --import tsx tests/security-browser.mjs
```

Also run existing table, mobile, homepage, tutorial and installation browser
checks. CI runs owner-dashboard checks with its existing CI-only fixture and
checks a real Netlify PR preview for origins, denial of anonymous owner access,
response headers and spoof-resistant probing limits. Preview probes use invalid
codes so no existing player room is read or mutated.

Release only after CI and the Netlify preview pass. Keep the production deploy
unchanged until review. Database additions permit rolling the application back
without rewriting saved games; leave additive tables in place on rollback.

Known development-tool limitation: the full npm audit reports the braces
stack-exhaustion advisory through eslint-config-next's globbing dependencies.
The registry has no patched braces 3.x version. It is not in the production
dependency tree, which audits clean; do not apply npm audit's suggested downgrade
of eslint-config-next to Next 14. Lint also has pre-existing legacy React compiler
findings; it is not represented as a passing check for this release.
