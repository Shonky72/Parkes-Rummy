# Gamification progress

## Current checkpoint: 20 October 2026 (Sydney), production context correction

- Approved scope: complete Releases 1, 2 and 3 from the supplied handover.
- Working branch: `fix/build-deployment-context`, following the merged `feature/rule-records-achievements` increment.
- Verified source baseline: `cd878fa33419a10e2d5aff6c4cf2566428b0558a` on main.
- Recovered feature head: `6f48fb5` (three transport/recovery commits only; no gamification implementation).
- Original production baseline: Netlify deployment `6ad5f475c1d499086c862898`, commit `cd878fa33419a10e2d5aff6c4cf2566428b0558a`.
- PR #15 merged as `8950a3cf87fd7d8a2530108003d5208b05a62418` after CI #82 passed on `5edb50bfb09a88ad5f493f25893dba6ff0564084`. The merge tree exactly matches the tested feature tree `5e33e622b1add93428a4a81b790efd8771f7c11f`.
- Production deployment `6ad6b562bbe583187553f5c3` is confirmed ready/published at `2026-10-20T00:28:14.130Z`, context production, exact merge commit `8950a3cf87fd7d8a2530108003d5208b05a62418`. Public pages and private record authentication work, but the anonymous competition probe returned the preview-only 409 response. Publication alone did not pass release acceptance.
- Netlify supplies `CONTEXT` during builds, not Functions runtime. This correction embeds only its nonsecret value through Next's `env` config and centralizes records, competition, ladder and existing preview-presence checks. A preview build takes precedence over a conflicting runtime flag; unknown contexts still disable collection and competition. Records profile/shared endpoints, recorded-lobby admissions and game-start activity now preserve the same preview boundary. Admission rechecks the current room under its SQL lock.
- No complete/live release claim is made at this predeployment checkpoint. The corrected build still needs final CI, preview isolation and exact production confirmation. The final deployment record will be appended to the merged correction PR, avoiding a documentation-only deployment loop.

## Preservation requirements

Keep existing gameplay, all 40 authoritative rules, purchases, Google identity, owner-dashboard permissions, mobile gestures, stationary desktop tabs, voice lifecycle, approved-guest start and winning-card reveal. Add separate profile/competition pages and a compact results highlight after the reveal. New telemetry stays private and authoritative.

## Implemented source increments

- Release 1: all 40 engine-derived rule pages, authoritative opening milestones and bounded private timeline; all 16 named achievements; all-dealt denominators, pending status, typical speed and penalty comparisons; profile and three earned featured badges; accepted friends; explicit revocable links and real 1200×630 PNG with copy/download/native share paths. The small results highlight uses the existing post-reveal gate.
- Release 2: frozen `parkes-challenge-v1` engine and AI randomness; server-private fixed seeds; atomic first attempts, reconnect and excluded practice; daily Sydney deals, best-five weeks, custom Beat My Deal links, three-deal duels, explicit rematches, private clubs, goals, rule-week boards and trophies. Matching first-attempt identity survives multiple public invitation links.
- Release 3: detailed hand review, club fastest comparable openings and consistency groups with pending denominators and 20-attempt threshold; a separate opt-in two-human full Game 1 ladder, Elo 1000/K32, ten provisional games, two rated pair meetings per Sydney day, fixed hints/timer, explicit forfeits and five-minute continuous-presence absence claims. Final game/evidence/rating settlement is atomic.
- Preview competition mutations fail closed before persistence. Ordinary preview/guest games stay untracked, and preview clients cannot mutate already recorded production games. Account markers remain identity pins, never authentication credentials.

## Remaining release queue

1. Inspect the correction PR's exact-head CI and Netlify preview; merge using the tested expected head after all gates pass.
2. Confirm the corrected production deployment ID, published/ready status and exact merge commit. Recheck production pages and anonymous API entry points, including competition/ladder reaching sign-in rather than the preview gate. Save the final identity and history start point in the merged PR record.

## Decisions

- Recover normal source from the fresh repository. The incomplete compressed transport is never applied or executed.
- Save ordinary source commits frequently; remove temporary recovery workflows and the transport fragment from the feature branch before release.
- New records start from validated collection; historical readiness is not inferred.
- Preview/test collection must use isolated storage or remain disabled. No production player fixtures.
- Existing same-deal engine/AI behaviour is frozen by version. Sydney calendar governs daily and weekly competition.
- Failed deployment leaves current production intact. Any bad published change is fixed forward via a source revert and normal CI.

## Validation

- PR #15 CI #82 passed all gates: 174 retained engine/game test executions, 42 retained backend executions, 113 records/challenge/ranked integrity tests, all nine retained browser suites, 14 grouped gamification browser checks, authenticated post-reveal checks at four widths, build/typecheck/audit and the real Netlify preview Origin probe. Evidence: [CI run 39346951506](https://github.com/Shonky72/Parkes-Rummy/actions/runs/39346951506).
- The deployment-context correction passes nine strict precedence/default-handler/activity tests, all 18 records SQL/API tests and all 12 recorded-room API tests. New admission regressions cover both pre-handler denial and the newer locked SQL state, with unchanged pending requests, memberships and room state after rejection. Existing assertions remain intact.
- Actual compiled-context matrix passes all seven HTTP assertions, with exact source hashes saved in [gamification-deployment-context.json](gamification-deployment-context.json). Build `DpKFvFNlMz4PJ2RCWweSM` captures production, then returns 401 for records/competition/ladder with both runtime context variables absent. Build `Wul9g4Jwwk0AilwOTeBVt` captures deploy-preview and returns 409 for all three despite runtime `CONTEXT=production`; presence returns 204 without a visitor cookie. Both builds had no database/auth/platform credentials. A real Netlify preview probe is now an additional CI gate; corrected final CI and production confirmation remain.
- Final CI exposed the retained one-write return contract: ordinary UPDATEs now use affected rowCount, while evidence CTEs use their returned changed-code row. The unchanged retained assertion and 47 records/room/ladder integrity cases pass after the fix.
- Locked dependencies installed with `npm ci` on Node 24; lockfile unchanged. Baseline and repeated integrated typechecks and production builds passed.
- All seven existing backend wrapper suites passed (account, authentication, activity, origin, payments, security and voice lifecycle). New records engine, records API and room integration pass; all 40 example openings validate. Pure competition/frozen engine: 19 passed. Ladder SQL/API: 19 passed. Competition SQL/API: 23 passed, including revoked-link resumption and recycled-room-code isolation.
- Full real-service browser run passed (14 grouped acceptance checks, zero browser/API errors): anonymous privacy, chosen name and earned featured badges, all 40 pages, pending denominator, private review, real 1200×630 saved PNG and native share arguments, link copy/revocation, friend consent/comparison, daily deal draw/resumption/practice, custom conditions, shared/revoked/replacement-link identity, club consent and private boards, established consistency denominators, six original duel attempts and a tied result, actual shared-hand rematch acceptance, explicit ladder consent and Elo forfeit, sign-out and no runtime errors.
- The browser harness serves real handlers over local HTTP with isolated PGlite. Chrome's saved-image requests bypass Playwright routing, so a reverse proxy replaced API interception. There are no production test identities, databases or fixture routes.
- All nine retained browser suites have a passing run at the integrated checkpoint plus the one-line inherited phone score-label fix: reveal/session, table refinement, mobile usability, home/footer, tutorial, tutorial responsive, installation, owner activity and browser security. Their test files and assertions remain unchanged. The core responsive check covers 1440, 390, 344 and 320px; explicit child-panel/control bounds now supplement document-width checks.
- The focused authenticated result test passes on 1440/390/360/320px: no result/highlight during flight or flips, full reveal hold, actual earned badges, owner-specific hand-review link, stable opponent rail, all ten opponent cards, no automatic sharing and unauthorized access rejection.
- Visual acceptance verified explicit closing turns to detailed Hand Review and complete safe comparison conditions to public PNGs/pages, including AI strength, timer, seat/order and engine version.
- Audits fixed accepted-duel result retention, weekly trophy archiving before membership changes and after long absences, owned attempt resumption after invitation/grant changes, and immutable attempt checks when room codes are reused.
- Local engine evidence in `docs/gamification-engine-benchmark.json`: 1,200 readiness checks, median 0.211 ms and p95 2.369 ms; recorded accepted-draw medians 0.350/0.406/0.575 ms for 2/4/8 players. Local measurements do not establish production latency.
- Reproducible populated-query evidence is in `docs/gamification-service-benchmark.json` and `scripts/benchmark-gamification-service.ts`: 51 accounts, 10,200 evidence rows and a 50-member club. Main competition snapshots return compact club memberships and load only the selected club's detailed boards. These are local database/assembly measurements, not production network or cold-start estimates.
- The native operating-system share sheet cannot be automated headlessly; browser tests verify real PNG File arguments and the copy/download fallbacks. Production verification remains a distinct final gate.

## Resume

Read this checkpoint and the latest Git log first. Inspect the working tree, test output and remote branch before changing source. Never overwrite unrelated later changes. After each increment, update completed work, test results, remaining queue and the verified production commit.
