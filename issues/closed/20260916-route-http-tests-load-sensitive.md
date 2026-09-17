# Two `serve::tests::route_tests` HTTP tests fail under full-suite load and pass on every re-run

**Status:** resolved
**Filed:** 2026-09-16, from the wave-11 (0.2.27) integration runs
**Resolved:** 2026-09-16, integrated identity/C3.2 landing
**Owner:** the session that landed the `routes` feature — not wave 11, which touches none of these files

## What happened

Two different tests in `crates/snapback4/tests/serve_routes/mod.rs` have each failed
**exactly once**, in a full `scripts/test.sh` run on a loaded machine, and passed on
every subsequent run including the identical configuration:

| test | failed at | re-runs |
|---|---|---|
| `route_development_exception_does_not_expose_core_doors_or_personas` (`mod.rs:180`) | 0.2.26 integration, concurrent with three cargo builds | passed isolated, and in every later full suite |
| `registry_claim_retains_long_action_and_maximum_route_names_over_http` (`mod.rs:254`) | 0.2.27 integration | 3/3 isolated, 2/2 whole `route_` selection, 1/1 full `--bin snapback4` suite (61/61) |

The second failure was `assert_eq!(status(…"/long-name"…), 503)` — a real HTTP
exchange against a bound port, with a worker claim and `wait=0` timing.

## Why this is filed rather than fixed here

Wave 11 modifies **none** of the routes implementation or its tests — verified:
`git diff origin/main..HEAD -- crates/snapback4/src/serve_routes.rs
crates/snapback4/tests/serve_routes/ crates/snapback4-core/src/engine/routes.rs`
is empty. These tests bind real ports and depend on request timing, so they are
plausibly load-sensitive rather than wrong.

**But "it passed on re-run" is not a diagnosis, and this repository has already
been burned by that inference.** In wave 9 a web test was dismissed as load flake
three times and turned out to be a real race — orphan adoption skipping a
just-closed tab still holding its lock — which took two blind review rounds to
find in wave 11. Two different tests in one file failing once each is the shape
that deserves a look at the code, not another re-run.

## Suggested next step

Read the two failing paths for a genuine race rather than trying to reproduce
under load. Specifically: whether a `503` can be observed before the route
registry has settled the claim, and whether the development-exception path can
admit before the bearer's session is visible. If both are genuinely timing-only,
consider making the assertions wait on a condition rather than a single
observation, so a slow machine cannot produce a false red.

## Resolution

Both fixtures now witness admission and settlement instead of treating a
timeout response as evidence that admission happened. The source has a real
distinction: `serve_routes::ingress` starts its deadline before reading the
body, then may return `503 E_ROUTE_PENDING` before creating a work record.
A short elapsed wait therefore does not establish the durable state the old
fixtures subsequently assumed. This is a source diagnosis; the historical
failed HTTP bytes were not retained, so it is not a claim to have reproduced
every original failure or ruled out all other causes under arbitrary load.

- `83bd333b9` (source `f81678086`) sends the maximum-name route concurrently,
  waits for the two durable records, checks the exact claimed operation names,
  settles the route and observes HTTP 204.
- `cc0e3e0bb` (source `4dd0462e4`) keeps every foreign-origin/core/persona
  denial assertion, then sends the bearer request concurrently, waits for one
  admitted record, claims and settles it, and observes HTTP 204. The report
  route has a bounded two-second wait; main's billing wait remains 250 ms.

No production route behavior or authorization rule changed. The integrated
route HTTP group passes 12/12 on `3a95cfcd3`; the core route target passes
14/14 on the same authority sources. Both independent integrated source
reviews accept the synchronized witness. [Commands, scope and reviews](../../snapback4/reports/20260916-identity-c32.md)
retain the evidence. This is not a guarantee against exhausted resources or
arbitrary scheduling stalls, and it does not replace serial heavy-suite policy.
