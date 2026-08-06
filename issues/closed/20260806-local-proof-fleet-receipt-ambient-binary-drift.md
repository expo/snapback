# Local proof Fleet receipt depends on a mutable ambient debug binary

**Status:** Resolved
**Date:** 2026-08-06
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Local proof, Acceptance evidence, Release qualification, Fleet Observatory
**Related:** LLP 0157 §Move-1 workload exit,
`tests/acceptance/fleet-observatory-move1-v1.mjs`,
`issues/closed/20260803-first-npm-latest-promotion.md`

## Summary

The complete local proof is non-hermetic at
`fleet-observatory-move1-receipt`. Its retained receipt records the SHA-256 of
the debug server binary used by the historical controlled run, but `--check`
reopens that claim by hashing the mutable ignored path
`target/debug/snapback` in the current checkout. A different valid local build
therefore makes a source-clean candidate fail before the proof's own
`native-runtime-bootstrap` producer runs.

This blocked the 0.1.11 ten-package release attempt at clean candidate
`34c61fdc63968f143c59e1afab976dca79380237`. No package was staged or
published by that attempt.

## Reproduction

Under repo-pinned Node 24.18.0:

```sh
volta run --node 24.18.0 -- scripts/verify-local-proof --complete
```

The proof passes capability maturity, agent-safe publication, and the governed
v2 client-bundle-metrology disposition, then fails:

```text
GATE fleet-observatory-move1-receipt
AssertionError: retained receipt must remain bound to the exact server binary
actual receipt digest: c96d9f9b3095963759433d79e00e370ecc489ba060b955505ad60ce3f1fa64c7
ambient target/debug digest: 1e67934b5676b8eef203c0e636fab36dce8fb89c8a503a5c308a06164361509f
```

The ambient binary identifies itself as a clean contributor-source debug build
of `430c48669ff7a716e6296f1ae6cb3b5db1575968`. Rebuilding it at the 0.1.11
candidate would correctly change its embedded build identity again; it cannot
honestly reproduce the historical receipt digest.

## Cause

`verifyRetainedArtifacts()` compares
`receipt.controlledRun.runtime.serverBinarySha256` with a fresh hash of
`SERVER_BINARY`, whose default is the ignored mutable
`target/debug/snapback`. The retained receipt does not retain or fetch the
historical binary it names, and the gate has no producer dependency before it
in `scripts/verify-local-proof`.

The source-file digest checks are hermetic because the checked bytes are
tracked. The binary check is not: a clean checkout may have no file, a stale
file, or a newer valid build at the same path.

## Release consequence

This is a central local-proof gate, so it must not be fast-pathed. Publication
must remain blocked until a landed repair makes the complete proof green on a
fresh candidate SHA.

## Acceptance

- Retained Move-1 evidence has a durable, reopenable binary identity edge; it
  does not depend on whichever ignored binary happens to occupy
  `target/debug/snapback`.
- The check remains fail-closed against binary-identity or receipt tampering;
  deleting the ambient target directory does not weaken or break verification.
- The gate declares any required producer dependency explicitly in the local
  proof inventory.
- A clean checkout, a checkout with an unrelated historical debug build, and a
  checkout after rebuilding the current candidate all produce the same
  retained-receipt verdict.
- `volta run --node 24.18.0 -- scripts/verify-local-proof --complete` is green
  on the successor release candidate before staging or npm mutation.

## Resolution

Resolved 2026-08-06. The format-only `serverBinarySha256` assertion proposed
in the first repair draft was insufficient: it removed the ambient dependency
but did not preserve the landing's source-and-binary-bound evidence contract.
The Fleet witness now copies the exact `snapback.runtime-readiness.v1` receipt
verified by the controlled server rung into the dated tracked fixture set. The
Move-1 receipt records that sidecar's SHA-256, and `--check` verifies the
sidecar digest, runtime-qualification verdict, build identity, native-artifact
digest records, and equality between its binary SHA-256 and the workload
receipt's `serverBinarySha256`. It never opens `target/debug/snapback` or the
path named by `SNAPBACK_RUNTIME_BINARY`.

The retained check also pins the exact source-manifest paths and exact rendered
evidence prose, preventing a receipt edit from silently dropping a source edge
or leaving the human and machine evidence inconsistent. No local-proof
producer dependency is required: all bytes consumed by `--check` are tracked
retained evidence or tracked source.

The current-revision runtime (`05d252922d51a8c63095450dd00d04cfafdc240b`)
was rebuilt and handler-VM-qualified through `scripts/bootstrap-ibex-runtime`.
The controlled Fleet run then retained 8/8 PASS and 0 BLOCKED, including the
fixed harness source digest. Both the ordinary qualified check and the same
check with `SNAPBACK_RUNTIME_BINARY` pointed at an intentionally absent path
passed. `./ref-check --verbose` passed with 0 errors and 0 unchecked refs.
