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

## Independent observation: a reset owner database reproduces the same-sequence refusal (2026-09-06)

A candidate cause for the builder's `TypeError: conflicting deliveries for
chats.list at seq 3264` after a full-page reload, offered as a hypothesis to
check against the builder's session history, not as an attribution.

Observed on the published `snapback2@0.0.10` package, first in an actual
Release Hermes simulator run of the standalone chat app, then reduced to Node:

- A persistent client held `deliveries.inbox` at durable seq 4 from one owner
  database. The owner was restarted with a fresh `.snapback` (same program,
  same generation and schema hash) and its seed reached seq 4 again with
  different row ids. The client's next `online()` refused with the untyped
  `TypeError: conflicting deliveries for deliveries.inbox at seq 4`, thrown out
  of the resume path (native, deterministic across five runs; cleared by a
  fresh data container).
- Node, `h2-owner-reset-same-seq.mjs`: same shape (drain at seq 3, reset,
  reseed to seq 3 with new ids). The refusal is the specified equivocation
  check, but its typing differs by path: `client.query`/`subscribe` surface a
  typed `E_OFFLINE_DELIVERY` (site `client.query.commit`), while the native
  `online()` resume path surfaced the raw `TypeError`. A write still commits,
  and a cold reopen of the same partition recovered once the sequence moved on.
- Control, `h-owner-reset.mjs`: a reset whose new database has not reached the
  held sequence is handled silently (coverage reset, fresh download).

If the builder's dev owner was restarted with a reset or reseeded database
between sessions while the browser kept its IndexedDB partition, a reload
would produce exactly this signature. That is an environment/app-lifecycle
cause, not a product defect, though two product follow-ups would help app
builders: surface the refusal on the resume path with the same typed code as
the query path, and consider a database-instance identity in the manifest so a
replaced database resets coverage instead of tripping equivocation.

Retained under `~/verify-snapback2-liveoffline-20260906/` (`evidence-G/`,
`evidence-native/runs/native-accounts-2026-09-06T18-09-29-494Z/step4-online-throw.json`
with the full proxy wire capture). Wire captures show the held partition
carried the earlier instance's answers before the client ever went online.

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open, narrowed to database-instance replacement
and the original builder attribution. On current main `15c134d056`, the public
resume conflict control passed and surfaces `E_OFFLINE_DELIVERY` rather than a
raw `TypeError`:

```sh
cd snapback2
node --test packages/snapback2/tests/offline-public-state.test.ts
```

This is a package carrier test, not the published-0.0.8 browser session or
reset-owner wire pair. It proves typing, not that legitimate equivocation
should be suppressed. Closure still requires the retained old-owner/new-owner
equal-sequence pair through a current real durable carrier, preserving genuine
disagreement, and a decision on database-instance identity.
