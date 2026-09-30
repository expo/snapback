# Round 4 context

Scope: LocalReads, local observation resumption, ReadWork queue selection, saved
server/recovery/facade answers, and their affected tests. Snapback 4 fence applies;
Snapback 1–3 inventories/bootstrap gates do not.

Governing documents: LLP 3000 (root/current), LLP 2000.000 §7 (partition authority),
LLP 3000.023 §10 and §3.6 (current: retention, evidence and facade ordering), LLP
3000.018 §3.2 (ordered recovery memory), LLP 3000.019 §3.3 (sharing), LLP 3000.016
§2.2 (routing). The client guide and CLIENT-AND-OPERATIONS.md are the paved form.
The Snapback 4 governing documents are in current, not foundation; the root's
Snapback 1 foundation rules do not cross this fence.

Active constraints: LLP 3000#4 keeps independent workspace and 1,500-line source
cap; LLP 3000.023#10 keeps eight starts/turn, eight active attempts, bounded urgent
overtaking, immediate hard withdrawals, local queue-excluded and online
queue-inclusive bounds; LLP 3000.023#3.6 keeps facade deadlines and approval
fences. LLP 3000.018#3.2 keeps reply ordering and ticket retirement. No new public
Read vocabulary, result cache, deadline, allowance or publication claim.

Rationale: round 3's smallest conservative rule remains binding. Keep its one
detach epoch and the existing evaluation revision. Apply table-scoped memory
invalidation independently of live owners. Only pending notification tables
need new state to scope inherited cuts; entries disappear at publication/reset.
Use the existing duringRead cancellation helper. Split pending work into two
FIFO maps, preserving the existing urgent marker/counter across active/delayed
requeues, rather than copying every key on selection.

Audit: every evidence() call, RememberedAnswers get/set/clear, evaluateLocal
recovery candidate/checkpoints, publishLocal/approveDelivery, observeWatch and
ReadApprovals. Detached raw validation precedes facade-held reads; direct results
awaiting approval retain a revision check. No separate recovery-memory store
exists. Epoch invalidation alone cannot erase remembered server values, which is
why the no-owner path required the owner-independent table invalidation.

Risk: a nonempty/unknown notification conservatively retires every in-flight
evaluation via the existing revision, including a disjoint in-flight read;
completed disjoint memory is preserved. Detached resumes pay one cancellable
metadata read. Online fully occupied capacity still permits authorized sibling
withdrawal at its unchanged bound. These are explicit limits, not latency claims.

Updates: LLP 3000.023, published client reference, round4 report, append-only
journal. Hand-off: none. No subagents, push or publication commissioned or used.
