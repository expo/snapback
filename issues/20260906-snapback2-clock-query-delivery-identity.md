# Snapback2 clock-sensitive queries conflict on legitimate same-sequence delivery

Status: Open
Date: 2026-09-06
Scope: Snapback2 owner query envelope and persistent client delivery identity

An independent actual-native reproduction keeps one `clock.read` SSE
subscription open, advances the development clock by ten seconds without a
data write, and receives two legitimate complete responses at durable sequence1.
Authority, generation, schema and plan stay equal. Returned `data.now`, the
receipt's time-dependent range bound and validator change. A conditional query
using the old validator also returns a new complete response at the same sequence.

Both warm and cold-reopened actual file carriers reject the second frame with
`TypeError: conflicting deliveries for clock.read at seq 1`. Byte-identical
replay passes. The issuing program is trusted before the first delivery; this
is separate from the candidate's pre-program receipt-filtering defect.

The immutable provisional04 native owner has SHA256
`81b1549a8255faa351b90f8908c69ec6a4784409e74cbe08fd39a086ba6eb498`.
The owner certifies explicit IR supplied by the probe's static compiler; this
is actual owner execution and actual envelopes/validators, not a Quarry
lowering claim. Source hashes, native envelope pair, conditional response and
persistent results are retained in
`benchmarks/runs/2026-09-06-clique-improvement/evidence/native-clock-delivery/`.
Complete private scripts and files are under
`/Users/ccheever/clique-improvement/revisions/inbox-restore/native-clock/`.

A bounded execution-clock identity design is under review by the client and
engine owners. Preserve durable same-sequence row/authority equivocation
refusals, identical replay, non-timed query behavior and conditional coverage
admission. Define unavailable-program custody, cold persistence, stale and
backward clocks, validator binding and malformed/missing identity behavior
before changing the wire. Local arrival time is not an authoritative execution
clock, and arbitrary changed same-sequence data must not be accepted.

Keep this open until the coherent engine/client repair is independently
reviewed and verified with the actual native case and disagreement controls.
This does not attribute the original published0.0.8 `chats.list` error, whose
failing envelope pair remains unavailable.
