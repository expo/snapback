# CT round 3 orientation

Read REPORT.md rounds 1 and 2 before editing. Scope: split server maintenance by
protected obligation, preserving round-2 request scheduling, admission, queued
exit refusal, diagnostics, worker exec policy and corrected qualification.

Governing context: LLP 3000 §7 `contended-read-serving` (current root),
LLP 3000.013 §4 (FIFO admission and cooperative 250 µs / 2 ms slices),
LLP 3000.019 §§3.6–3.7 (detached fresh readers and timing meanings),
LLP 3000.026 §§2/4 (Following event/edge custody and asynchronous delivery),
LLP 3000.007 §20.12 (development clock advances extend live leases).
Paved cards read: Following, maintains, jobs, effects. No hard deadline for bulk
delivery is documented; the normal idle-host one-second statement is a product
expectation that the retained replay misses by a large margin.

The operator explicitly authorizes two priority classes and progress protection.
The chosen two-thread implementation retains the engine slicing/FIFO and adds
one shared FIFO maintenance gate/cursor. It keeps development-clock drain
synchronous at request QoS. Ordering is committed delivery slice, recount slice,
then job slice, with urgent work allowed between them. No recount assumes the
whole delivery queue is drained: subsequent committed writes update/restart the
engine's durable recount basis. Atomic row/commit work can overrun a cooperative
slice; scheduler and filesystem delays preclude a hard wall-clock guarantee.
The FIFO coordination gate creates no engine-ownership span; clock timing retains
LLP 3000.019 semantics between actual engine slices.

Doc updates: LLP 3000 §7, historical single-thread wording in LLP 3000.013,
round-3 report and one append-only journal entry. Product backlog issue stays
open; this lane changes scheduling, not delivery throughput algorithms.
Hand-off: none.

Final affected-scope audit: the guide's expiry/lease/development-clock and
Following completeness statements still apply; no public contract was changed.
LLP 3000.013's single-thread performance record is explicitly historical, while
LLP 3000 §7 carries the implemented split and measured costs. The report and
single appended journal entry link those decisions and both open findings.
Final `ref-check --verbose`: 525 LLP documents, 10,072 references, zero errors
and zero unchecked references.
