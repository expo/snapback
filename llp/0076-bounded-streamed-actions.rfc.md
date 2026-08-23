# LLP 0076: Bounded streamed actions

**Type:** RFC
**Status:** Accepted
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-08-22 (structural-boundary repair: durable attempt writes now
accept only exact batches signed by the registered in-process attempt registry;
the raw-row seam is test-only. Process-death reconciliation consumes a private
one-use capability during serving-database adoption and writes its
`Terminalizer` classification before a live serving handle exists. A durable
read binds the supplied adoption context against later substitution, but the
v1 row carries no historical runner identity and therefore makes no stronger
storage-to-owner claim); 2026-08-12 (the local upstream-response reader now consumes LLP
0251's shared destination floor and names its value-free SSRF refusal code);
2026-08-09 (LLP 0204 S4 Landing A adds the distinct bounded
private action-output stream described in the dated amendment below; the
accepted upstream-response reader contract remains unchanged). 2026-07-29 (implementation-drift repair — LLP 0102's frozen
Research Room/Snapback arm found that sessions complete-pair preflight still
constructed `local_v0_declared()` while ordinary loading and served inspection
used the process-live instance manifest. The mismatch refused a valid
sessions-plus-stream composition before bind. `894ddaf99` restores the
ratified exact-instance contract by composing preflight with the same live
egress predicate; an isolated two-child test proves enabled admission,
disabled effectless refusal, and no candidate publication. The full frozen
Research Room confirmation moves from 1 PASS / 2 GAP / 12 FAIL to 13 PASS / 2
unchanged GAP / 0 FAIL. This corrects implementation drift and the overly broad
2026-07-24 ledger claim; it does not change the accepted contract). 2026-07-25
(ACCEPTED — author ratification, Charlie Cheever,
session-directed 2026-07-25, with the gate-2 evidence complete: the
`single-instance-container-vm.v1` hosted receipt exists (protocol amendment
v0.7 — Fly.io drill, remote instrument 7/7, durable-row scan PASS, Tigris
backup byte-exact PASS, hosted-auth refusal witness), on top of the local
arm's full witness set and the Workerd arm's narrower Miniflare witness. The
acceptance act flips `bounded_response_stream_v1` to `stable` in the LLP
0058 registry — positive presence is now the plain compatibility assertion;
existing `acknowledgedExperimentalCapabilities` entries survive as no-ops
and codegen stops emitting new ones. Honest residues stay recorded rather
than erased: open questions 6 (secret-bearing provider streams on every
claimed target through the opaque-placement seam — the hosted descriptor
seam is landed, the per-target witness matrix is not) and 7 (byte-accounting
measurement basis), plus the ledger's Workerd residues (no
`ctx.streamAttempt` control plane there, structured-detail transport, the
Begin/Initiated cut). Those are scoped refinements of a ratified contract,
not contract instability). 2026-07-24 (capability-maturity decision implemented — author
decision Charlie Cheever 2026-07-24: the LLP 0058 registry gains the
code-owned `proposed`/`experimental`/`stable` maturity dimension;
`bounded_response_stream_v1` is `experimental` until this RFC is Accepted.
The served manifests annotate it via the additive `capabilityMaturity` map,
and admission on BOTH arms refuses an experimental requirement the artifact
does not list in `acknowledgedExperimentalCapabilities` (emitted by codegen
alongside the requirement) — witnessed by the egress-enabled unacknowledged
negative plus acknowledged positive through the real local loader
(`crates/snapback/tests/action_stream_envelope_v0.rs`), the registry unit witnesses, and the
Miniflare egress acceptance (29/29, including the served-maturity honesty
check; the Workerd unacknowledged-refusal negative is code-shared with the
supported-set refusal and not separately deployable, a named witness
residue). The capability-honesty ticket closes; the Positive-capability-
overclaim ledger row closes; status remains Draft — the maturity marker is
precisely what lets the capability ship honestly while Draft).
2026-07-24 (gate-2 remainder pass: LLP 0075 protocol amendment
v0.5 reconciles the frozen fixture with the StreamAttemptV1 control plane
and certainty mirror (instrument 7/7); per-bullet acceptance receipts landed
with three explicit gaps; the guide gains `backend/streamed-actions` with a
`partial` capability row and the repair anchor now resolves — ENG-25423).
2026-07-24 (the last two implementable residues closed: the
ServicePrincipal tier of the per-read fence is witnessed end to end — a
real scoped-token authority prepared through the production admission and
invocation machinery, a real service terminal gate committed while a pull
was blocked, late bytes discarded with the exact
`SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`, and post-terminal opens refused —
and the Workerd admission leg landed: function resolution (the loader seam
of a deploy-time-compiled target) refuses known registry ids the served
manifest does not support with a typed 503 before any handler runs,
witnessed positively and negatively through Miniflare. The
per-read-authority-fence ticket closes; capability-honesty narrows to the
single open author decision — the LLP 0058 maturity-marker design — which
this revision deliberately does not make; status remains Draft).
2026-07-24 (the stranded Workerd/Cloudflare streaming arm is
re-landed on main, ported from the primary checkout's uncommitted working
tree and adapted to the landed contract: the decision-4 rename and
decision-5 safe-method-only downgrade, decision-6 `elapsedMs`/`deltaMs` on
read results, pre- and post-pull abandonment revalidation with late-byte
discard, one-in-flight-pull-per-cursor, invocation-wide carry-over
accounting with a 64 KiB refusal path, fail-closed refusal of stream
attempt tokens (this target has no StreamAttemptV1 control plane), the LLP
0036 descriptor placement seam at the coordinator stream-open boundary with
the authored-URL rule, and an honest all-aboard manifest (six enforced
limit rows, no wall row, witness-bounded runtime fact). Witnessed by ten
stream checks in the Miniflare/workerd egress acceptance (27/27) including
secret placement value-freeness, the renamed progress-rate fence, the
4-cursor cap, and the exact idle-timeout code; the Workerd residue rows
below narrow accordingly; status remains Draft). 2026-07-24 (capability honesty advanced on the local arm:
admission now resolves every declared requirement against the served
instance manifest in one preflight shared by all local loader paths, with
outbound-disabled negative and egress-enabled positive witnesses; codegen
stream inference is AST-derived (aliases detected, comments ignored); the
overclaim ledger row narrows to the open maturity-marker design question,
deferred to the LLP 0058 review loop). 2026-07-24 (secret scrubbing landed on the local arm: streamed
requests place secrets exactly like ordinary local actions — staged values
with the LLP 0036 redactor on every stream error envelope, witnessed in both
the rethrown-leak and untouched-refusal directions through the real HTTP
path; `secretSlots` parity added to the bridge with a typed local refusal
for unresolvable descriptor slots; residue: the hosted descriptor seam and
retained-receipt scans). 2026-07-24 (diagnostic envelope landed on the local arm: all
nine then-promised codes survive both envelope allowlists; an out-of-band recorder
restores the host-built structured refusal past the JS round-trip while
forged stream codes fold to the generic handler failure; raw serde text
removed from stream diagnostics; witnessed through the real HTTP action path
plus the mutations-cannot-stream executed negative; residue: the Workerd
handler transport's detail discard). 2026-07-24 (boundedness landed on the local arm: per-cursor
reader threads behind one-slot rendezvous channels make the 30 s wall an
absolute mid-read ceiling with 2 s settlement grace reserved ahead of the
watchdog, serialize one in-flight pull per cursor, and carry a real
per-invocation materialized-byte counter whose four-cursor slow-consumer
witness stays under the 64 KiB domain — defined as host-materialized bytes,
kernel buffers excluded; decision 6's monotonic `elapsedMs`/`deltaMs` now
rides every read result; local manifest rows updated (buffered-bytes
`Enforced`, read-size/cursor/wall rows added); residue: the Workerd arm).
2026-07-24 (per-read authority fence landed on the local arm:
pre- and post-pull revalidation of abandonment/generation/deadline plus the
lock-free process-fence tier of service authority, late-byte discard on a
blocked read, and the direct attempt-to-cursor cancellation signal with
physical upstream-socket closure — drain-bounded by the idle ceiling, not an
abort; residue: the ServicePrincipal-tier end-to-end witness and the Workerd
arm; the fence ticket stays open on those two). 2026-07-24 (write-ahead `initiationState` landed on the local
arm: the `_snapback_stream_attempts` SQLite substrate durably pre-marks an
attempt-bound cursor `initiation_possible` before the send, narrows only on
provable pre-send failures, advances to the absorbing `response_observed` on
metadata, and a startup reconciler settles orphaned rows `failed` with the
conservative effect fold; decision 5's declaration-or-downgrade also landed —
a bare idempotency key no longer downgrades `ambiguous` to `failed`; the
initiationState and two-axis-settlement(host-side) ledger rows move to
landed-local; status remains Draft). 2026-07-24 (StreamAttemptV1 control plane landed on the local
arm: host-owned attempt registry with opaque tokens
(`ctx.streamAttempt.start`/`settle`, `attemptToken` on the stream request),
atomic single-runner lease with dead-holder takeover, trusted compare-and-set
terminalizer across the watchdog/fence-loss/forfeiture legs, retry refusal
after the first durable progress commit, and the automatic-retry cron
exclusion; the terminalizer/lease/StreamAttemptV1 ledger rows move to
landed-local with named residue — crash-durable substrate, Workerd arm, and
fixture reconciliation remain open; status remains Draft). 2026-07-23 (the shared reader-surface baseline previously
implemented only in a non-landed working tree is now landed on main via the
gate-2 program worktree: runtime stream DTOs + host-op dispatch, the local
detached-host implementation with total/idle/wall/read-boundary checks and the
conservative nested-mutation rate fence, envelope passthrough for the seven
stream codes, reviewed HTTP statuses, the instance-live
`bounded_response_stream_v1` capability predicate with regenerated committed
manifests, codegen admission requirements, and the `ctx.fetchStream` bridge;
the progress-rate code lands renamed `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED`
per §Author decisions item 4, with the fixture's authored handler updated in
the same change under protocol amendment v0.4; the LLP 0075 local-streaming
instrument passes 6/6 against this baseline. The Workerd arm and every staged
gap below remain open; status remains Draft). 2026-07-23 (author decisions: open questions 1, 2, 3, 4, 5, 8, 9,
and 10 resolved — see §Author decisions — 2026-07-23; OQ6 and OQ7 remain
open; the certainty column is host-persisted, attempts gain per-cursor child
records, non-GET retry idempotency becomes declaration-or-downgrade, the
progress-rate code is renamed profile-neutral, reads carry monotonic
elapsedMs, gate 2 targets `single-instance-container-vm.v1`, and
ReadableStream/resumable-cursor adoption is deferred with named triggers).
2026-07-23 (additive prior-art comparison against InstantDB
Streams — resumability, writer discipline, authorization defaults, retention —
added as a dated subsection under LLP 0086 CC-5; no contract text changed;
LLP 0082 and LLP 0086 added to Related). 2026-07-23 (fifth model-family review round — Fable NOT READY
(two items: the MUST/open-question tension and `wireInitiated` feasibility),
Codex NOT READY, artifacts under `llp/reviews/0076-*`. This revision redesigns
the effect-certainty axis to a crash-safe, transport-agnostic write-ahead
`initiationState` (`definitely_not_initiated` / `initiation_possible` /
`response_observed`, pre-marked before the send) — which both establishes
`wireInitiated` feasibility and closes the MUST-versus-open-question tension
(host derivation is settled; only which layer persists the column is open) —
gives the terminalizer/lease a concrete host-owned `StreamAttemptV1` ownership
model, fixes the canonical example that used the denied `Date.now()` (now
coalesces by chunk count), and marks the per-read-revalidation prose as target
contract; the code side of all of these remains tracked as gaps; status
remains Draft). 2026-07-23 (fourth model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0076-*`. Both families confirmed
the round-3 accuracy fixes but identified a hole in the *specified* model: the
late-effect fence delegated terminalization to an authored mutation that
cannot run under abandonment, and retry had no single-runner lease. This
revision promotes the trusted terminalizer and the atomic single-runner lease
from gap items into the specified Settlement contract (so a durable winner
always exists and no two runners commit), specifies a distinct host
`wireInitiated` fact for the effect-certainty axis rather than reusing LLP
0059's `Initiated` permit, clarifies that the certainty is an orthogonal fact
rather than a sixth settlement kind (so LLP 0075's five `requiredSettlementKinds`
need no amendment), tightens the SSE non-goal to a byte-stream-only commitment,
and makes the canonical example's `shouldFlush()` self-contained; the code-side
of the terminalizer/lease/wireInitiated remains tracked as gaps; status remains
Draft). 2026-07-23 (third model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0076-*`. Both families confirmed
the round-2 fixes but caught that the round-2 two-axis settlement was asserted
as implemented fact while existing nowhere; this revision demotes it to a
normative "must record" requirement tracked as a gap plus a fourth author
obligation and an acceptance bullet (needing a host-exposed `initiated`
fact), states the keyed-classification behavior as the author's assertion and
the progress fence as a 100 ms minimum spacing, corrects the witness-cadence
attribution and the cancel/`releaseLock` wording, and adds gaps for the
missing LLP 0036 secret scrubbing on streamed fetch and the positive
capability-manifest overclaim; status remains Draft).
2026-07-23 (second model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0076-*`. This revision fixes the
two normative-accuracy defects Fable blocked on — the canonical example now
coalesces so it does not trip the progress-rate fence against the frozen
fixture, and `SNAPBACK_ACTION_STREAM_CANCELLED` is described as a reserved
internal reason with EOF-after-cancel as the v1 read behavior — makes
settlement two-axis so `timed_out`/`cancelled` after provable initiation
record the effect-may-have-executed fact, states the 30 s wall ceiling as
absolute (removing the overshoot licence the prior revision wrongly
introduced), drops the v1 cancel reason, scopes the fixture-matching claim to
five limits, enumerates the author obligations, and expands the
implementation-gaps section with the per-read fence, trusted terminalizer,
retry fencing, wall-clock, buffer-accounting, capability-admission, and
diagnostic-envelope items both families raised; status remains Draft).
2026-07-23 (first model-family review round — Fable NOT READY,
Codex NOT READY, artifacts under `llp/reviews/0076-*`. This revision corrects
the three authority-accuracy defects — the progress pattern is authored, not
generated; manifests publish limit names and status, not exact values; the
diagnostic registry gains `SNAPBACK_ACTION_STREAM_UNSUPPORTED` and an honest
scope for the host rate fence — tightens settlement and retry semantics
(host-provable initiation rule, mid-body classification, durable-winner
precedence, no retry after the first durable progress commit), documents the
4-cursor cap, read-boundary limit checking, and async iteration, and adds an
evidence-status section separating witnessed claims from staged gaps; status
remains Draft). 2026-07-22 (implemented the shared Ibex/Workerd reader surface,
instance-live capability predicate, exact resource-limit diagnostics, and
local plus Cloudflare executable witnesses; status remains Draft pending
author review). 2026-07-22 (initial semantic authority required by LLP 0074 gate 2)
**Related:** LLP 0004, LLP 0008, LLP 0009, LLP 0028, LLP 0036, LLP 0058, LLP 0059, LLP 0063, LLP 0070, LLP 0074, LLP 0075, LLP 0082, LLP 0086

## Summary

Snapback actions should consume an upstream HTTP response incrementally without
granting direct database access, retaining unbounded bytes, or allowing a late
continuation to write after cancellation, timeout, deployment change, or
authority loss. This RFC defines a narrow v1 streaming profile and the durable
progress pattern required by LLP 0074. It did not originally turn an action
result into a streaming client response. The 2026-08-09 amendment adds a
separate, bounded action-output stream for LLP 0204 conversations; it does not
change the upstream-response reader defined by the original RFC.

This document is Accepted. The evidence residues and open questions below stay
honest for the original upstream-response profile.

## Dated amendment: private action-output streams (2026-08-09)

LLP 0204 S4 Landing A reuses the host-owned attempt settlement and bounded
ephemeral machinery in this RFC for the opposite direction: an action can emit
incremental JSON values to its initiating client. This is deliberately a
distinct surface from `ctx.fetchStream`, which reads an upstream HTTP response.

An Ibex action may declare `stream: true` in `defineAction`. The declaration is
a validated manifest fact, participates in the implementation identity, and is
refused on queries and mutations. Its context gains
`await ctx.stream.emit(chunk)`, where `chunk` is a string or another JSON value.
The host serializes the value before admission and enforces these exact v1
limits on the serialized chunk value:

- at most 16 KiB per chunk;
- at most 2 MiB across one attempt; and
- at most 20 admitted chunks in any rolling one-second window.

The function call returns its opaque `attemptToken` once the host has durably
created the attempt and acquired its single-runner lease. Execution continues
under the ordinary detached-action watchdog. Each accepted emit receives a
host-owned, zero-based monotonic `chunkIndex`; cancellation settles the same attempt
`cancelled`, and the next emit is refused by that terminal winner.

Chunks travel through the reserved `_snapback_stream` collection using the
normal ephemeral publish, retention, ordering, subscription, and socket
delivery machinery. Only the server can publish. The room scope is exactly the
opaque `attemptToken`, but possession of that token is not read authority: the
subscription gate compares the initiating session user, service-credential id,
or anonymous connection id. A reconnect by the same session user may use a
different connection; a second principal is refused.

`sinceChunk` is an ephemeral reconnect hint, not a durable cursor. The initial
snapshot returns retained chunks whose `chunkIndex` is greater than the hint
and a `streamResume` fact. If the retained prefix is missing, `truncated` is
true and the response points to `/streams/{attemptToken}`. No raw chunks and no
resume cursor are written durably.

Deployment activates the exact protected `_snapback_stream_transcripts` table
iff the function manifest contains at least one streaming action. Settlement is
immutable and records the attempt token, function id, initiator identity,
started and settled times, terminal cause, a final value bounded to 256 KiB,
chunk count, and nullable prompt/completion token counts. Failure,
cancellation, timeout, and process-death reconciliation settle with no final
value. `GET /streams/{attemptToken}` and
`POST /streams/{attemptToken}/cancel` are private, `no-store` AppData routes;
in sessions mode they accept only a resolved session or scoped service token
whose initiator identity exactly matches the attempt. Unknown transcript reads
return 404 and known foreign reads return 403.

The Vercel AI SDK/SSE projection, durable chat-history query, token metering,
shared/multi-viewer streams, `ask`, and wire `run_code` remain later LLP 0204
landings. The remote MCP description therefore continues to advertise no
server-initiated streams.

## Surface

An Ibex-module action receives `ctx.fetchStream(request)`. Queries and
mutations do not. The call uses the same outbound-action enablement, service
authority, secret redaction, URL policy, and action watchdog as ordinary
outbound fetch. v1 accepts an absolute HTTP(S) URL, method, bounded headers and
body, and an optional idempotency key. It returns response metadata and a body
with the familiar reader subset:

```js
const response = await ctx.fetchStream({ url, method: 'GET' });
const reader = response.body.getReader();
let batch = [];
let sinceCommit = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  batch.push(...value);
  // Coalesce so durable commits stay under the 100 ms minimum spacing. The
  // example counts chunks rather than reading a wall clock — actions have no
  // `Date.now()`, and `ctx.runtime.now` is fixed per invocation — so flushing
  // every two reads keeps spacing above the fence against the witness cadence
  // (chunks every 80 ms; fixture floor ~50 ms). A per-chunk commit would trip
  // SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED. A host-provided progress helper that
  // owns coalescing and the terminal CAS is the intended v1 direction.
  if (++sinceCommit >= 2) { await ctx.runMutation('applyProgress', { attemptId, bytes: batch }); batch = []; sinceCommit = 0; }
}
if (batch.length) await ctx.runMutation('applyProgress', { attemptId, bytes: batch });
```

`value` is a `Uint8Array`. Only one reader may own a body. `read()` is
pull-driven: the host obtains at most one bounded chunk because the reader
asked, so application backpressure is the default. `cancel()` closes the host
cursor idempotently once it is open (a host-op cancel of an unknown cursor id
errors `SNAPBACK_ACTION_STREAM_INVALID`, but the bridge reader makes that
unreachable from application code); v1 takes no cancel reason (any argument is
accepted and ignored). `releaseLock()` throws unless the stream has reached
EOF or been cancelled — a deliberate deviation from the Web reader contract.
Dropping or finishing the action closes every cursor owned by that
invocation.

The first profile uses these enforced maxima. The first five match LLP 0075's
frozen fixture; the 16 KiB host read size and the 4-cursor cap are additional
v1 profile limits stated only here, as this RFC is the sole numeric authority:

- 1 MiB total response bytes;
- 64 KiB application-visible buffered bytes, with a host read size no greater
  than 16 KiB;
- 30 seconds from stream open through terminal read, further bounded by the
  action watchdog;
- 5 seconds without a delivered byte;
- 10 durable progress commits per second for the durable progress pattern —
  enforced as a 100 ms minimum spacing between commits while a cursor is open,
  not a rolling-window budget, so a burst after a stall is refused and authors
  must space commits (the example coalesces by chunk count, since actions have
  no wall clock — see the example comment; it does not gate on elapsed time
  since the last commit);
  and
- at most 4 concurrently open cursors per action invocation.

These are v1 profile limits, not claims about an eventual general-purpose
streaming API. A later profile may widen them only prospectively with its own
resource and abuse evidence. The 30-second wall-clock ceiling is absolute: it
is the accepted total from stream open through terminal read and matches LLP
0075's frozen fixture, never exceeded. That the local host currently checks it
only at read boundaries (so a blocking read can return slightly past the
budget) is an implementation gap recorded below, not a licensed overshoot; the
enforced deadline must bound the read itself. The reader also supports
`for await` async iteration as part of v1, delegating to the same `read()`
semantics. When the caller supplies an idempotency key, the host forwards it
as the upstream `Idempotency-Key` header unless the author set that header
explicitly — the key is provider-visible, not merely Snapback metadata.

## Authority and lifecycle

Opening a stream crosses the existing service external-effect begin/initiated
cut. In the target contract, every open/read/cancel operation revalidates the
exact action invocation, app generation, service authority, and watchdog
deadline, and a read revalidates *after* awaiting bytes and discards late
bytes if authority was lost. The shipped hosts do not yet perform the
post-read revalidation or check the full service-authority predicate; this is
tracked as the per-read authority-fence gap below. A cursor is opaque, random,
invocation-local, and never accepted by another action.

The following events close the cursor and prevent another successful read:

- EOF, explicit reader cancellation, or action completion;
- action watchdog or idle timeout;
- application reload/reset or deployment generation change;
- session/service authority terminalization; or
- host/network failure.

The action's existing commit gate remains the durable late-effect fence. A
progress mutation validates the attempt row and terminal state inside its
transaction. Once cancellation or another terminal settlement commits, a
later patch is rejected even if bytes were already in flight. Mutations
committed before cancellation remain visible; actions are not transactions.

Caller cancellation in v1 is the explicit durable cancellation operation of
the product pattern, not inference from a dropped HTTP connection. The next
progress mutation observes that terminal row, rejects the patch, and the action
cancels its reader. Deployment stop and watchdog abandonment close the host
cursor directly. LLP 0070 owns how the same contract later binds to durable-job
cancellation.

## Settlement and retry

The durable progress pattern — authored per-application today under this
authority; a generated variant is future work with its own LLP 0065
fact-class story — stores one server-issued `attemptId`, one client
idempotency key, accumulated content, last applied sequence, and exactly one
of `running`, `complete`, `failed`, `cancelled`, `timed_out`, or `ambiguous`.
Start/retry is idempotent by the client key. A progress mutation applies a
sequence once, rejects gaps and terminal attempts, and throttles commits to
the declared ten-per-second ceiling. Completion is a separate terminal
mutation.

The late-effect fence is layered: the host closes cursors and fences via
generation, authority, and abandonment checks, while terminal-settlement
fencing is the pattern's in-transaction responsibility — an authored progress
mutation that skips the terminal-row check forfeits that guarantee. The
obligations an application author must not get wrong are: the in-transaction
terminal check on every progress and completion mutation, the row-level
progress throttle, the no-retry-after-first-durable-commit rule below, and
recording the upstream-effect-certainty fact on any terminal settlement after
host-provable initiation; none of these four is host-enforced, and the
reference pattern does not yet implement the fourth.

Settlement must carry two facts, not one: a `terminalCause` (`complete`,
`failed`, `cancelled`, `timed_out`, `ambiguous`) and, orthogonally, an
upstream-effect certainty — because cancellation or timeout after initiation
of a non-idempotent request leaves the provider outcome genuinely unknown,
exactly as a mid-body loss does. The certainty is a separate durable fact, not
a sixth cause: the five settlement kinds are unchanged, so LLP 0075's frozen
`requiredSettlementKinds` stays exactly those five and no fixture amendment is
required for it — the certainty column is additional retained evidence
alongside the kind, not a new kind. The single cause enum alone would let
`timed_out` and `cancelled` silently drop the uncertainty that `ambiguous`
and mid-body `failed` preserve.

The certainty axis MUST be host-derived, not author-inferred, and it is made
crash-safe by write-ahead marking rather than by observing the wire. The
runtime carries a durable `initiationState` with three values:
`definitely_not_initiated`, `initiation_possible`, and `response_observed`.
The runtime durably records `initiation_possible` **before** it hands the
request bytes to the outbound stack; it narrows to `definitely_not_initiated`
only when it can prove the request never left (a pre-send failure such as
connection-refused or DNS failure before any byte was written); and it
advances to `response_observed` once response metadata arrives. This is
deliberately *not* LLP 0059's `Initiated` authority permit, which
acknowledges synchronous invocation *or* synchronous refusal and so cannot
distinguish a proven pre-send failure. The design is transport-agnostic: it
requires only that a host can recognize a provable pre-send failure, and a
host that cannot MUST conservatively leave the state at `initiation_possible`
— the fail-safe direction. A crash after the pre-mark leaves
`initiation_possible`, which is the conservative reading.

The durable row records "effect may have executed" for any terminal
settlement whose `initiationState` is not `definitely_not_initiated`.
Resolution of the uncertainty is LLP 0070's lookup/idempotency path, never a
silent retry. The two-axis contract, the three-state `initiationState`, and
the write-ahead pre-mark are specified here, not deferred; the reference
pattern's single-status row and the host pre-mark are not yet implemented and
are recorded as implementation gaps below. The certainty is derived by the
host (this is settled, not open); the remaining open question is only which
layer *persists* the certainty column, not who derives the fact.

Classification is by host-provable phase, and ambiguity strictly
over-approximates: an upstream failure the host can prove preceded request
initiation is `failed`; for a non-idempotent request, any transport failure
the host cannot prove preceded initiation is `ambiguous`, and the runtime
must not silently retry it. Mid-body transport loss after response metadata on
a non-idempotent request settles `failed` (cause) and must set the
effect-may-have-executed fact. Exhausting the idle or wall limit is
`timed_out`; an explicitly cancelled reader is `cancelled`; both must set the
effect fact when initiation was host-provable. Where the action's local
inference and the durable row's committed terminal state disagree — for
example a cancellation/timeout race — the durable winner is authoritative and
the action must return it.

Classification no longer keys on whether the request carries an idempotency
key (decision 5, landed 2026-07-24): a bare authored key does not confer
idempotency, so a keyed non-GET whose transport failure cannot be proven
pre-send settles `ambiguous` exactly like an unkeyed one, while a provable
pre-send failure (DNS, connection refused, an unusable URL) settles `failed`
on any method and narrows the cursor's pre-mark to
`definitely_not_initiated`. The key is still forwarded provider-visible as
the `Idempotency-Key` header. The deployment-pinned provider idempotency
declaration — provider identity, key header, scope, verified by the host,
binding the effective key and a canonical request digest into the attempt
record, after which a recognized key may downgrade `ambiguous` to `failed`
and re-earn retry semantics — remains staged work.

For the fence promise (no late continuation writes after cancellation,
timeout, deployment change, or authority loss) to hold, the model specifies
two runtime-owned mechanisms, not left to the authored mutation:

- **Trusted terminalizer.** A durable winner must always exist. When the
  action is abandoned — generation retirement, service-authority
  terminalization, or watchdog expiry — a trusted runtime terminalizer (or a
  lease-expiry reconciler) writes the terminal row by compare-and-set, so the
  attempt never remains `running` with no winner for the authored path or a
  reader to observe. This is required because the abandoned action itself
  cannot commit, so terminalization cannot be the authored mutation's sole
  responsibility. The authored in-transaction terminal check remains the
  fence for the *authored* path; the trusted terminalizer guarantees a winner
  exists for the *abandoned* path.
- **Single-runner lease.** Every attempt binds an atomic single-runner lease
  (a runner-generation token) at start. A progress or terminal mutation
  commits only under the current lease; a second runner that reopens the
  upstream request cannot commit progress, so retry can never splice two
  runners' differently segmented bytes. `startReply` returning the same
  attempt to a concurrent caller must hand back the existing lease holder, not
  a second runner.

The ownership model is a host-owned attempt record (`StreamAttemptV1`): the
runtime, not the authored schema, owns the attempt identity, the runner-
generation lease, the `initiationState`, and the terminal cause+certainty, and
issues the action an opaque attempt token that binds fetch, progress,
cancellation, lease renewal/takeover, and terminal settlement. This is what
lets the trusted terminalizer locate and CAS the row after the authored action
is gone. The authored progress pattern references the attempt token; it does
not own the fence-critical fields.

With those two in place, the "durable winner is authoritative" rule always has
a winner and the action MUST return the committed terminal result verbatim
rather than its local inference. The reference pattern implements neither the
trusted terminalizer nor the lease yet; both are tracked as implementation
gaps below, but they are part of the specified contract, not optional.

An idempotent GET or a request carrying a provider-recognized idempotency key
may be retried by the authored action, still under the same Snapback attempt
identity — but in v1 only before the first durable progress commit. Once any
progress has committed, retry is prohibited: transport re-segmentation could
associate the same sequence number with different bytes, so resumable retry
is deferred to the durable-cursor open question. Whether "provider-recognized"
can become a trusted, machine-checkable declaration rather than an authored
assertion remains open question 2.

## Diagnostics

Stream refusals are structured and secret-safe. They name a stable code, the
operation (`open`, `read`, `cancel`, or `progress`), source locus when codegen
has one, expected shape or limit, a value-free received summary, and the guide
anchor for repair. URLs are reduced to scheme and host; headers, bodies,
secret values, private response bytes, prompts, and message text never enter a
default diagnostic.

The v1 code families are:

- `SNAPBACK_ACTION_STREAM_INVALID`;
- `SNAPBACK_ACTION_STREAM_SSRF_REFUSED`;
- `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED`;
- `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT`;
- `SNAPBACK_ACTION_STREAM_TIMEOUT`;
- `SNAPBACK_ACTION_STREAM_CANCELLED`;
- `SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED`;
- `SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS`; and
- `SNAPBACK_ACTION_STREAM_UNSUPPORTED`, refused by any target whose host does
  not implement the profile.

In v1 a read after cancellation returns end-of-stream (`done: true`), not an
error, and explicit `cancel()` succeeds idempotently.
`SNAPBACK_ACTION_STREAM_CANCELLED` is a reserved internal cancellation reason,
not a diagnostic surfaced to the reader on a post-cancel read; no v1 read path
emits it. A later profile may promote it to an observable refusal, which would
be a profile change.

The host additionally rate-fences **all** nested mutations while any cursor
is open — not only the progress pattern's — emitting
`SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` as a conservative transport-level
guard; the pattern's own row-level throttle reuses the same code for the
application commit protocol. The code is the profile-neutral host name
resolved by §Author decisions item 4 (2026-07-23); the retired
fixture-flavored `SNAPBACK_REPLY_*` spelling no longer exists in code, and
protocol amendment v0.4 records that receipts treat the two spellings as the
same diagnostic across the rename boundary.

Existing generation, authority, and action-watchdog diagnostics retain
precedence when they are the real cause.

## Target contract

The local Ibex and selected hosted target expose the same application surface
and settlement states. Their internal transports may differ, but target
capability manifests state whether `bounded_response_stream_v1` is available
and which named limits are enforced. This RFC's versioned profile is the sole
numeric authority for the limit values today; manifest rows carry limit names
and enforcement status, and typed value/unit fields (or a published profile
digest) are staged work — until they land, a consumer cannot distinguish
profiles by manifest alone. A target that buffers the complete upstream body
before the first application read does not implement this profile.

## Acceptance

Executable evidence must prove:

- a deterministic server sends 16 numbered UTF-8 chunks over at least 800 ms;
- a second client observes at least three authoritative intermediate commits
  before terminal completion;
- the received bytes are ordered, complete, and never duplicated across an
  idempotent retry;
- slow consumption keeps application buffering within 64 KiB;
- total-byte, idle, wall-clock, and progress-rate limits fail with their exact
  codes;
- explicit cancellation closes the upstream reader and prevents every late
  progress commit;
- failed, cancelled, timed-out, and ambiguous attempts remain distinct;
- a cancelled-after-initiation and a timed-out-after-initiation attempt each
  carry the upstream-effect-may-have-executed fact, while a pre-initiation
  `failed` attempt does not;
- reload/reset, authority loss, and watchdog abandonment close cursors and
  preserve the existing late-mutation fence;
- queries and mutations cannot open streams; and
- diagnostics and retained receipts pass secret/private-data scans.

The witness must run through the real action, nested mutation, commit, and
native live-push path. Client animation, a buffered body split after receipt,
logs, or a single terminal replacement cannot pass.

## Evidence status and staged-work ledger

The living record of what is witnessed versus staged, so the Draft does not
overstate itself; new revisions add entries here rather than treating it as a
historical annex. Seeded from the `llp/reviews/0076-*` reviews.

2026-07-23 (baseline landing): the reader-surface implementation this ledger
describes as witnessed previously existed only as uncommitted work in a
non-landed working tree — main itself had no `ctx.fetchStream`, no stream host
ops, and no `bounded_response_stream_v1` registry entry. The gate-2 program
worktree ported the local arm onto main (runtime DTOs/dispatch/envelope, the
detached-host reader with total/idle/wall/read-boundary enforcement and the
nested-mutation rate fence, reviewed HTTP statuses, the instance-live
capability predicate with regenerated committed manifests, codegen admission
requirements, and the harness bridge), applied the decision-4 rename
(`SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED`, fixture updated in the same change
under protocol amendment v0.4), and re-ran the LLP 0075 local-streaming
instrument: PASS 6/6 (three-plus intermediate native-push commits, start-row
idempotency, durable cancellation with zero late patches, idle `timed_out`,
`failed` versus `ambiguous`). The Workerd/Cloudflare arm of the same baseline
remains unlanded (still only in that working tree); every staged gap below is
unchanged by this landing.

Witnessed today: the happy path through the real
action → nested mutation → commit → native-push chain with three-plus
intermediate commits and a blocked negative actor; start-row idempotency;
durable cancellation with the late-patch fence; idle settlement;
failed-versus-ambiguous labels; the total-byte, idle, wall, and progress-rate
codes in unit tests; and on Workerd, pulling, visible chunk size, the
total-byte refusal, and idempotent cancel.

2026-07-24 (gate-2 remainder pass): protocol amendment v0.5 reconciles the
frozen fixture with this authority — the authored pattern adopts the
StreamAttemptV1 control plane and the read-only certainty mirror, the
instrument gains the certainty-mirror check (7/7 PASS), the decision-5
downgrade is recorded, and the generated-CRUD expectations track LLP 0065's
Accepted anti-probing posture. Per-bullet acceptance receipts now exist at
`demos/competitive-checkpoint/acceptance/llp0076-acceptance-receipts.v1.json`,
mapping every §Acceptance bullet to named witnesses per target with three
explicit gaps (the hosted `single-instance-container-vm.v1` receipt, the
author's maturity-marker decision — since resolved 2026-07-24, see the
Revised header and the closed overclaim ledger row — and the Workerd
structural bounds).
Retained checkpoint receipts were scanned for fixture secret values (clean);
durable-row scans on the hosted target ride the hosted receipt. The guide
now covers the surface (`guide/backend/streamed-actions.md`, capability row
`backend.streamed-actions`, maturity `partial`), and the diagnostics' repair
anchor `guide/backend/actions-and-fetch#stream-a-response` resolves
(ENG-25423).

2026-07-25 (first hosted receipt): the decision-7 gate-2 receipt now exists on
`single-instance-container-vm.v1` — the LLP 0075 amendment-v0.6/v0.7 Fly.io
drill target (app `snapback-drill`, one machine, sjc, Tigris backup bucket).
The remote instrument (the seven-check twin of the local one) passed 7/7
against the served origin, the durable-row secret scan over post-run
on-machine SQLite dumps passed with zero findings, the Tigris backup
read-back witnessed byte-exact, and the hosted-auth leg produced its refusal
witness (`SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED` on-machine; no hosted-auth
capability is claimed). Receipts:
`demos/competitive-checkpoint/acceptance/results/{remote-streaming,durable-row-scan,tigris-backup,hosted-auth-refusal}.v0.json`.
Posture caveat in every receipt: `SNAPBACK_PROFILE=test` with
`--allow-insecure-dev-auth` behind the platform TLS edge — a drill posture the
prod profile refuses. The drill surfaced and fixed two defects in the same
landing: the serve path never installed `--allow-insecure-dev-auth` into
request-path state (`crates/snapback/src/cli.rs`, regression-tested), and the fixture's
streamReply handler surfaced the durable-cancel-vs-progress-commit
`SNAPBACK_MUTATION_CONFLICT` race as `failed` instead of reconciling (fixed
under protocol amendment v0.7; the durable row was never wrong — the action
envelope was). The receipt gap closes; gate 2 overall still waits on this
authority's acceptance and the staged items below.

Not yet mechanically witnessed, staged before gate 2 can close: slow-consumer
buffering under the 64 KiB bound (including the exact accounting domain —
host-retained unread bytes versus bridge copies — which must be defined);
an interrupted-stream retry with deliberately different transport
segmentation; physical upstream reader closure on cancellation; active-cursor
closure across reload, authority loss, and watchdog abandonment;
query/mutation `fetchStream` refusal as an executed negative; secret and
private-data scans over stream receipts; and per-bullet receipts mapping each
acceptance item to a named witness.

Known implementation gaps against this authority's contract, each requiring
a fix before gate 2:

- **Per-read authority fence (local arm largely landed 2026-07-24; two named
  residues).** The local read path now revalidates the full predicate —
  abandonment, generation, deadline, and the lock-free process-fence tier of
  the service-authority check — both BEFORE and AFTER awaiting bytes; late
  bytes are discarded (the authority refusal, not the data, reaches the
  action, and the cursor closes), witnessed by a blocked-read
  terminalization-during-read test. The direct attempt-to-cursor
  cancellation signal also landed: a committed terminal settlement closes
  the cursor at the next pull boundary, physically dropping the upstream
  reader, decoupled from progress mutations (witnessed, including an
  observable upstream-socket-close test against an indefinite
  no-more-bytes source; the local in-flight pull drains rather than aborts,
  bounded by the 5 s idle ceiling). Residue: the ServicePrincipal tier's
  end-to-end witness needs the full service-connection fixture (the
  predicate logic is shared with the reviewed
  `validate_prepared_service_authority` process-fence tier, but a
  streamed-action run under real scoped-token authority has not been
  executed — CLOSED 2026-07-24: the witness now exists; a real prepared
  scoped-token authority, a real terminal-gate commit racing a blocked
  pull, late-byte discard with the exact authority code, and pre-open
  refusal are all executed in
  `service_principal_terminalization_fences_stream_open_and_discards_late_bytes`).
  The Workerd leg landed 2026-07-24: reads revalidate the
  action-abandonment signal before AND after the pull, discarding late
  bytes, and on that target the abandonment signal is the complete
  revalidation predicate — hosted auth (and with it scoped-token service
  authority) is `unavailable` on `cloudflare-do-sqlite-v8`, so no
  service-authority tier exists there to check.
- **Trusted terminalizer (landed on the local arm 2026-07-24; residue
  tracked).** The local host now owns a compare-and-set terminalizer with
  three legs: watchdog abandonment (linearized under the commit gate, so no
  progress commit can land after the terminal write), fence-loss completion
  (generation retirement and authority terminalization map to `cancelled` when
  the invocation ends), and authored forfeiture (an action that returns
  without settling gets `failed`). A durable winner therefore always exists
  for every attempt a local invocation opened, and the action receives the
  committed winner verbatim — witnessed by unit, barrier-race, and
  real-action-path tests including a hung-action watchdog witness. Residue:
  the direct attempt-to-cursor cancellation signal (aborting an in-flight
  pull) stays with the per-read-authority-fence ticket, and the Workerd arm
  has no attempt control plane at all.
- **Single-runner lease and retry fencing (landed on the local arm
  2026-07-24; residue tracked).** `StreamAttemptV1` binds an atomic
  single-runner lease at start: a concurrent `start` on the same client key
  receives the same attempt without the lease and cannot commit progress or
  settle; lease takeover requires a dead holder and bumps the runner
  generation; retry after the first durable progress commit is refused at
  cursor bind. `ActionStreamRequest` now carries an optional `attemptToken`
  binding the upstream request as a child cursor. Automatically re-dispatched
  cron invocations (attempt > 1 or recovery trigger) are refused
  `fetchStream` outright — the conservative exclusion stays until resumable
  retry semantics exist. Residue: duplicate-sequence acceptance by byte
  offset and digest remains authored-pattern work, and the frozen LLP 0075
  fixture still uses its legacy authored row (reconciliation rides the
  prospective LLP 0075 amendment noted below); the lease refusal deliberately
  rides the `SNAPBACK_ACTION_STREAM_INVALID` family rather than minting a
  ninth code.
- **Host `initiationState` write-ahead mark (landed on the local arm
  2026-07-24).** The substrate is the `_snapback_stream_attempts` table in
  the instance SQLite: an attempt-bound cursor is durably pre-marked
  `initiation_possible` under a short instance-lock write BEFORE any request
  byte reaches the outbound stack (the open refuses to proceed if the
  pre-mark cannot commit), narrows to `definitely_not_initiated` only on a
  provable pre-send failure (DNS, connection refused, unusable URL), and
  advances to the absorbing `response_observed` on metadata. Hot-path cost:
  at most two short instance-lock upserts per upstream open and none per
  read; terminalizer and close paths flush best-effort (a skipped write
  leaves the conservative on-disk reading). A startup reconciler settles any
  orphaned non-terminal row `failed` with the effect fact folded from the
  persisted cursor pre-marks, witnessed by a two-process-life recovery test.
  The public kernel/engine persistence seam no longer accepts caller-authored
  raw rows: storage verifies an exact signed registry batch against the issuer
  registered when the serving graph is constructed, while the raw-row helper
  exists only under test support. Reconciliation is likewise not a method on
  a live settlement handle: serving adoption consumes a private one-use
  process-death capability and commits the `Terminalizer` classification
  before exposing the handle, leaving the returned summary usable only for
  transcript repair.
  Residue: attempt-less streams (no `attemptToken`) have no durable
  settlement row by design — the authored pattern's adoption rides the
  prospective LLP 0075 amendment; the Workerd arm has no substrate.
- **Host-owned `StreamAttemptV1` record (landed on the local arm 2026-07-24;
  residue tracked).** The runtime now owns the attempt identity, runner
  lease, per-cursor `initiationState`, and terminal cause+certainty in a
  host-owned registry, issuing an opaque token via
  `ctx.streamAttempt.start`/`settle` and binding cursors through the
  request's `attemptToken` (decisions 2 and 3: certainty persists on the host
  record; parent attempt with per-cursor children whose certainty folds
  pessimistically). A durable read may carry the current adoption context so
  it cannot be swapped after that read; because the v1 row stores no
  historical runner identity, this is deliberately not a claim that storage
  proved the supplied context owned the former runner. Residue: the record is process-durable, not yet
  crash-durable — the durable write-ahead substrate rides the
  initiation-state ticket; the Workerd arm has no attempt record; and the
  reference authored pattern does not yet reference the token.
- **Absolute wall-clock enforcement (local arm landed 2026-07-24).** Each
  cursor now owns a dedicated reader thread behind a one-slot rendezvous
  channel: the host's `recv_timeout` against the per-stream wall deadline
  bounds the pull itself, firing mid-read even while the socket read is
  still blocked (witnessed by a blocked-read test that trips the ceiling in
  ~300 ms against a 5 s idle window). Timers are now separate: connect and
  metadata ride the idle window, per-read idle rides the socket timeout,
  and the wall deadline is absolute — computed as
  `min(open + 30 s, watchdog deadline − 2 s settlement grace)`, so a
  default action can reach and durably settle its stream timeout before
  abandonment (witnessed). The Workerd leg landed 2026-07-24: the pull is
  race-bounded by `min(idle, wall remaining)`, so the ceiling fires
  mid-read; that bound is structural (no 30 s witness is retained and no
  wall manifest row is published), and settle grace is meaningless on a
  target without the attempt control plane — both stated in the manifest's
  runtime fact.
- **64 KiB buffer accounting (local arm landed 2026-07-24).** The
  accounting domain is defined as host-materialized bytes per invocation —
  the one queued chunk per cursor plus the handoff copy — summed across
  cursors; kernel/socket buffers are excluded by definition (bounded by the
  TCP window, never application-visible). Enforcement is structural: one
  in-flight 16 KiB pull per cursor (rendezvous channel; an overlapping pull
  is refused, and the shared bridge reader also serializes `read()`) times
  the 4-cursor cap is exactly the 64 KiB ceiling. A real counter witnesses
  it: a four-cursor slow-consumer test records a peak-buffered high-water
  mark under the bound and full ordered delivery. The local manifest's
  buffered-bytes row flips to `Enforced`, with read-size, cursor-cap, and
  wall rows added. The Workerd leg landed 2026-07-24: one in-flight pull
  per cursor is refused structurally, the 16 KiB visible-chunk cap and
  4-cursor cap are witnessed through real workerd, and host-retained
  carry-over is accounted invocation-wide with a 64 KiB refusal path;
  residue: that refusal path is structural, not a witnessed high-water
  counter (stated in the manifest's runtime fact).
- **Capability admission (local arm landed 2026-07-24; sessions drift repaired
  2026-07-29).** Raw dev and direct embedding resolved declared
  `requiredCapabilities` ids (functions and cron jobs) against the served
  instance manifest `/inspect` reports for the exact process. The original
  ledger incorrectly generalized that claim to sessions complete-pair
  provisioning: that preflight still used the static declared manifest and
  refused a stream requirement even when the exact process enabled egress.
  `894ddaf99` makes sessions preflight construct the same process-live
  instance manifest before any handler or nested-mutation code runs.
  Witnessed in both directions: an
  egress-disabled instance refuses a stream-requiring artifact with
  `SNAPBACK_CAPABILITY_UNSUPPORTED` and installs nothing (the
  outbound-disabled negative), and an egress-enabled instance admits the
  same requirement (positive twins in the envelope integration suite and the
  process-isolated sessions regression). The frozen Research Room confirmation
  additionally proves real multi-session progress, cancellation, settlement,
  cron, redaction, and exact cleanup through the repaired composition.
  Codegen inference is now AST-derived via the bundle parser: member access,
  computed string access, and destructuring aliases of `fetchStream` mark
  the module while comments and unrelated strings do not (an unparseable
  bundle falls back to the conservative textual scan, which can only
  over-require). The Workerd admission leg landed 2026-07-24: this target
  is deploy-time compiled, so `/app/ensure` only hash-gates posted
  artifacts and never installs them; the loader seam is function
  resolution, and `functionByName` now refuses any known registry id the
  served manifest does not support with a typed 503
  `SNAPBACK_CAPABILITY_UNSUPPORTED` before the handler runs — witnessed
  positively (the stream probes declare the capability and run) and
  negatively (a probe declaring `auth.sessions.v1` is refused) through
  Miniflare. No admission residue remains on either target.
- **Two-axis settlement (host side landed on the local arm 2026-07-24;
  authored-pattern side open).** The host-owned attempt record now carries
  `terminalCause` plus the orthogonal `effectMayHaveExecuted` certainty
  (decision 2), derived from the write-ahead cursor pre-marks and returned to
  the action on every start/settle — the host-exposed initiation fact exists.
  Witnessed: cancelled-after-initiation and timed-out-after-initiation carry
  the effect fact while a provable pre-initiation `failed` does not (host
  tests), and the crash path folds conservatively (recovery test). Open: the
  reference authored pattern's durable row is still single-status — its
  mirror of the certainty rides the prospective LLP 0075 amendment — and the
  frozen fixture's `requiredSettlementKinds` stays the five kinds unchanged
  (the certainty is retained evidence, not a sixth kind).
- **Secret scrubbing on streamed fetch (local arm landed 2026-07-24; hosted
  descriptor seam open).** On the local value-mode profile a streamed request
  now places secrets exactly the way an ordinary action does — staged values
  via `ctx.secrets` handles, with the LLP 0036 staged-value redactor applied
  to every stream error envelope — witnessed through the real HTTP action
  path in both directions: a handler that rethrows a refusal with the secret
  embedded surfaces only `[REDACTED]`, and an untouched structured stream
  refusal with the secret in the URL and headers stays value-free (no secret,
  no URL structure). `ctx.fetchStream` also accepts the same
  `secretSlots` placement shape as ordinary host-mediated fetch and forwards
  descriptors opaquely; the local profile refuses descriptor slots with a
  typed diagnostic (they resolve only at a hosted fetch boundary — the same
  posture as local `ctx.fetch`, which has no host-fetch op at all). The
  hosted descriptor seam landed 2026-07-24: the coordinator resolves stream
  secret slots at its own open boundary exactly like ordinary host-mediated
  fetch, returns the handler-authored URL (never the substituted one), and
  the Miniflare witness proves the placement authenticates the upstream
  while the resolved value never re-enters the isolate or the action
  result. Residue: secret/private-data scans over RETAINED stream receipts
  (durable rows) remain with the acceptance-receipts work.
- **Positive capability overclaim (closed 2026-07-24).** The substance was
  resolved earlier (host-enforced terminal/lease guarantees, genuinely
  enforced and witnessed limit rows, honest manifests on both targets); the
  final residue — the maturity marker — is now decided and implemented per
  Charlie's 2026-07-24 decision: the LLP 0058 registry carries a code-owned
  maturity dimension (§Capability maturity there), every served manifest
  emitting `bounded_response_stream_v1` annotates it `experimental` in the
  additive `capabilityMaturity` map, and admission on both arms treats the
  entry as *not plain support* — a requirement admits only when the artifact
  acknowledges the experimental contract via
  `acknowledgedExperimentalCapabilities`, which codegen emits from the same
  closed table it derives requirements from. LLP 0074's no-plain-claim rule
  for Draft authorities is therefore satisfied structurally, not just by
  witnesses. Promotion to `stable` is part of this RFC's acceptance act and
  breaks no artifact (acknowledgments become no-ops). Named witness residue:
  the Workerd arm's unacknowledged-refusal negative is code-shared with its
  witnessed supported-set refusal rather than separately deployable (one
  bundle cannot be both acknowledged and unacknowledged); the local arm
  witnesses both directions through the real loader.
- **Diagnostic envelope coverage (local arm landed 2026-07-24).** All nine
  promised codes — the eight stream families plus
  `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` — now survive both the runtime and
  harness envelope allowlists, and `SNAPBACK_CAPABILITY_UNSUPPORTED` stays a
  distinct code with its own reviewed status. The structured representation
  survives the JS round-trip via an out-of-band host recorder: the last
  host-built stream refusal is restored at result assembly when the surfaced
  code matches, so operation/expected/received/repair reach the action
  result; a handler-authored throw that merely spells a stream code folds to
  `SNAPBACK_HANDLER_FAILED` (the settle wrapper trusts only the
  `__snapbackCode` brand) — both witnessed through the real HTTP action path
  (`crates/snapback/tests/action_stream_envelope_v0.rs`), along with the mutations-cannot-
  stream executed negative. Raw serde parser text no longer enters stream
  diagnostics. Residue: the Workerd handler transport still discards
  structured details (unlanded Workerd baseline), and per-family HTTP-path
  shape witnesses beyond INVALID ride the existing unit and instrument
  coverage.
- **Cross-authority accuracy (largely resolved).** The Workerd manifest
  now claims only what its witness earns (2026-07-24: witness-bounded
  runtime fact, six enforced rows, no wall row); the retained local witness
  alias defect was fixed by the LLP 0075 instrument corrections (identity
  derived from the served manifest). Remaining: the Workerd open path's
  Begin/Initiated cut versus LLP 0059's normalize-before-Begin rule —
  moot in practice on this target (no service-authority fence exists
  there), revisit if hosted auth reaches the Cloudflare profile.

The reference-fixture reconciliation is done: protocol amendment v0.5
(2026-07-24) adopts the attempt token as the fence-critical identity keyed
by the server-issued authored attemptId, scopes the generated-reference-only
rule to the client arm (nested host-side `ctx.runMutation`-by-name is the
shipped server authoring surface), and authorizes the seven-check
instrument.

2026-07-25 (acceptance): the gate-2 hosted receipt landed (protocol
amendment v0.7 — the Fly.io `single-instance-container-vm.v1` drill: remote
instrument 7/7 against the served origin, durable-row secret scan PASS over
on-machine dumps, Tigris backup byte-exact read-back, hosted-auth refusal
witness; posture caveat recorded in every receipt), and Charlie Cheever
ratified this RFC as **Accepted**. The registry flip to `stable` landed in
the same change: `bounded_response_stream_v1` left the non-stable maturity
table (crates/snapback/src/manifest.rs), codegen's mirror set, the committed schemas
variants, the served Workerd manifest, and every regenerated demo artifact;
the former unacknowledged-refusal integration witness was converted to the
promotion regression (an unacknowledging artifact now admits), and the
still-experimental refusal path stays witnessed via `relational_query_v1`.
Residues that remain open and recorded: OQ 6 and 7, and the Workerd arm's
narrower witness (no `ctx.streamAttempt` control plane, fail-closed).

## Non-goals

- streaming an action's HTTP response directly to its caller;
- WebSocket, SSE, upload, or bidirectional streaming APIs. v1 consumes the
  raw bytes of any HTTP(S) response, including a `text/event-stream` body, as
  an opaque byte stream; it provides no SSE event framing, `id`/`retry`
  reconnect semantics, or WebSocket/upload/bidirectional surface. The v1
  commitment is precisely a bounded, pull-driven, action-only *response-byte*
  reader over an absolute HTTP(S) URL — not a general streaming API;
- arbitrary action-to-action pipes;
- exactly-once upstream effects;
- durable execution or resumable cursor ownership across process death; or
- widening query/mutation network authority.

## Prior art: InstantDB Streams (added 2026-07-23, LLP 0086 CC-5)

This section is additive comparison, not contract. It positions the design
above against InstantDB's Streams primitive — storage-backed, offset-resumable,
single-writer channels aimed at LLM token UX, with rules default-closed
([LLP 0082](./0082-instantdb.research.md) §Ephemeral state) — a shipped
external answer to the same seam. It changes no normative text and resolves
none of the open questions below; where an axis maps onto one, the open
question is named. Instant's Streams is a *client-facing persisted-realtime
channel*; LLP 0076 is a *server-side bounded byte reader* whose client-visible
output is ordinary authoritative live-query commits (see Summary). Several
dispositions follow from that architectural difference rather than from
disagreement about any single property.

- **Resumability model.** Instant: streams are backed by storage and never
  expire; a reader can pick up from any offset and resume (LLP 0082
  §Ephemeral state). LLP 0076: durable execution and resumable cursor
  ownership across process death are explicit non-goals (§Non-goals); retry
  is permitted only before the first durable progress commit, because
  transport re-segmentation could bind a sequence number to different bytes
  (§Settlement and retry). The resume anchor here is the durable progress
  row the pattern already committed — clients re-observe committed state, not
  a stream offset. **Disposition: reject for v1, as a named divergence** —
  offset-resumability of the upstream byte stream is exactly what the
  no-retry-after-first-commit rule refuses, and the crash-safety burden moves
  to the write-ahead `initiationState` and trusted terminalizer instead.
  Whether durable jobs later persist resumable upstream cursor metadata is
  **deferred to open question 3**; Instant's design is evidence that the
  storage-backed variant is buildable, not that this RFC adopts it.
- **Writer discipline.** Instant: one writer per `clientId` (LLP 0082
  §Ephemeral state). LLP 0076: one reader owns a body (§Surface), and every
  attempt binds an atomic single-runner lease — a runner-generation token
  under which alone progress and terminal mutations commit, so two runners
  can never splice differently segmented bytes (§Settlement and retry,
  "Single-runner lease"). **Disposition: already-equivalent** in intent, with
  a stronger enforcement point: 0076 fences the writer inside the durable
  transaction rather than by connection identity. Honestly stated, the lease
  is specified contract but unimplemented — tracked in the staged-work ledger
  ("Single-runner lease and retry fencing").
- **Authorization defaults.** Instant: Streams rules are default-closed —
  notably the opposite of Instant's own namespace default-allow (LLP 0082
  §Ephemeral state, §Permissions). LLP 0076: streams are default-closed by
  construction — only actions receive `ctx.fetchStream` (queries and
  mutations cannot open streams, witnessed as an acceptance negative), the
  capability is target-gated via `bounded_response_stream_v1` admission, and
  there is no client-readable stream object to authorize at all: clients see
  only live-query commits under Snapback's ordinary fail-closed
  authorization. **Disposition: already-equivalent** on the default, reached
  by removing the client-facing surface rather than by closing rules over
  one. The capability-admission implementation gap (one loader path
  over-admits) is already in the staged-work ledger and is unchanged by this
  comparison.
- **Retention.** Instant: "because streams are backed by storage, they never
  expire" — unbounded retention as an infrastructure default (LLP 0082
  §Ephemeral state). LLP 0076: bounded by profile — 1 MiB total response
  bytes, 64 KiB application-visible buffering, 30 s wall clock (§Surface) —
  and what persists is only what the authored progress pattern deliberately
  commits to durable rows, which then carry secret/private-data scan
  obligations (§Acceptance). **Disposition: reject** — unbounded
  infrastructure-level retention of raw stream bytes is contrary to this
  RFC's bounded-profile premise; retention is an application-level decision
  expressed as durable commits. How the byte bounds are measured (wire vs.
  decoded vs. retained copies) remains **open question 7**, but that governs
  accounting, not the bounded-versus-unbounded disposition.

## Author decisions — 2026-07-23

Recorded by the author (Charlie Cheever) against
`issues/20260723-llp0076-semantics-decisions.md`; each resolves the numbered
open question below. Outcome-affecting requirement changes additionally owe a
prospective LLP 0075 / `protocol.v0.json` amendment when their implementation
ticket lands (noted per item). None of these is implemented by this revision;
the Evidence-status ledger stays authoritative for what exists.

1. **`ambiguous` (OQ4a) — kept, precisely defined.** `ambiguous` remains a
   first-class terminal settlement kind denoting exactly: a non-idempotent
   request (no verified idempotency declaration and not a safe method) that
   reached `initiation_possible` and produced no provable terminal outcome —
   the one kind whose effect fact can never be refined by evidence. It is not
   a compatibility alias; `failed` continues to require provable
   non-completion of the transport phase.
2. **Certainty persistence (OQ4b) — host-owned attempt record.** The
   effect-certainty column is persisted on the host-owned `StreamAttemptV1`
   record (the row that owns the terminalizer and lease). Authored progress
   rows MAY mirror it read-only; the host record is the authority the
   late-effect fence reads.
3. **Attempt shape (OQ10) — parent attempt plus per-cursor children.** Each
   upstream request (cursor) gets a child record carrying its own
   `initiationState` and certainty; the parent attempt owns settlement and
   lease, and its certainty is the pessimistic fold of its children.
4. **Progress-rate code (OQ5) — renamed now.**
   `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` is the host-owned, profile-neutral
   code. The reference fixture's authored
   `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` is updated by the implementation
   ticket in the same change (prospective protocol note rides with it; the
   retained receipt does not name the code, so nothing frozen breaks).
5. **Idempotency (OQ2) — declaration or downgrade.** Safe methods (GET/HEAD)
   are idempotent by grammar. A non-GET request earns retry semantics only
   through a deployment-pinned provider idempotency declaration (provider
   identity, key header, scope) verified by the host, which binds the
   effective key and a canonical request digest into the attempt record. A
   bare authored `upstreamIdempotent` assertion no longer confers idempotency:
   such requests are treated as non-idempotent and settle `ambiguous` when
   unprovable. (Outcome-affecting: prospective protocol amendment rides the
   implementation ticket; the frozen fixture is behaviorally unaffected — its
   GET leg is idempotent by method, its POST leg already asserts false.)
6. **Progress clock (OQ8) — monotonic `elapsedMs` on every read.** Every
   stream read result carries host-owned monotonic elapsed milliseconds since
   attempt start (plus per-chunk delta). Authored code gates its progress
   commits on that value; the host rate refusal stays as the enforcement
   backstop. No new ambient time primitive is added to the runtime surface.
7. **Gate-2 adapter (OQ9) — `single-instance-container-vm.v1`.** The LLP 0074
   gate-2 receipt is produced on LLP 0075's selected hosted target. Cloudflare
   remains a narrow proof and is not gate-bearing. Gate 2 therefore also
   waits on the 0075 program-ownership decision that picks the concrete
   provider for the first remote drill.
8. **Surface deferrals (OQ1, OQ3) — both deferred with named triggers.** v1
   keeps the small pull-reader contract, and durable jobs restart only at
   provider-defined idempotent boundaries. Reopen triggers: a concrete
   consumer requiring pipe/tee semantics reopens OQ1; a provider with
   verified range-resume semantics plus the OQ2 declaration mechanism reopens
   OQ3.

## Open questions

1. *(Resolved 2026-07-23 — deferred with a named trigger; see §Author decisions item 8.)* Does a later profile adopt the complete Web `ReadableStream` surface or keep
   this smaller reader contract?
2. *(Resolved 2026-07-23 — declaration-or-downgrade; see §Author decisions item 5.)* Which provider idempotency-key declarations can make non-GET retries
   machine-checkable rather than authored assertions?
3. *(Resolved 2026-07-23 — restart at idempotent boundaries only; see §Author decisions item 8.)* Should durable jobs persist resumable upstream cursor metadata, or restart
   only at provider-defined idempotent boundaries?
4. *(Resolved 2026-07-23 — kept and precisely defined; certainty persists on the host attempt record; see §Author decisions items 1-2.)* What exact fact does `ambiguous` add beyond effect-may-have-executed once
   the two axes are separated? (The host *derives* the certainty via the
   `initiationState` write-ahead mark — that is settled; the open part is only
   which layer *persists* the certainty column, the host-owned attempt record
   or the authored progress row.)
5. *(Resolved 2026-07-23 — renamed to `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED`; see §Author decisions item 4.)* Is `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` renamed to a profile-neutral
   host code before it becomes load-bearing in retained receipts?
6. Are authenticated secret-bearing AI-provider streams in v1 on every claimed
   target, and through the same opaque-placement seam as ordinary fetch?
7. Are the 1 MiB and 64 KiB bounds measured on wire bytes, decoded bytes, or
   all retained VM/bridge copies, and how are concurrent cursors charged?
8. *(Resolved 2026-07-23 — monotonic `elapsedMs` on every read result; see §Author decisions item 6.)* Which supported monotonic elapsed-time source or host progress helper lets
   an action obey the 100 ms spacing without a wall clock?
9. *(Resolved 2026-07-23 — `single-instance-container-vm.v1`; see §Author decisions item 7.)* Which hosted adapter produces the gate-2 receipt now that Cloudflare is a
   narrow proof and LLP 0075 selected `single-instance-container-vm.v1`?
10. *(Resolved 2026-07-23 — parent attempt with per-cursor child records; see §Author decisions item 3.)* Does one durable attempt cover all four concurrent cursors, or does each
    upstream request get a child record under a parent attempt? A single
    scalar `initiationState`/certainty cannot represent four cursors in
    different phases.
