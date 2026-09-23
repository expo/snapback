# Snapback 4: READAUTH edge cases — meter exhaustion after unknown coverage, and order-dependent aggregate witnesses

**Status:** Open
**Date:** 2026-09-23
**Owner:** the Snapback 4 0.3 program lead
**Scope:** device read authorization of provisional rows (READAUTH; `engine/local.rs`, `engine/read.rs`), landed after three review rounds.
**Source:** Astra xhigh's final delta review of READAUTH (`7b7fe2caaf`). It found no disclosure or format regression: raw witnesses match server semantics. The review loop reached its three-round limit, so these two Mediums are fix-forward work. Both make a device refuse or hide more than it should; neither leaks.

## 1. Meter exhaustion after unknown coverage rejects a write instead of queueing it (`engine/local.rs`, around line 92)

A `Bound` error returns early even when an unknown fact came first. The
unknown read can select a branch the server would never execute, and
exhausting that branch's meter says nothing about whether the mutation
should fail.

Astra's WASM reproduction:

- A note was delivered, then its scope was revoked, so its group was
  `Left`.
- A mutation inserted a provisional check authorized by that note, read it,
  and ran 8,192 point reads only when the check appeared absent.
- Without the expensive branch, the mutation queued (correct).
- With the expensive branch, admission returned `E_BOUND` and nothing was
  queued.
- With the witness held, the mutation predicted.

**Fix:** when a genuine unknown fact precedes the exhaustion, preserve
queueing (or stop prediction as soon as that fact becomes necessary). Keep
ordinary meter refusals when coverage was known. Add this
counterfactual-branch case beside the ladder test.

## 2. Aggregate witness authorization depends on source-row order (`engine/read.rs`, around line 148)

A retained source sets `known = false`. A later covered provisional source
sets `live = true` but leaves `known` false. Under the raw-witness rule, a
covered positive witness is sufficient for existence.

Astra's reproduction, with an expiring source, a retained count grouped by
`(groupId, owner)`, and a provisional check governed by
`exists counts[.groupId, viewer]`:

- retained source `a` with pending source `z`: the check is unknown;
- retained source `z` with pending source `a`: the check is readable and
  complete.

**Fix:** combine source existence witnesses existentially, so that a covered
positive witness supersedes uncertainty from other candidates. Test both
orders.
