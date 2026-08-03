# `branches::promote` applies overlay post-images — deviation from Accepted LLP 0097 §5

**Opened:** 2026-08-03
**Source:** LLP 0162 super-refine loop (both review families, rounds 1–2)
**Systems:** Storage, Runtime

## Problem

LLP 0097 §5 (Accepted) forbids driving branch promotion from row post-images:
`_snapback_changes` is a changeset of committed post-images, not an invocation
log, "so it cannot on its own drive a safe promotion." The landed-but-unwired
substrate deviates from this:

- `BranchOp` retains only `Write(u64, OverlayWrite)` post-images plus
  `CapturedEffect` entries — no function, canonical arguments, principal, or
  ctx answers (`src/branches.rs:778-803`), so the log is not
  replay-sufficient.
- `promote` applies those post-images directly via `apply_write`
  (`src/branches.rs:897-1017`), and partitions writes by "ordered at/after the
  first captured effect" — a version-ordering over-approximation of effect
  dependence, not the transitive causal enforcement 0097 §5 requires.

Nothing wires this path today (no consumer outside the module), so there is no
live product exposure — but any future wiring of `branches::promote` as-is
would ship the exact mechanism 0097 rejected.

## Fix shape (per LLP 0097 §5 / LLP 0162 §5)

1. Replace the operation log with a replay-sufficient record (canonical
   arguments, declared ctx answers, captured/simulated effect outcomes in
   causal order).
2. Replace or disable `branches::promote`'s post-image application with staged
   re-execution; strict CAS on the recorded base.
3. Add the negative conformance fixture: no product path can invoke
   post-image promotion (LLP 0162 Acceptance 10 keeps this fixture once that
   RFC's corpus exists, but the guard belongs to 0097's implementation lane
   regardless of 0162's fate).

## Notes

This ticket exists so the correction is not hostage to LLP 0162's acceptance;
it is a deviation from an already-Accepted RFC. Coordinate with LLP 0158 F0a
(which deliberately excludes promotion) and LLP 0097's mediation prerequisite
before wiring anything.
