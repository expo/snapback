# CT round 4 orientation

Scope: server maintenance ordering/priority/pacing, row-view recount slicing,
native invocation bounds, Linux scheduling diagnostics, and the round-3
measurement methods. Read the report's round-3 section first, the Snapback 4
fence, NOT-DOING and journal; no Snapback 1–3 gates apply.

Governing context: LLP 3000 (current root) §7 `contended-read-serving`;
LLP 3000.013 (current) §4 and §5.2 (FIFO, durable delivery and job cursors);
LLP 3000.005 §4–6 (native invocation ABI and metering);
LLP 3000.019 §3.6–3.7 (detached readers, engine timing);
LLP 3000.020 §3 (row-keyed count custody and live basis);
LLP 3000.007 §20.12 (clock advancement and live leases);
LLP 2000.000 §6 (deterministic meter, cooperative job boundaries).
Paved cards: maintains, jobs, native, feeds and effects. The foundation overlay
is the Snapback 1 kernel; the Snapback 4 fence supplies the governing root.

The operator supersedes round 3's demotion: any thread taking the maintenance
gate/engine/writer stays ordinary. Bulk pacing must release all shared locks;
ordinary slices must reach engine admission independently of bulk scheduling.
Delivery must commit before the next recount; synchronous clock drain still
extends leases atomically and drains in its existing order. The review finding
is not permission to alter durability, ceilings, read custody or answer semantics.

Risks: no work can execute concurrently through an exclusively held engine;
a stalled engine owner still delays all writers. Regression must distinguish
engine-free admission from actual ownership. Native ABI has no intermediate
commit/yield: its deterministic fuel/meter limit is an explicit exception to
the cooperative duration, not a claimed 250 µs preemption. Host load is a hint
with lag and shared tenants. No hard OS scheduling guarantee is possible.

Update LLP 3000 §7, replace LLP 3000.013's now-stale host policy pointer, add
round-4 report/evidence, append exactly one journal entry. Hand-off: none.

## Affected-scope corpus audit

LLP 3000 §7 is the current host policy; its previous utility/nice-5 bulk rule is
superseded by the operator, with historical measurements retained as historical.
LLP 3000.013 §4's pointer now distinguishes the paced host from its old
single-thread throughput record. Its durable delivery/order rule remains valid.
LLP 3000.020's recount basis, cursor, delta and expiry semantics are unchanged;
only the cooperative stopping point is earlier. LLP 3000.005's native ABI/fuel
and LLP 2000.000's job meter remain the governing atomic resource bounds, with
no new promise that deterministic resource counts bound wall time. The native
guide card and its reviewed definition pin now make that exception explicit.
LLP 3000.007 §20.12 still requires atomic lease extension and synchronous clock
drain; the dedicated advance mutex and unwind guard preserve that contract.
LLP 3000.019's detached-reader custody and engine timing remain unchanged; the
maintenance gate remains coordination-only. No proposal status, corpus overlay,
resource ceiling or capability claim needs promotion. No hand-off is created.

Pacing measurement correction: the rejected wall-time candidate charged OS
descheduling and a minimum pause to cheap turns. The final source charges
thread CPU and removes that minimum; chunk deadlines retain wall time. The
rejected candidate is retained, excluded from final ranks, and separately
qualified. This changes no ordering, admission or durability contract.
