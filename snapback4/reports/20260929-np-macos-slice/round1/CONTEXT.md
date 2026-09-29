# Round 1 orientation

Scope: native witness preparation/receipts, Expo smoke helper, witness card,
LLP 3000.030 §11. No engine, client contract or client semantics changes.

Governing LLPs: LLP 3000#4 (Snapback 4 fence); LLP 2000.000#12 (bounded
measured loop); LLP 3000.030#3, #4, #5, #6, #8 and #11 (own-app identity,
repack qualification, leases, immutable evidence and acceptance);
LLP 3000.011.005.000#2 (generic smoke limits); LLP 3000.007#20.10
(app-owned assertions and witness lifecycle); LLP 3000.019#3.4
(exclusive backend-store ownership). 3000.030 is the in-flight proposal;
this lane's explicit supervisor ruling governs its smoke residency update.

Constraints: preserve real cal25 native closure, published client/native
engine, app/session/partition and segment ordering; derive query residency
from the compiler; keep prepared proof kinds and legacy artifacts distinct;
no publication, push, system settings or credentials. Use owned UDIDs and
recorded child PIDs only. Keep local helper changes separately identified.

Rationale: compiler server-only reads have no offline partition answer;
loading must never grant that classification. The complete A/B experiment,
not an exit-zero repack, decides availability. Online-only fallback still
fails the native acquisition/opening boundary.

Open risks at entry: full restart not yet exercised; default repack changes
metadata; export/compiler settings differ; asset-prefix allowance needs exact
export-resource comparison. M6/M8, physical devices, general SDK support and
publication remain separate increments.

Likely document updates: smoke §2, native RFC Revised/§12 and disposition,
witness card, package READMEs, issue resolution/follow-up, append-only journal.
Hand-off: none; this round is explicitly authorized to implement and qualify.
