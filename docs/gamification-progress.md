# Gamification progress

## Current checkpoint: 20 October 2026 (Sydney), integrated source

- Approved scope: complete Releases 1, 2 and 3 from the supplied handover.
- Working branch: `feature/rule-records-achievements`.
- Verified source baseline: `cd878fa33419a10e2d5aff6c4cf2566428b0558a` on main.
- Recovered feature head: `6f48fb5` (three transport/recovery commits only; no gamification implementation).
- Production checked: Netlify deployment `6ad5f475c1d499086c862898`, context production, published and ready, commit `cd878fa33419a10e2d5aff6c4cf2566428b0558a`.
- Last remotely saved foundation: `095a46ee1b5ae090751871d7e86b0df66b088735`. The next commit saves the integrated source described below.
- No new gamification release is live at this checkpoint. Production still requires final exact-commit verification.

## Preservation requirements

Keep existing gameplay, all 40 authoritative rules, purchases, Google identity, owner-dashboard permissions, mobile gestures, stationary desktop tabs, voice lifecycle, approved-guest start and winning-card reveal. Add separate profile/competition pages and a compact results highlight after the reveal. New telemetry stays private and authoritative.

## Implemented source increments

- Release 1: all 40 engine-derived rule pages, authoritative opening milestones and bounded private timeline; all 16 named achievements; all-dealt denominators, pending status, typical speed and penalty comparisons; profile and three earned featured badges; accepted friends; explicit revocable links and real 1200×630 PNG with copy/download/native share paths. The small results highlight uses the existing post-reveal gate.
- Release 2: frozen `parkes-challenge-v1` engine and AI randomness; server-private fixed seeds; atomic first attempts, reconnect and excluded practice; daily Sydney deals, best-five weeks, custom Beat My Deal links, three-deal duels, explicit rematches, private clubs, goals, rule-week boards and trophies. Matching first-attempt identity survives multiple public invitation links.
- Release 3: detailed hand review, club fastest comparable openings and consistency groups with pending denominators and 20-attempt threshold; a separate opt-in two-human full Game 1 ladder, Elo 1000/K32, ten provisional games, two rated pair meetings per Sydney day, fixed hints/timer, explicit forfeits and five-minute continuous-presence absence claims. Final game/evidence/rating settlement is atomic.
- Preview competition mutations fail closed before persistence. Ordinary preview/guest games stay untracked, and preview clients cannot mutate already recorded production games. Account markers remain identity pins, never authentication credentials.

## Remaining release queue

1. Finish the independent fairness audit and its regression cases (club departure/trophy timing, accepted-duel result retention).
2. Run the new browser suite through actual pages, real handlers and isolated PGlite; inspect desktop, phone, Fold cover, 320px and reduced-motion screenshots. Complete sharing, challenges, club/duel/rematch and ladder functional checks.
3. Run the production build and retained engine/backend/browser regressions. Benchmark collection and populated leaderboard queries.
4. Save tested source, open the PR, inspect its exact CI/deploy preview, recheck current main, and merge using the expected head.
5. Verify the exact production deployment ID, published/ready status and commit. Update this file with live release status and the history start point.

## Decisions

- Recover normal source from the fresh repository. The incomplete compressed transport is never applied or executed.
- Save ordinary source commits frequently; remove temporary recovery workflows and the transport fragment from the feature branch before release.
- New records start from validated collection; historical readiness is not inferred.
- Preview/test collection must use isolated storage or remain disabled. No production player fixtures.
- Existing same-deal engine/AI behaviour is frozen by version. Sydney calendar governs daily and weekly competition.
- Failed deployment leaves current production intact. Any bad published change is fixed forward via a source revert and normal CI.

## Validation

- Locked dependencies installed with `npm ci` on Node 24.
- Baseline and integrated typecheck passed. All seven existing backend wrapper suites passed (account, authentication, activity, origin, payments, security and voice lifecycle).
- New engine records, records API and room-integration suites pass; all 40 example openings validated. Pure competition/frozen engine tests: 19 passed. Ladder SQL/API tests: 19 passed. Competition SQL/API tests: 19 passed before the final audit additions.
- New browser suite and CI preservation step are authored. Full production build and browser verification are the next gate.
- Official matching Chrome for Testing 156.0.8078.4 is available locally; the initial restricted-process build was restarted with appropriate process permissions. No production test identities or table fixtures are used.
- Release acceptance is tracked against the complete handover; implementation and production status are separate.

## Resume

Read this checkpoint and the latest Git log first. Inspect the working tree, test output and remote branch before changing source. Never overwrite unrelated later changes. After each increment, update completed work, test results, remaining queue and the verified production commit.
