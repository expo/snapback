# First trustworthy complete battery: 45 failures triaged, 4 genuinely new

**Status:** Open
**Filed:** 2026-08-21
**Run:** `scripts/verify-local-proof --complete`, `SNAPBACK_PROOF_KEEP_GOING=1`,
at `f99b92cee`, pinned toolchain (node 24.18.0, bun 1.3.12)

## Result

**PASS 116 · FAIL 45 · BLOCKED 8 · NOT_SELECTED 1 · 161 gates · 0 timeouts**

This is the first complete run that could finish. Two defects previously made
it impossible, both fixed today:

- `rust-tests` ran `cargo test --workspace` with no `--no-fail-fast`, so cargo
  stopped at the first failing target and executed FIVE test binaries while the
  battery reported one failing gate. The prior "48 failures" figure was
  measured that way.
- A capability-link deadlock hung the `snapback-server` suite forever.

`0 timeouts` is itself a result: no gate hung.

## Triage of the 45

| Bucket | Count |
|---|---|
| A — documented expected-red until F-1 | 2 |
| B — already ticketed | 35 |
| C — environment/infrastructure | 4 |
| **D — genuinely new** | **4** |

**The headline is that the battery found four newly uncovered root-gate
failures, not 45 new regressions.** Three more (`workspace-graph`,
`workspace-graph-fixtures`, `guide`) already failed in this run and have since
been fixed on main, so they are not live.

## The four new ones

1. **`rust-tests` — 179 failed tests across 32 targets.** This is the
   previously invisible mass. The pre-existing ticket covered five
   `action_watchdog_v0` failures; that target is now 11/11 green, so the old
   ticket does not describe this. Needs its own decomposition by target before
   anything else here is prioritised.
2. **`versioned-seed-conformance`** — revision matched but all 20 mandatory
   cases failed, and quiet mode emitted no causal diagnostic. No ticket covers
   this signature. The missing diagnostic is itself a defect: a gate that fails
   20/20 silently is hard to action.
3. **`app-cli-served-journey`** — fails on `SNAPBACK_OUTBOX_NOT_WRITER`, a
   client-side outbox-leadership code in `packages/snapback-client`. The
   existing ticket for this gate describes an older visibility-policy
   signature, not this one.
4. **`snapback-client-package`** — a new automatic-restart test stalls in
   `drainPhase:"backoff"` with `barrier-transient:SNAPBACK_CLIENT_REFUSED`. The
   existing ticket names a different `app-data.test.mjs` writer failure.

## Blocked gates

Eight, none blocked by an expected-red gate. Seven trace to missing generated
artifacts (bucket C) or a bucket-B failure. One — `auth-invalidation-report` —
is blocked by `rust-tests`, so it is gated on a genuinely new failure.

## Cheap batch, with a caution

A sizeable group are stale generated artifacts or path drift rather than
product defects: stale `control-plane-registry.json`, a missing
`handler-typescript-profile.schema.json` at its asserted owner path, two tests
reading a nonexistent `schemas/remediation-kinds.v1.schema.json`, and a stale
server diagnostic exclusion.

**Do not blanket-regenerate.** Both `local.rs` publication carriers, sequence
publication, the Fleet receipt, the local-store carrier receipt, agent-safe
publication custody, and bundle metrology are evidence and custody records, not
disposable snapshots — `issues/20260820-f3-bucket-b-pre-existing-reds.md`
treats them that way explicitly. Those must be audited before reminting.

## Method note

Measure this suite unsandboxed. Agent sandboxes deny `127.0.0.1` binds and
inflate `snapback-server` from 6 failures to ~134, which buries the real
signal. This has misled analysis repeatedly.
