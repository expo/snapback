# Landing B is complete but cannot land before Landing A

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Systems:** Auth, Engine, Testing
**Date:** 2026-08-26
**Related:** LLP 0283 F-1, LLP 0313,
`issues/20260826-root-identity-mechanism-survey.md`

## State

Landing B's scoped surface removal is finished at lane commit `603f19d91`
(30 commits, clean worktree, nothing pushed). Of the 14 exact standalone
`#[cfg(feature = "test-support")]` sites in the starting tree, three had their
feature-public surface removed and eleven are kept with per-site justification:

- engine `require_host_plan_for_test_support` — both public live-subscription
  wrappers removed; the check is now `pub(crate)` and no longer feature-public.
- sync `PreparedBearerAuthority::authority` — feature-public accessor removed,
  crate-private implementation retained.
- sync `PreparedBearerAuthority::into_parts` — same.

`remainder-tests` has zero active Cargo/Rust/TOML matches, and workspace-wide
searches found no public `rusqlite` re-export or raw connection accessor.

## Why it cannot land yet

One engine test fails, deliberately:

```
local::engine::tests::engine::same_mode_sessions_activation_projects_live_successor_before_reopening
```

Supervisor-reproduced in the lane at `603f19d91`:

```
SNAPBACK_AUTH_MODE_PENDING
message: app-data admission is closed for an auth-mode transition
reason: authorization_refresh_failed
test result: FAILED. 0 passed; 1 failed; 603 filtered out
```

The obsolete fixture bypassed this transition. Making the assertion pass
requires transition-owned private authority re-resolution — that is Landing A
functionality and is absent from `main`. The lane left the assertion and the
fail-closed transition intact rather than reintroduce a backdoor or weaken
authorization, which is the correct call: the alternative would have been a
caller-authored bypass of exactly the kind LLP 0303 exists to eliminate.

Repo policy is to address known failing affected product tests before landing,
so B waits for A. This is an ordering constraint, not a defect in B.

## Verification already performed in the lane

Bootstrap receipt bound to `603f19d91`, `gitDirty:false`,
`SNAPBACK_IBEX_RUNTIME_LINK_OK`, handler-VM qualification ok.
`cargo check --workspace --all-targets` exit 0. `snapback-sync` 256/256,
`snapback-services` 254/254, `snapback-kernel` 870 passed / 7 ignored, auth
invalidation acceptance 12 scenarios with matching receipt, twelve targeted
affected server tests individually passed, `cargo fmt` clean, `ref-check`
6841 refs / 0 errors, `check-generated-artifacts` passed, `check-inventories`
PASS.

An early full server run was stopped at exit 130 after nine minutes inside a
pre-existing saturated-pool test; the affected server tests were then run
individually. That run is recorded as not-completed rather than counted as
evidence.

## Next step

Land Landing A, then re-run this test in the B lane and land B if it passes.
If it still fails after A lands, that is a new finding and needs its own
triage rather than a fixture change.

## Custody (2026-08-27)

The lane was not on the control plane, the M1 Max build lane, bones, Durand,
Minisforum, the Office M1, the Apartment Air, or the EPYC. It is on the Hetzner
host `expo-build-450b` (`100.85.211.16`) at `~/lanes/landingB`, whose `origin`
points at the EPYC checkout rather than GitHub — which is why "nothing pushed"
had left thirty commits reachable from exactly one disk.

They are now on GitHub at `lane/landingB-20260827` (`603f19d91`, thirty commits
over merge-base `13df62466`). The lane worktree is unchanged and still clean.

Securing an unpushed lane to a branch is not landing it and makes no claim about
its content; the ordering constraint above is unaffected. It exists so the work
survives the host.
