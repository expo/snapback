# BG round 3 context

Scope: row-keyed count scalar/witness reads, grouped delivery, partition stream
and acquisition, device reads/prediction, and their lifetime property proof.
Round-2 report read first; base fcc4b644f9. No push/publication authorized.

Governing documents: LLP 3000 (fenced root, current), LLP 3000.015 §3
(maintained member-keyed counts, current), LLP 3000.014 §5 and §7
(effective inherited lifetime and adoption), LLP 3000.019 §3.6 (reader-owned
transactions, current), LLP 3000.020 §3.2–3.3 (device coverage, current).
The repository's foundation overlay has no Snapback-4 root; the fence routes
here rather than to the Snapback-1 foundation. Guide facts: `guide/maintains.md`
and `guide/rules.md` in the compiler, including inherited expiry and captures.

Constraints: LLP 3000.015#3 requires fresh authorized live counts when member
maintenance can have skipped contributions, fixed public work reservation,
finite caller heap admission, and atomic adoption/recount. LLP 3000.014#5-what-derives-from-the-capture
makes inherited expiry part of that same lifetime. LLP 3000.019#3.6 forbids
cross-transaction reader caches. LLP 3000.020#3.2 requires covered device input;
§3.3 keeps uncertainty pending. LLP 3000#7-decisions-during-execution and the
Snapback-4 fence preserve the wasm ratchet, real interpreter and one owner.

Rationale/risk: round 2 guarded certificate reuse but non-expiring-source
scalar and batch dispatch never reached the guard. The same source-only gate
also appears at transport batching and device prediction. Two matching dispatch
answers cannot serve as an independent acquisition oracle. The member and
source declaration must jointly select the live path. The non-expiring member
busy-group path must remain incremental.

Doc updates: existing LLP 3000.015 §3 dispatch audit, current guide wording,
round-3 report, append-only journal entry. No new design document is needed.
Hand-off: none; implement and verify under the explicit round-3 commission.
