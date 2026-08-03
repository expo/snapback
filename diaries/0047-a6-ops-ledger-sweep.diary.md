# Diary 0047: A6 operations and workflow ledger — LLP 0137 improvement sweep, Snapback web arm

**Program:** LLP 0137 Phase 1 (Stage 2, sixth and final diaried web sweep arm)
**Contract:** demos/improvement-sweep/protocol/contracts/a6-operations-ledger.v1.json (10 frozen checks)
**Lineage:** new shape — sequence allocation, claims, and settlement receipts (LLP 0133, LLP 0135) had no 0102 counterpart
**Posture:** external npm consumer of the public `@expo/snapback-*` 0.1.7 closure; guide + public docs only
**Capsule:** demos/improvement-sweep/arms/a6-snapback-web/run-capsule.json

## 2026-08-01 — Snapback web arm, deep budget, complete

### Environment and outcome

External consumer on macOS arm64 (volta node 24.18.0, bun 1.3.12), the
full `@expo/snapback-*` 0.1.7 closure from the public registry, runtime
binary sha256 `6c5c9567…` (byte-identical to the five prior arms).
Fresh isolated local target: sessions mode, app-local SQLite, port 4293
(4287–4292 guard-blocked; the unrelated fleet server sitting on 4287
since 2026-07-27 was left untouched). One consumer app, `ops-app`: a
dispatch operation — customers, jobs with human-visible JOB-n numbers,
steps, operators claiming work under leases and fences, an append-only
attempt ledger, an audit trail, idempotent external dispatch, one-off
follow-up scheduling on `jobs_one_off_v1`, recurring maintenance on
cron, and a dispatcher dashboard with range filters.

**All ten frozen checks pass — 10 pass / 0 GAP / 0 fail / 0 Stop, the
first fully green arm of the sweep — with the suite wall at 5.0s.**
Timings: closure install ~9s; scaffold + bun install under a minute;
backend authored in ~10 minutes off the A5 arm's retained recipes;
first full suite boot at +16 minutes (after the boot-refusal finding
below); first full green at +34 minutes; tsc + vite build + jsdom
render proof green by +38 minutes. Roughly 100 build-phase tool calls
against the 400-call deep ceiling; zero posture breaks.

### What the ops shape proved

- **Sequence identity (A6-02).** Six concurrent `createJob` calls from
  two authenticated clients allocated JOB-4..JOB-9 dense and
  duplicate-free with a three-line counter read-increment-write —
  serialized commits make the naive thing correct, the same
  zero-ceremony ISS-n property the A3 arm recorded. The dedupe replay
  returned the committed job without burning the counter. The frozen
  Convex chat evidence explicitly wished for this ("compare-and-swap on
  server sequences", Diary 0028; "would need a contention-safe sequence
  allocation", Diary 0034). LLP 0135's dedicated primitive is
  Accepted-but-unimplemented; worth noting the race's nondeterministic
  seq-to-spec assignment cost this suite one whole iteration of
  role-by-assumed-seq assertions — mint-visible allocation would have
  prevented exactly that.
- **One-off transactional scheduling (A6-04).** `ctx.jobs.enqueue`
  rides the SAME transaction as the job insert (delayMs, idempotencyKey,
  maxAttempts 1); the confirmed mutation envelope carried the bounded
  `enqueues` fact `{jobId, action, availableAtMs}`; the platform row
  carried `producerMutationId`; a premature drain ran nothing; the
  injected-clock drain executed the follow-up exactly once (disposition
  `succeeded`, fence 1) and a second drain no-reran. This is the
  capability the frozen LLP 0121 verdict said would keep a Dispatch
  builder on Convex — and it now works from public npm, with
  receipt-level producer association Convex does not offer.
- **Attempt receipts (A6-05).** Claim, release, retry-claim, lease
  timeout (via the maintenance pass), and dispatcher cancellation each
  appended exactly one receipt; late claim/complete/re-cancel against
  the terminal job receipted without state change; three ledger
  snapshots were byte-stable prefixes of the final 8-receipt sequence.
- **Fencing (A6-07).** Concurrent claims resolved to one owner; after a
  release and legitimate reclaim advanced the fence, the prior owner's
  stale-fence completion AND release both fenced with receipts while
  the fence-2 holder completed the job. All of it is ~40 lines of
  ordinary handler logic — no advisory locks, no retry loops.
- **Dispatch (A6-06).** The strict local provider (401 without the
  staged Bearer secret) received exactly ONE request per dedupe key
  across a same-actor retry and a two-actor race (`streamAttempt`
  custody; the loser observed `deduped`); settlement is a
  dispatcher-readable ledger row; the canary secret was absent from
  five client-visible surfaces.
- **Dashboard (A6-08).** The dispatcher's live dashboard and ranged job
  list updated in 64–67ms over the managed stream when an operator
  claimed a job; the +7d job partitioned the weekly/wide range handles
  exactly; the outsider's subscription was denied at the stream.
- **Export/restore (A6-09).** The dispatcher-only export is an id-free
  natural-key projection; after a receipted reset-install wiped to the
  fixture, `restoreLedger` rebuilt 7 jobs and patched 3 with id
  remapping, and the round-trip DIGEST matched (the restore's own audit
  row excluded and counted explicitly). The sequence continued at 11.
- **UI.** The frozen shell's ops view runs live: jsdom proof rendered
  the seeded aggregates, an independent operator's claim landed in the
  dispatcher's DOM in 93ms and a fresh JOB-4 allocation in 89ms.

### What fought back (findings)

- **f1 — `defineJobStatusQuery` makes the app unbootable.** The only
  authorable client-facing status surface for `jobs_one_off_v1`:
  codegen accepts it and emits a plan referencing `_snapback_jobs`; the
  server refuses the whole app at load
  (`SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID`) — the runtime's own
  table is `_snapback_jobs_v1`. One declared line, no boot. Worked
  around via the admin job route; probe evidence retained
  (issues/20260801-0137-a6-jobstatus-query-boot-refusal.md).
- **f2 — the jobs admin custody is undocumented.** The job-status route
  401s with `SNAPBACK_ADMIN_SECRET_READ_REQUIRED`; the mint route, the
  `x-snapback-secret-read-lease` header, and the first-class
  `snapback secret-read-mint` CLI (ready-file-bound operator proof) are
  in no guide page, nor are the enqueue options (delayMs /
  idempotencyKey / maxAttempts) or the drain input `{nowMs}`. I walked
  a three-error discovery ladder (401 → PROOF_INVALID → TOKEN_REQUIRED)
  with binary-strings reads in between. Adjacent trap: the docs say
  the capability is "acknowledged by codegen", but naming
  `jobs_one_off_v1` in `requiredCapabilities` refuses as unknown — the
  acknowledgment is emitted FOR you. The custody design itself is
  good; it just is not written down
  (issues/20260801-0137-a6-guide-gap-secret-read-lease-custody.md).
- **f3 — reset-install strands connected clients.** The receipted
  reset retires the entire pre-reset world: live-handle clients get a
  TERMINAL `SNAPBACK_AUTH_STREAM_RESET` out of whatever await comes
  next (retry does not reconnect), stale session tokens fail
  `SNAPBACK_AUTH_REQUIRED`, and a fresh sign-in for the same email is a
  NEW principal that must re-redeem the restored invite. The authority
  posture is right — reset never resurrects authority — but the client
  has no terminal-state surface and the guide says none of this; it
  cost three suite iterations to learn "discard everything, rebuild
  sessions" (issues/20260801-0137-a6-reset-install-strands-live-clients.md).

Known findings exercised and cited, not re-filed: the streamed lane as
the only working egress (a5-f1) carried the dispatch effect end to end;
the epoch-0 cron catch-up nominal (a4-f4) appeared on schedule; action
refusals still collapse the auth code (a4-f5/a3-f3); membership stayed
unseedable (a3-f1); the sessions persona/dev-lifecycle/config recipes
came from prior-arm records (a2-f6/a1-f9/a4-f7).

### How it felt

The core of this contract — the part operations software actually lives
on — was the easy part. State machine, fences, receipts, sequence
allocation, aggregates: serialized mutations plus `requireRole` plus
unique indexes expressed all of it directly, and the acceptance rig
could prove all of it deterministically because the platform hands you
seams (cron tick, injected-clock drain, receipted reset-install) instead
of cadences to sleep on. A 10-check operations suite that runs in five
seconds changes what you bother to prove.

The friction was concentrated at exactly one place: the newest surface.
`jobs_one_off_v1` is experimental and feels it — the core enqueue/drain
loop is genuinely excellent (transactional enqueue with receipt facts is
better than what I'd get from Convex), but its status query bricks the
boot, its custody is undocumented, and its vocabulary lives in binary
strings. That triad (f1/f2 + the tracked guide-page GAP) is the entire
gap between "experimental" and "usable from the guide alone".

Compared to the frozen alternatives on this shape: Convex would have
given me `runAfter` ergonomics and schema-free iteration, but no
receipted enqueue facts, no deterministic drain, no sequence safety
without OCC retries, and its frozen arms carry the secret-custody Stop.
SpacetimeDB's reducers would express the fences but not the audit
economy (receipts, exports, digests). Supabase would need pg_cron plus
triggers plus RLS and none of it would fit in a five-second proof loop.

### Would I choose Snapback for this app?

Yes — for the operations-ledger shape specifically, this is the
strongest fit of my six-arm sweep experience: the contract's hard facts
(gap-free sequences, one-owner claims, fenced late writes, append-only
receipts, idempotent dispatch, restore-with-proof) all fall out of the
serialized-commit + scoped-role + unique-index core with no extra
machinery, and the deterministic seams make the operational claims
provable rather than asserted. The condition: land f1 (boot refusal)
and give jobs/custody their guide page — today those cost an external
consumer real discovery budget that the rest of the surface no longer
does.

### Lessons for Snapback

1. A generated surface that cannot boot is worse than an absent one —
   `defineJobStatusQuery` should either work or refuse at generation
   (f1); a boot-level regression on every generated declaration form
   would have caught it.
2. Custody without documentation reads as breakage: the secret-read
   lease design is defensible and even elegant, but every layer of it
   (route, header, CLI, proof root) must be on the jobs guide page (f2).
3. Reset blast radius needs a client-side contract: a terminal-auth
   state on SnapbackClient plus three guide sentences would convert f3
   from a three-iteration trap into a documented rebuild step.
4. Protect the receipts: bounded `enqueues` facts on mutation
   envelopes, producer association on job rows, append-only attempt
   ledgers, and digest-stable exports are the differentiators this arm
   would defend hardest — they are what made an OPERATIONS contract
   green in 5 seconds.

## 2026-08-01 — RE-VERIFICATION against 0.1.8 (fix-loop entry, not a rerun)

Packages: all @expo/snapback-* at 0.1.8 (fast-path publication from
main 5d5c6b71; ledger fastpath-ledger-0.1.8-5d5c6b7183af).
Evidence: demos/improvement-sweep/arms/reverify-0.1.8/ (capsule +
evidence + drivers).

All three A6 fixes verified from external-consumer posture (this arm's
retained app + a jobStatus/enqueue probe pair):

- **a6-f1 (jobStatus boot refusal): VERIFIED.** The app boots with
  `export const jobStatus = defineJobStatusQuery({auth:'authenticated'})`
  declared (0.1.7: unbootable), and the query served the lifecycle
  projection live (state pending -> claimed, queue default) across an
  injected-clock drain (RV-A6-F1). One papercut ticketed: generate
  still emits a degraded-result advisory for the declaration.
- **a6-f2 (jobs guide custody): VERIFIED.** The page's recipe is
  accurate on 0.1.8: delayMs + idempotencyKey enqueue (reuse returns
  deduplicated:true), `snapback secret-read-mint` lease custody, and
  the lease-custodied status route 200 (RV-A6-F2).
- **a6-f3 (reset strands live clients): VERIFIED.** Across a receipted
  reset-install, the connected client observed the frozen terminal fact
  through the new surface — `authTerminalStatus()` returned
  {terminated:true, code:SNAPBACK_AUTH_STREAM_RESET,
  authorityDisposition:durableDelete} and `subscribeAuthTerminal`
  fired at the cut (RV-A6-F3).

## 2026-08-02 — sequence primitive replaces the hand-rolled counter

The retained A6 source now uses the repository implementation of
`sequence_allocation_v1`. `createJob` declares `jobNumber` against the `orgs`
scope and the `orgMembers` dispatcher/operator reach, then calls
`ctx.sequence.allocate('jobNumber', args.orgId)` in the same mutation as the
job, job-step, activity, and follow-up enqueue. The `orgs.jobSeq` application
field and its read-increment-patch workaround are gone. Acceptance still drives
six concurrent creates and now also checks each direct receipt's exact
counter/scope/value fact.

The literal seed already contains JOB-1..JOB-3. Rather than adding an authored
start value or touching the framework table, the fixture records three normal
committed allocation events through a sequence-only `primeJobSequence`
mutation before creating JOB-4. Reset/restore similarly re-records every
historical allocation represented by the export before restoring those rows,
so the next create receives `max(seq) + 1`. That bridge is intentionally
A6-specific brownfield setup, not a general migration API.

The ergonomic difference is material: the operation's business handler no
longer knows a counter row or update protocol, and dedupe returns before
allocation so it cannot burn a number. Naming the scope in the call also makes
the contention/authorization unit visible where the effect occurs. Compared
with Convex-style OCC around an application counter, this is less code and a
stronger receipt/replay story; the remaining rough edge is migration of
historical pre-primitive numbers, which this fixture must spell out explicitly.
