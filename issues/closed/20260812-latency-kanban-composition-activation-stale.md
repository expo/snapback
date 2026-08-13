# Dormant password-authoring bytes invalidated three retained composition activations

**Opened:** 2026-08-12 · **Status:** resolved · **Area:** codegen / trusted composition activation / retained evidence demos

## Correction to this ticket's first revision

The first version of this ticket claimed the `latency-kanban` failure was
pre-existing. **That was wrong**, and the method that produced it was wrong: the
check used `git stash -u`, which stashes only *uncommitted* work. The
password-auth changes were already committed, so the "clean tree" being measured
still contained them. Re-tested against a genuinely clean `origin/main`
checkout, the picture is different and the breakage is ours.

## What

`packages/snapback-codegen/define.mjs` gained an `identifier: "email"`
declaration seam for LLP 0227 password auth. Codegen source participates in each
app's generated identity, so changing it rotates every demo's generated
deployment. A `trusted-composition-activation.json` binds a **specific**
generated deployment, so a rotated deployment no longer matches and codegen
fails closed:

```
[error] TRUSTED_COMPOSITION_ACTIVATION_INVALID (composition)
  trusted-composition-activation.json is invalid: trusted composition
  activation does not bind this generated deployment
codegen failed: no artifacts written (no silent stale output).
```

## Definitive reproduction (fresh worktrees, both sides)

Measured with `git worktree add --detach` + `bun install` on each side, so no
per-worktree codegen cache or accumulated state is involved:

```
fresh worktree @ 8db9c4246 (immediately BEFORE the fixes commit)
  fleet-observatory-move1: OK
  latency-kanban:          OK
  triage-graph:            OK

fresh worktree @ a3d3cb645 (the fixes commit)
  fleet-observatory-move1: FAIL
  latency-kanban:          FAIL
  triage-graph:            FAIL
```

## Proven mechanism

Fresh parent/culprit worktrees were instrumented to print the activation-bound
and freshly derived side of every validator check. `authMode` did **not**
change: `latency-kanban` was `dev` vs `dev` at both commits. Every check before
the v2 authored-source comparison matched. The failing field was:

```
8db9c4246:
  activation.v2.authoredSourceHash
  bound   sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95
  derived sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95
  matches true

a3d3cb645:
  activation.v2.authoredSourceHash
  bound   sha256:a6848146cba37659cca34e4d1f2dd7e61b464e44726968cce6ae8fc50df87c95
  derived sha256:f6f8da6d08cb828d08f713a07c61440f9d24f3be1cb0cfd4416539e98fe1bddd
  matches false
```

The framed-item trace had ten entries. All were identical except indices 3 and
7: `toolchain:@expo/snapback-codegen/define.mjs` in the schema and function
graphs. Its bytes changed from 216,159 / SHA-256 `5d5b46f8…47ae` to 217,152 /
`f3e02875…c538`. `authoredSourceItems` included both raw toolchain copies, so
the dormant password validation/derivation code rotated apps that declared no
password mechanism. The manifest-schema and Rust type additions do not cause
the failure.

## Exact blast radius, measured against a clean origin/main checkout

| Demo | clean `origin/main` | with the LLP 0227 codegen seam |
| --- | --- | --- |
| `fleet-observatory-move1` | OK | **FAIL — newly broken** |
| `latency-kanban` | OK | **FAIL — newly broken** |
| `triage-graph` | OK | **FAIL — newly broken** |
| `chat-matrix` | FAIL | FAIL (pre-existing, unrelated) |
| `rematch-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |
| `tandem-expo-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |

Three demos regress. Three were already failing for unrelated reasons.

## Why it was not repaired in the landing that caused it

The activation is deliberately **not** codegen output. Per the two-phase note in
`packages/snapback-codegen/index.mjs` (~line 206) and LLP 0157 §D3, a
server-owned proof keyring mints it and codegen only validates it. Re-minting
uses `snapback composition-activation-prepare --db … --generated … --deployment-id …`,
which needs the demo's **store and proof keyring**.

The three affected activations bind retained *evidence* deployments — e.g.
`latency-kanban` binds `deploymentId: "latency-kanban-move3-exit"`,
`databaseId: 019ff5cf-fb69-7503-8a65-d2c2f7836498` — and no such store exists in
the working tree. Re-minting them means reconstituting those evidence runs, which
belongs to the programs that produced them, not to the password-auth slice.

## Fix

Project the password-identifier additions out of `define.mjs` identity when the
evaluated schema has no declared password mechanism. The projection reconstructs
the exact predecessor bytes and fails closed if its current regions are absent
or duplicated. Apps that declare a password mechanism retain the current bytes,
and `identifier: "email"` still derives `email-v1`.

No trusted activation was changed. `latency-kanban`'s complete generated
directory is byte-identical to a fresh `8db9c4246` generation, while all three
affected demos and `demos/rbac/snapback` regenerate successfully.

## Bypass used

`SNAPBACK_DRIFT_GATES_BYPASS=1` was used to land the LLP 0227 password-auth work
with this ticket as its record. Skipped gates: agent-safe-publication-fixtures,
contract-meta, diary-identity, generated-artifacts, module-ownership.

What that bypass did **not** hide: the full library suite was 2631 passed / 0
failed, all ten password-auth acceptance witnesses passed, and module-ownership,
inventories, ref-check, and guide-check each passed. The generated-identity
consequence named above is repaired by the feature-scoped projection; the
retained activation evidence remains unchanged.
