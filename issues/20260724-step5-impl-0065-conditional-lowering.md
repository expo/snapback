# 0065: lower generated update/delete to the server-evaluated conditional plan

**Status:** Done (2026-07-24)
**Severity:** P2
**Systems:** Codegen, Storage, Generated operations
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §2, LLP 0051 (conditional mutation model), LLP 0007 §Transactions (carve-out)
**Marker:** step5-impl

Generated update/delete become a server-evaluated conditional plan — read,
owner guard, then write, sharing one authoritative transaction and commit
validation — replacing the Option A client-supplied-baseline path for
generated operations only (the 0007 carve-out is already landed in prose).
Race tests: concurrent owner transfer (via a handwritten transferring
function) and concurrent delete against the guard in both commit orders,
no lost or misattributed write. M-sized.

**Resolution (2026-07-24):** the lowering already existed structurally —
HostPlan mutation steps (Get → Guard → Patch/Delete) execute server-side
inside one guarded storage transaction at commit
(`execute_mutation_guarded`), with the earlier dry run serving only the
ctx-answer ledger (ids/now), never as the deciding read. Landed the missing
witness: `conditional_owner_guard_reads_commit_state_not_preview_state` in
src/storage.rs proves a concurrent handwritten owner transfer landing
between preview and commit is seen by the commit-time guard and refused with
the collapsed SNAPBACK_ROW_NOT_FOUND (transfer preserved, no partial write),
and the opposite commit order loses nothing. The LLP 0004/0007 carve-out
pointers landed with the acceptance amendments.
