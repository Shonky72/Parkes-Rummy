# Gamification progress

## Current checkpoint: 20 October 2026 (Sydney)

- Approved scope: complete Releases 1, 2 and 3 from the supplied handover.
- Working branch: `feature/rule-records-achievements`.
- Verified source baseline: `cd878fa33419a10e2d5aff6c4cf2566428b0558a` on main.
- Recovered feature head: `6f48fb5` (three transport/recovery commits only; no gamification implementation).
- Production checked: Netlify deployment `6ad5f475c1d499086c862898`, context production, published and ready, commit `cd878fa33419a10e2d5aff6c4cf2566428b0558a`.
- No new gamification release is live at this checkpoint.

## Preservation requirements

Keep existing gameplay, all 40 authoritative rules, purchases, Google identity, owner-dashboard permissions, mobile gestures, stationary desktop tabs, voice lifecycle, approved-guest start and winning-card reveal. Add separate profile/competition pages and a compact results highlight after the reveal. New telemetry stays private and authoritative.

## Work queue

1. Release 1: engine evidence, denominators and achievements; atomic durable storage; profile, accepted friends, explicit revocable sharing and PNG download; integration/security/browser tests.
2. Release 2: frozen deterministic AI challenges, daily first attempts, best-five weeks, private clubs/goals, three-deal duels and explicit rematch invitations.
3. Release 3: evidence timeline, comparable consistency boards and a separate opt-in human ladder with provisional ratings and farming controls.
4. Full established regression suite, production build, screenshots, performance checks, exact deployment verification for each shipped increment.

## Decisions

- Recover normal source from the fresh repository. The incomplete compressed transport is never applied or executed.
- Save ordinary source commits frequently; remove temporary recovery workflows and the transport fragment from the feature branch before release.
- New records start from validated collection; historical readiness is not inferred.
- Preview/test collection must use isolated storage or remain disabled. No production player fixtures.
- Existing same-deal engine/AI behaviour is frozen by version. Sydney calendar governs daily and weekly competition.
- Failed deployment leaves current production intact. Any bad published change is fixed forward via a source revert and normal CI.

## Validation

- Locked dependencies installed with `npm ci` on Node 24.
- Baseline typecheck and focused existing backend/engine/reveal tests running.
- Release acceptance is tracked against the complete handover; implementation and production status are separate.

## Resume

Read this checkpoint and the latest Git log first. Inspect the working tree, test output and remote branch before changing source. Never overwrite unrelated later changes. After each increment, update completed work, test results, remaining queue and the verified production commit.
