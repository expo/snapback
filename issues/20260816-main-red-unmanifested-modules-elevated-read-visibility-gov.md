# main red: two Rust modules exist but are missing from the ownership manifest

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Ownership gate, Tests
**Date:** 2026-08-16
**Found while:** landing LLP 0189 piece 3; the drift_prone_gates_v0 suite's
ownership-gate fixtures fail on the ambient strays.

## Problem

`src/elevated_read_trace.rs` and `src/visibility_governance.rs` exist as
tracked files on `origin/main` but are absent from `ownership.manifest.json`,
so `node scripts/check-module-ownership.mjs` refuses with
`SNAPBACK_MODULE_OWNERSHIP_VIOLATION: manifest is missing Rust modules:
src/elevated_read_trace.rs, src/visibility_governance.rs`. This turns five
`tests/drift_prone_gates_v0.mjs` cases red (they invoke the real ownership
gate as a fixture precondition): missing-declared-deps, agent-safe checker,
diary-identity backstop, boolean-inherited-red attribution, and the
optimistic/strict/backstop push test. Verified pre-existing on origin/main;
not introduced by the LLP 0189 landing (which touches only proof/ci scripts).
`elevated_read_trace.rs` was already noted as an out-of-scope stray by the
ownership-gate minors landing.

## Why not fixed here

Assigning the correct owner module for each requires the landing author's
knowledge of the coupling (a guessed owner freezes a wrong edge). This is
fix-forward for whoever owns those modules: add both to
`ownership.manifest.json` with the correct owner, then re-run
`node scripts/check-module-ownership.mjs --update-baseline --predecessor HEAD`
and confirm the drift suite returns to green.

## Acceptance

- Both modules assigned in `ownership.manifest.json`.
- `node scripts/check-module-ownership.mjs` PASSES.
- `tests/drift_prone_gates_v0.mjs` returns to 47/47.
