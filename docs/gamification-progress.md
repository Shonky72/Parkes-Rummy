# Gamification progress

## Current checkpoint: 20 October 2026 (Sydney), release acceptance

- Approved scope: complete Releases 1, 2 and 3 from the supplied handover.
- Working branch: `feature/rule-records-achievements`.
- Verified source baseline: `cd878fa33419a10e2d5aff6c4cf2566428b0558a` on main.
- Recovered feature head: `6f48fb5` (three transport/recovery commits only; no gamification implementation).
- Production checked: Netlify deployment `6ad5f475c1d499086c862898`, context production, published and ready, commit `cd878fa33419a10e2d5aff6c4cf2566428b0558a`.
- Previous remotely saved integrated source: `ed99bf3c1e528b8a2db3cd8014b64b5cfc855c1d`. This checkpoint adds audited reservation, trophy, performance and browser-acceptance fixes.
- No new gamification release is live at this checkpoint. Production still requires final exact-commit verification.

## Preservation requirements

Keep existing gameplay, all 40 authoritative rules, purchases, Google identity, owner-dashboard permissions, mobile gestures, stationary desktop tabs, voice lifecycle, approved-guest start and winning-card reveal. Add separate profile/competition pages and a compact results highlight after the reveal. New telemetry stays private and authoritative.

## Implemented source increments

- Release 1: all 40 engine-derived rule pages, authoritative opening milestones and bounded private timeline; all 16 named achievements; all-dealt denominators, pending status, typical speed and penalty comparisons; profile and three earned featured badges; accepted friends; explicit revocable links and real 1200×630 PNG with copy/download/native share paths. The small results highlight uses the existing post-reveal gate.
- Release 2: frozen `parkes-challenge-v1` engine and AI randomness; server-private fixed seeds; atomic first attempts, reconnect and excluded practice; daily Sydney deals, best-five weeks, custom Beat My Deal links, three-deal duels, explicit rematches, private clubs, goals, rule-week boards and trophies. Matching first-attempt identity survives multiple public invitation links.
- Release 3: detailed hand review, club fastest comparable openings and consistency groups with pending denominators and 20-attempt threshold; a separate opt-in two-human full Game 1 ladder, Elo 1000/K32, ten provisional games, two rated pair meetings per Sydney day, fixed hints/timer, explicit forfeits and five-minute continuous-presence absence claims. Final game/evidence/rating settlement is atomic.
- Preview competition mutations fail closed before persistence. Ordinary preview/guest games stay untracked, and preview clients cannot mutate already recorded production games. Account markers remain identity pins, never authentication credentials.

## Remaining release queue

1. Finish the extended browser run for custom deals, revoked-link resumption, club approval/boards, six duel attempts and rematches. The core profile, share image, daily attempt, ladder and responsive browser run has passed.
2. Finish the focused authenticated post-reveal record highlight check. All nine retained game browser suites have passed with the original assertions; the inherited mobile score-label width cap has been removed.
3. Save the final tested source, open the PR, inspect exact CI/deploy-preview results, recheck current main, and merge using the expected head.
4. Verify the exact production deployment ID, published/ready status and commit. Update this file with live release status and the history start point.

## Decisions

- Recover normal source from the fresh repository. The incomplete compressed transport is never applied or executed.
- Save ordinary source commits frequently; remove temporary recovery workflows and the transport fragment from the feature branch before release.
- New records start from validated collection; historical readiness is not inferred.
- Preview/test collection must use isolated storage or remain disabled. No production player fixtures.
- Existing same-deal engine/AI behaviour is frozen by version. Sydney calendar governs daily and weekly competition.
- Failed deployment leaves current production intact. Any bad published change is fixed forward via a source revert and normal CI.

## Validation

- Locked dependencies installed with `npm ci` on Node 24; lockfile unchanged. Baseline and repeated integrated typechecks and production builds passed.
- All seven existing backend wrapper suites passed (account, authentication, activity, origin, payments, security and voice lifecycle). New records engine, records API and room integration pass; all 40 example openings validate. Pure competition/frozen engine: 19 passed. Ladder SQL/API: 19 passed. Competition SQL/API: 23 passed, including revoked-link resumption and recycled-room-code isolation.
- Core real-service browser run passed: anonymous privacy, chosen name and earned featured badges, all 40 pages, pending denominator, private review, real 1200×630 saved PNG and native share arguments, link copy/revocation, friend consent/comparison, daily deal draw/resumption/practice, explicit ladder consent and Elo forfeit, sign-out and no runtime errors.
- The browser harness serves real handlers over local HTTP with isolated PGlite. Chrome's saved-image requests bypass Playwright routing, so a reverse proxy replaced API interception. There are no production test identities, databases or fixture routes.
- All nine retained browser suites have a passing run at the integrated checkpoint plus the one-line inherited phone score-label fix: reveal/session, table refinement, mobile usability, home/footer, tutorial, tutorial responsive, installation, owner activity and browser security. Their test files and assertions remain unchanged. The core responsive check covers 1440, 390, 344 and 320px; explicit child-panel/control bounds now supplement document-width checks.
- Visual acceptance added explicit closing turns to detailed Hand Review and complete safe comparison conditions to public PNGs/pages, including AI strength, timer, seat/order and engine version.
- Audits fixed accepted-duel result retention, weekly trophy archiving before membership changes and after long absences, owned attempt resumption after invitation/grant changes, and immutable attempt checks when room codes are reused.
- Reproducible populated-query evidence is in `docs/gamification-service-benchmark.json` and `scripts/benchmark-gamification-service.ts`: 51 accounts, 10,200 evidence rows and a 50-member club. Main competition snapshots return compact club memberships and load only the selected club's detailed boards. These are local database/assembly measurements, not production network or cold-start estimates.
- The native operating-system share sheet cannot be automated headlessly; browser tests verify real PNG File arguments and the copy/download fallbacks. Production verification remains a distinct final gate.

## Resume

Read this checkpoint and the latest Git log first. Inspect the working tree, test output and remote branch before changing source. Never overwrite unrelated later changes. After each increment, update completed work, test results, remaining queue and the verified production commit.
