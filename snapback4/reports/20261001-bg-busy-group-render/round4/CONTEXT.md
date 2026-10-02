# BG round 4 context (llp-orient)

Scope: row-keyed view maintenance, predicate witnesses, device candidate scans,
stored-cache validation, the generated lifetime property and BG/LL measurements.
Read round 3 of REPORT.md first; begin on 587b83d7c8, round-2 control fcc4b644f9.

Governing context: LLP 3000 (current, Snapback 4 fence), LLP 3000.015 §3
(current, maintained row counts), LLP 3000.014 §5 (effective inherited life),
LLP 3000.019 §3.6 (transactional adoption), LLP 3000.020 §3.2–3.3
(covered device counts), rules/RULES.md, snapback4/NOT-DOING.md and the journal
round-3 entry. `guide/maintains.md` is the paved authoring surface. The root
foundation is Snapback 1 context; its gates do not apply inside this fence.

Constraints: preserve authorization before count disclosure, independent pinned
clocks and rollback, the fixed public reservations and finite caller scratch;
private maintenance cannot select a public result or a rule decision. Keep
identity/copied member fields exact; certify both computed fields at one boundary.
Keep device cuts as incomplete observations. No raised meter or wasm cap (605225 B).
No push/publication. Full scripts/test.sh must follow the last source edit.

Risks: stored pending state in witnesses, predicate indexes bypassing a live proof,
partial caches under adoption validation, cursors derived from rejected payloads,
and shared-host latency comparisons confounded by execution order/load.

Updates: existing LLP 3000.015 §3, guide maintains, round-4 report, one append-only
journal entry. No new LLP. Hand-off: none; implement the explicit operator ruling.
The documented fleet file is absent on this host; use this 96-CPU Linux lane and
keep all own builds/tests outside the measurement windows.

Final-suite follow-up: read LLP 3000.020 §3.4 and the maintains guide's current
certificate/accounting description before updating CLI scale certificates. The
new durable private-work key lookup must appear in its structural row bound;
both computed predicates and member-only expiry use the live-count description.
This diagnostic-only correction does not change the measured engine/device code.
