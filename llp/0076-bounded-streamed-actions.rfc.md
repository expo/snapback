# LLP 0076: Bounded streamed actions

**Type:** RFC
**Status:** Draft
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-23 (fifth model-family review round — Fable NOT READY
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
**Related:** LLP 0004, LLP 0008, LLP 0009, LLP 0028, LLP 0036, LLP 0058, LLP 0059, LLP 0063, LLP 0070, LLP 0074, LLP 0075

## Summary

Snapback actions should consume an upstream HTTP response incrementally without
granting direct database access, retaining unbounded bytes, or allowing a late
continuation to write after cancellation, timeout, deployment change, or
authority loss. This RFC defines a narrow v1 streaming profile and the durable
progress pattern required by LLP 0074. It does not turn an action result into a
streaming client response: clients continue to observe ordinary authoritative
live-query commits.

This document is Draft. Implementation and evidence may proceed, but gate 2
cannot be called closed until this authority is reviewed and accepted.

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
  // SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED. A host-provided progress helper that
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

Classification currently keys on whether the request carries an idempotency
key: a keyed non-GET is treated as idempotent-class and a transport failure on
it settles `failed`, not `ambiguous`. That is the author's assertion that the
provider recognizes the key, not a machine-checked fact (open question 2), and
it is why an unrecognized key can under-report uncertainty. Making key
recognition a trusted, provider-founded declaration — after which only a
recognized key downgrades `ambiguous` to `failed` — is the intended
direction, tracked as a gap.

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
`SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` as a conservative transport-level
guard; the pattern's own row-level throttle reuses the same code for the
application commit protocol. The shared, fixture-flavored name is a v1
compromise; whether it is renamed before the code becomes load-bearing in
receipts is an open question.

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
historical annex. Seeded from the `llp/reviews/0076-*` reviews. Witnessed today: the happy path through the real
action → nested mutation → commit → native-push chain with three-plus
intermediate commits and a blocked negative actor; start-row idempotency;
durable cancellation with the late-patch fence; idle settlement;
failed-versus-ambiguous labels; the total-byte, idle, wall, and progress-rate
codes in unit tests; and on Workerd, pulling, visible chunk size, the
total-byte refusal, and idempotent cancel.

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

- **Per-read authority fence.** Local host-op validation checks abandonment,
  generation, and deadline but not service authority, and a blocking read has
  no post-read revalidation before exposing bytes; Workerd checks only before
  the operation. An authority terminalization that lands during a blocked read
  can still return bytes. The contract requires an exact permit held through
  pull and byte handoff, or an equivalent fenced post-pull check.
- **Trusted terminalizer (specified above; unimplemented).** The contract now
  requires a trusted compare-and-set terminalizer or lease-expiry reconciler
  and a direct attempt-to-cursor cancellation signal, raced for every
  lifecycle cause. The reference pattern still leaves durable terminal
  settlement to an authored mutation that cannot run once the action is
  abandoned, so the attempt row can remain `running`; closing this is required
  before gate 2.
- **Single-runner lease and retry fencing (specified above; unimplemented).**
  `ActionStreamRequest` carries no attempt identity or execution generation,
  and the reference `startReply` returns the same attempt to concurrent
  callers without a lease, so two callers can reopen the upstream request
  before either commits progress. The contract requires distinct
  client-operation-key / Snapback-attempt-id / provider-key identities, the
  atomic single-runner lease binding every progress and terminal mutation, and
  duplicate-sequence acceptance only when byte offset and digest agree. Until
  it lands, automatically retried cron/LLP 0070 durable invocations are
  excluded from streamed actions.
- **Host `initiationState` write-ahead mark (specified above; unimplemented).**
  The host does not yet durably pre-mark `initiation_possible` before the send
  or expose the three-state `initiationState`; today the open path infers
  retry-safety from method/idempotency-key alone. The write-ahead mark is what
  makes the effect-certainty axis crash-safe and transport-agnostic.
- **Host-owned `StreamAttemptV1` record (specified above; unimplemented).**
  `ActionStreamRequest` carries no attempt token, and the reference progress
  schema owns the status field itself; the fence-critical fields must move to
  a host-owned attempt record with an opaque token so the trusted terminalizer
  and lease can act after the authored action is gone.
- **Absolute wall-clock enforcement.** The local host bounds the upstream
  request timeout at the idle window and checks the wall limit only at read
  boundaries, so a productive stream can fail near 5 s and be mislabeled, and
  the 30 s ceiling is not enforced as an absolute bound on the read itself.
  Separate overall, idle, connect, and per-read timers are required.
- **64 KiB buffer accounting.** The accounting domain is undefined and the
  local host has no buffered-byte counter at all (only Workerd enforces a
  per-chunk bound); the shared reader permits unlimited concurrent `read()`
  calls from its single owner. The contract must define per-cursor-versus-
  invocation scope and which host/bridge/VM/network queues count, serialize
  pulls per cursor, and mark the manifest row non-enforced until a
  slow-consumer witness passes.
- **Capability admission.** The raw dev loader installs a stream-requiring
  artifact without resolving `require_capabilities`, while complete-pair
  preflight checks a static declaration instead of the live instance
  manifest — one path over-admits with egress disabled, the other
  under-admits when egress is enabled. Both must resolve against the same
  served instance manifest before any handler runs, with an
  outbound-disabled negative admission witness. Codegen inference is also a
  textual `fetchStream(` match; an AST-derived or explicit function
  capability would close the alias gap.
- **Two-axis settlement.** The durable row carries only a single status
  today; the required orthogonal upstream-effect-certainty axis is
  unimplemented in the reference pattern and both hosts, there is no
  host-exposed `initiated` fact for the authored mutation to read, and the
  fixture's `requiredSettlementKinds` is single-axis. The host must expose the
  initiation fact and the pattern must record the certainty, with the
  acceptance bullet above witnessing it, before gate 2.
- **Secret scrubbing on streamed fetch.** `ctx.fetchStream` forwards raw URL,
  headers, body, and key and performs none of the LLP 0036 opaque-descriptor
  resolution and value-aware redaction that ordinary `ctx.fetch` does, so a
  secret-bearing streamed request to an AI provider cannot yet place a secret
  the way an ordinary action can. v1 must add the same per-function opaque
  placement seam to streamed requests and witness it (excluding secret-bearing
  streams instead would gut the intended AI-provider use case).
- **Positive capability overclaim.** `bounded_response_stream_v1` is published
  as a positive `supportedCapabilities` entry — which LLP 0058 reads as
  present server support and LLP 0074 forbids for a Draft authority without
  executable conformance — while the pattern's terminal, throttle, and retry
  guarantees are not host-enforced; the manifest also marks buffered-bytes
  `Enforced` with no accounting and omits the read-size and cursor limits, and
  the Cloudflare runtime fact claims idle/wall/progress/watchdog/settlement
  evidence its witness does not earn. Until conformance the capability should
  carry a proposed/experimental maturity admission cannot treat as support,
  and unproved limit rows should read `Missing`.
- **Diagnostic envelope coverage.** `SNAPBACK_ACTION_STREAM_UNSUPPORTED` and
  the host rate-fence code are absent from the handler-envelope allowlists and
  can fold to `SNAPBACK_HANDLER_FAILED`; every promised code must survive both
  envelopes, and capability-admission refusal
  (`SNAPBACK_CAPABILITY_UNSUPPORTED`) must stay distinct from runtime
  `_UNSUPPORTED`.
- **Cross-authority accuracy.** The Workerd open path's Begin/Initiated cut
  does not visibly match LLP 0059's normalize-before-Begin rule; the Workerd
  manifest claims idle, wall, progress-rate, watchdog, and typed-settlement
  evidence its witness does not earn; and the retained local witness still
  hardcodes the retired `local-ibex-sqlite.v1` target alias that LLP 0075's
  protocol amendment prohibits, so it must derive identity from the served
  manifest and rerun prospectively.

The reference fixture also uses string mutation names and a client-key start
dedup, which a prospective LLP 0075 amendment must reconcile with that Spec's
generated-reference-only rule and server-issued attempt-identity wording
before the checkpoint reruns.

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

## Open questions

1. Does a later profile adopt the complete Web `ReadableStream` surface or keep
   this smaller reader contract?
2. Which provider idempotency-key declarations can make non-GET retries
   machine-checkable rather than authored assertions?
3. Should durable jobs persist resumable upstream cursor metadata, or restart
   only at provider-defined idempotent boundaries?
4. What exact fact does `ambiguous` add beyond effect-may-have-executed once
   the two axes are separated? (The host *derives* the certainty via the
   `initiationState` write-ahead mark — that is settled; the open part is only
   which layer *persists* the certainty column, the host-owned attempt record
   or the authored progress row.)
7. Are the 1 MiB and 64 KiB bounds measured on wire bytes, decoded bytes, or
   all retained VM/bridge copies, and how are concurrent cursors charged?
8. Which supported monotonic elapsed-time source or host progress helper lets
   an action obey the 100 ms spacing without a wall clock?
9. Which hosted adapter produces the gate-2 receipt now that Cloudflare is a
   narrow proof and LLP 0075 selected `single-instance-container-vm.v1`?
5. Is `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` renamed to a profile-neutral
   host code before it becomes load-bearing in retained receipts?
6. Are authenticated secret-bearing AI-provider streams in v1 on every claimed
   target, and through the same opaque-placement seam as ordinary fetch?
