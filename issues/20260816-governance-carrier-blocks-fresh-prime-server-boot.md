# Freshly-primed demo backends cannot boot a server: governance carrier demands a target config nothing can mint

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Server, Visibility governance, Dev loop, Testing
**Date:** 2026-08-16
**Governing:** LLP 0234 G0 (`51157f37e`) and the table-visibility composition
wave (`aaf9537e8`, `df1449a46`, LLP 0264)

## Problem

Since the G0/visibility wave, `packages/snapback-codegen` emits a
`visibilityGovernance` activation carrier into `schema.manifest.json` for
EVERY freshly primed backend — including plain `demos/todo/snapback` and
`demos/rbac/snapback` with no widenings (`required: false`). The local
target's cold-start activation (`src/local.rs` ~4975 →
`visibility_governance::validate_activation_from_target`) then demands
`SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG` — a signed
`snapback.visibility-governance-target-config.v1` file — whenever any
carrier is present. **No producer of that file exists anywhere in the
repository** (`grep -rln "visibility-governance-target-config.v1"
packages demos scripts` matches nothing); only the Rust reader and the
push-hook comparator know the schema.

Net effect: any fresh worktree that primes codegen and launches a server
(demo dev loop, `demos/_kit/server-process.mjs` acceptance rungs, harness
runners) fails startup with

```
SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE:
SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG is required for governed
authority activation
```

(server exit 5 before readiness). Sessions with pre-wave gitignored
manifests still boot, which masks the break — it surfaces only on fresh
primes, so the scheduled backstops may lag it.

## Reproduction (2026-08-16, main `9025306da`)

```
volta run --node 24.18.0 node packages/snapback-codegen/index.mjs demos/rbac/snapback
SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback \
  volta run --node 24.18.0 node tests/acceptance/browser-auth-bootstrap-v1.mjs
# → RUNTIME RECOVERY, server exit 5, diagnostic above
```

`demos/todo/snapback` primes with a carrier too (verified), so this is not
membership/visibility-specific.

## Likely fix directions (for the governance-wave owners to decide)

1. Emit NO carrier when the governance closure is empty (no overrides, no
   transitions, no quarantines, `required: false`) — the code comment in
   `validate_activation_with_config` explains why `required: false` cannot
   relax the gate once a carrier exists, so emission is the right lever; or
2. a dev-mode target-config mint (the LLP 0234 "target-owned custody"
   story needs a local-development owner path); or
3. both.

## Interim workaround (in use)

Test harnesses that compose their own `startup-artifacts.json` from the
generated manifests can omit the `visibilityGovernance` member for
ungoverned (`required: false`, empty-closure) backends, recording the
omission in their witness. The Phase-1.4 browser-auth harness does this as
of its refresh-race landing and cites this ticket.
