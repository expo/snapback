# Integration 7 round 4 — codex

**Reviewer:** fresh Codex GPT-6.1 Sol
**Effort:** high
**Date:** 2026-10-13
**Reviewed source:** 0ef865b4e9
**Scope:** LLP 3000.036 §15.4 reconciliation; delta 74895a66f0..0ef865b4e9
**Provenance:** fresh codex exec -m gpt-6.1-sol -c model_reasoning_effort=high --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -o review-r4-codex.final - < review-r4-brief.txt. Mutually blind; response verbatim below. Raw transcript sha256 894534c85ea52c4017eea74b1c09fe3d629b69f9556a4241cff121307e6b6836, archived compressed.

---

**NOT READY — bound to `0ef865b4e9`.**

Material findings:

1. **§15.4 attributes this fixture’s lowering to the wrong mechanism.** `filteredEvents` uses an explicit `where exists eventActors[.actorId]` predicate. It is expanded by [intent_lanes.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/src/bind/intent_lanes.rs:24), selected before branch planning in [intent.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-lang/src/bind/intent.rs:405). LLP 3000.036.001 §14 governs capped owner-or-membership **read-rule** merges, which this form does not satisfy. Replace “PAGE can instead lower…” and its pointer with **ordinary intent membership-lane discovery, governed by LLP 3000.013 §2.1**; LLP 3000.027 §2 supplies the discovery completeness/continuation invariant. Correct the PAGE attribution in the Revised entry too.

2. **The fully synced event-slot witness does not establish rejected owned-row traversal.** Its `exists eventSwitch[.actorId]` has the same eligible intent-lane shape. Online-only source discovery happens before target traversal; full target sync does not restore the residual per-row filter. The [fixture assertions](/home/ccheever/projects/snapback-sb4loop/snapback4/packages/snapback4/test/bounded-following.test.mjs:203) establish speculative withholding and the prediction fence, but do not assert owned-row rejection. Remove that current claim or retain it explicitly as an earlier scan-path observation.

The Integration 7 envelope is accurately reconciled: empty data, incomplete, unknown, speculative, `next: null`, and executed dependency `eventActors`, with static dependencies preserving the pending-write fence. The hoisting distinction and historical loading observation can remain after correcting attribution. No wider read-policy change is established.

Minor findings: none.

Read-only review; no builds or execution qualification performed. This verdict is not author acceptance.