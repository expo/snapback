# Two Clique supervisors collided on the 0.0.24 prep directory

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Clique preparation / preflight / launch wrappers on expo-build-1000
**Related:** `benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/README.md`, `benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md`

## Symptom

At 21:36:51 UTC a supervisor launched the 0.0.24 Astra actor in `/home/ccheever/clique-ri-20260911` on ports 53100–53119.

A second supervisor preparing 0.0.25 briefly:

1. Wrote that tree’s `SNAPBACK2_VERSION` to `0.0.25`.
2. Ran a preflight that **refused** occupied 53100 (correct).
3. Truncated the shared `preflight/pre-builder.json` through `tee` (the original preflight is only in the 0.0.24 preparation tar; the live file is empty on purpose as incident evidence).
4. Restored the version file and launched a **separate** tree `/home/ccheever/clique-0025-20260911` on 53200–53219.

Neither actor was stopped. Both runs are disclosed N=1 diagnostics, not a comparative wall-time. The 0.0.24 pin and instrument hashes survived a later read-only check.

The defect is custody: two supervisors sharing a prep directory, a version file, and a tee’d preflight JSON. Port refusal worked; file mutation did not.

## Evidence

- `benchmarks/runs/2026-09-11-clique-astra-snapback2-0024-linux/README.md` § Concurrent-run custody incident (immutable tar SHA-256 `5ce81cb9…`; original pre-builder SHA-256 `9d88cb70…`).
- `benchmarks/runs/2026-09-11-snapback2-0025-clique-linux/README.md` § Concurrent-run discovery.
- Remote: `/home/ccheever/clique-ri-20260911/preflight/`, `/home/ccheever/clique-ri-20260911/SNAPBACK2_VERSION`.

## Requested outcome and acceptance

- Preparation / preflight must not write another run’s version file, prompt, or `pre-builder.json`. Occupied ports → refuse and **leave the tree untouched**.
- `tee` of preflight output must append or write a unique file (`pre-builder-<pid>.json`), not truncate the only receipt.
- Optional: an exclusive lock (`flock`) on the run root while preflight/launch runs.
- Acceptance: a deliberate second preflight against a live actor’s directory exits nonzero and the directory’s `SNAPBACK2_VERSION`, rendered prompt hash, and `pre-builder.json` bytes are unchanged. Keep the 2026-09-11 truncated file as evidence; do not reconstruct it.

## Resolution

Resolved 2026-09-12 in the maintained future-run source under
`benchmarks/tools/social-messenger/linux-runner/`. `prepare.py` now takes an
exclusive run-root lock, rejects occupied assigned ports and existing custody
evidence before changing the version, rendered prompt, or builder receipt, and
keeps that lock across the foreground builder launch. Direct builder and M7
launches take the same lock. Successful builder preflight output is created
exclusively as `preflight/pre-builder-<pid>.json`; the documented invocation no
longer uses `tee` or the shared `pre-builder.json` path.

The targeted regression starts a real local TCP listener, invokes the installed
packet entrypoint as a competing preparation, observes a nonzero occupied-port
refusal, and verifies byte-for-byte preservation of an existing version,
prompt, and intentionally empty `pre-builder.json`. It separately proves a
held run-root lock rejects a concurrent claim without creating run-owned files,
and that a fresh packet renders and creates a unique receipt before refusing a
second claim. The historical 0.0.24 and 0.0.25 run roots remain unchanged.
