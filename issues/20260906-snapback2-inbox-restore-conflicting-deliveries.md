# Snapback2 restored inbox reports conflicting deliveries at the same sequence

Status: Open
Date: 2026-09-06
Scope: Snapback2 persistent client, delivery and query restoration

The fresh Astra medium Clique build on published `snapback2@0.0.8` reports
`TypeError: conflicting deliveries for chats.list at seq 3264` after a full-page
reload. The server follow state was correct, but the UI could not complete its
follow flow. Gating the profile on a matching response did not resolve it.
The builder first narrowed the inbox projection, then reported a workaround
using a separate authenticated live query and per-account inbox metadata cache;
message history, media and the durable outbox remain on the persistent client.

This is a builder observation with the exact diagnostic independently extracted
from its retained browser evidence, not yet an independent SDK reproduction or
a proven root cause. The app remains under active construction; the observed
`chats.q` hash is a later source observation, not necessarily the failing bytes.
Do not infer that removing asset fields establishes the cause or a product fix.

M5 source evidence lives under
`/Users/ccheever/clique-full-008-20260906/lanes/astra-snapback2/`:

- `run-log.md`, entry `1788700062`.
- `evidence/m8-follow-diagnostic2.txt`, SHA256
  `06d76632f4a2cf13473d75332c0c9a1a4d587e53e4aadcb32ba2a467b470323f`.
- Sanitized observation hashes and excerpt are retained in
  `benchmarks/runs/2026-09-06-clique-improvement/evidence/inbox-restore/`.

The client owner is coordinating an independent Astra diagnosis without a
second writer in its active worktree. Preserve legitimate conflicting-delivery
refusals and authority/custody boundaries. Qualification should reproduce the
reload sequence, establish its cause, and verify a repair against both the
failing case and actual disagreement controls before closing this ticket.
Do not steer or repair the benchmark builder's app from the product lane.


Independent diagnosis found a separate unpublished candidate regression: the
same synthetic delivery envelope conflicts after program arrival because local
receipt filtering changes its stored fingerprint. The repro uses an actual
native-certified v4 minimum program and a synthetic no-row envelope. Base1f9
always forwarded that receipt, so this does not establish the0.0.8 cause.
The sole client writer is repairing stable raw identity while preserving
conditional coverage admission and equivocation checks. See retained
`evidence/inbox-restore/independent-report.md` and its source-bound result.
The later descending-log `E_OFFLINE_RESUME` is a separate app configuration
finding. Keep the original3264 attribution open without the failing envelope pair.
