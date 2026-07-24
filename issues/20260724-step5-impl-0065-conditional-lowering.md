# 0065: lower generated update/delete to the server-evaluated conditional plan

**Status:** Open
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
