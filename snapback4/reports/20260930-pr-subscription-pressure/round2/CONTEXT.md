# Round 2 context

Scope: local/online observation lifecycle and scheduling, local fallback and
composition, server audience dependency metadata, app facade deadlines and their
public contract. Snapback 4 fence; root Snapback 1 gates do not apply.

Governing context: LLP 3000 (root, execution rules), LLP 2000.000 (design brief),
LLP 3000.023 §10 (current answers-stay policy; older sections retain history),
LLP 3000.016 §2.2 (query routing and pending-input publication), LLP 3000.018 §3.2
(ordered recovery memory), LLP 3000.019 §3.3 (observation sharing and fallback).
The client guide card is the current paved authoring surface. Prior PR prompts,
reports and both full round-1 reviews were read before implementation.

Constraints: LLP 3000.023#10 keeps eight starts per turn/eight active, no local
capacity time charged to retention, no renewed consumed time, immediate hard
withdrawals, no diagnostic collection until opt-in. LLP 3000.016#2.2 preserves
one-shot and composed answer publication fences. LLP 3000.018#3.2 keeps ordered
memory and old-body barriers. LLP 3000#4 fences this work from older gates.

Rationale: saved answers cannot turn stale revocation evidence into a new
retention period; authority evidence precedes reuse. Server dependencies must
not reveal hidden rows or executed branches. The conservative static server
plan is safe to transmit because it uses program/caller inputs, not row keys.

Risks: no precise server scope for opaque/dynamic selectors; online change
journals do not contain authenticated per-group history. These exceptions are
explicit in the client reference and LLP. Detached local handles conservatively
withdraw after any missed revision, without an unbounded retained-handle list.

Updates: LLP 3000.023, client card, CLIENT-AND-OPERATIONS, ObserveOptions,
append-only journal and round2 report. Hand-off: none.
