# Pairing-code fence: two evidence gaps landed knowingly

Status: Open — evidence only; no production defect
Created: 2026-08-23
Related: LLP 0297, `issues/20260823-remeasurement-after-detached-action-fence.md`

## Why these landed open

Author ruling 2026-08-23: **land with gaps ticketed** rather than open a fourth fix round. The
pairing-code mint fence went three rounds. Round one found a genuine production hazard (the caller
permit and Local mutex held across an unbounded `spawn_blocking` queue with no deadline recheck),
which is fixed and confirmed sound by both reviewers. Rounds two and three found only **evidence**
problems, and both reviewers agreed on every substantive point: no new `AdmissionEffectGuard` wrap,
no runtime HTTP status change, no sibling instrumented execution path, and the 567 corrected
diagnostic statuses verified against six reviewed families with 72 source-sampled across all 13
roots.

The reviewers differed only on whether the two residuals below should block. One said block; the
other called them explicitly non-blocking. Recorded here rather than resolved by a fourth round.

## Gap 1 — the diagnostics checker still passes falsely, on a different shape

The trailing-comma fix corrected 567 null statuses, but the regex handles **named families** and
not **inline slices**. Two reviewed mappings therefore remain `httpStatus: null`:

- `SNAPBACK_EFFECT_APPROVAL_PENDING` → should be 202
- `SNAPBACK_API_ASK_RESULT_SCHEMA_MISMATCH` → should be 422

Independent extraction found **1,638 reviewed rows against 1,636 generated**, while
`generate-diagnostics-registry --check` still exits 0.

**The consequence worth recording: the remaining 1,949 nulls are not all legitimate.** Anyone
treating that number as "correctly unclassified" will be wrong by at least two, and by an unknown
amount until the inline-slice shape is handled.

`httpStatus` is derived but *published* — served Guide lookup and CLI reference formatting consume
it — so this affects documentation and reference output, not HTTP response behaviour.

## Gap 2 — the atomicity probe installs after a mutable prefix

The probe is installed after the authority check (`engine.rs:5776`). Inserting one production line
immediately before installation:

```rust
self.db.mint_pairing_code(user_id, now_ms, random)?;
```

creates an extra **unguarded** clock/row commit. The probe then observes only the original guarded
transaction, yielding the expected `Staged(1,1)` plus one `Commit`, so the "sole real commit"
assertion stays green.

Fix shape: install the probe **before any mutable production prefix**. The other reviewer noted
this bypasses the same observe hook every durable-commit test uses, so it is not a hole this change
introduced — but it is a hole.

## Gap 3 — saturation evidence limit (already documented in code, recorded here for tracking)

The saturation test does not observe that the pairing worker actually queued. Replacing
`with_snapback_until`'s `spawn_blocking` admission with a deadline sleep would leave the test green.
Both reviewers confirmed the in-code comment states this limit accurately and does not overstate it
elsewhere.

## What is NOT in question

Production behaviour was confirmed sound twice. The fence reserves before Local, replaces rather
than wraps the guard, commits clock and row in one guarded transaction, releases the permit at the
transaction boundary, and carries the absolute deadline into blocking-worker admission with RAII
release of unclaimed ownership.
