# LLP 0076: Bounded streamed actions

**Type:** RFC
**Status:** Draft
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-23 (third model-family review round — Fable NOT READY,
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
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  batch.push(...value);
  // Coalesce so durable commits stay under the 100 ms minimum spacing; a
  // per-chunk commit against the witness cadence (chunks every 80 ms; the
  // fixture floor is ~50 ms) would trip SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED.
  // shouldFlush() gates on >=100 ms elapsed since the last commit.
  if (shouldFlush()) { await ctx.runMutation('applyProgress', { attemptId, bytes: batch }); batch = []; }
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
  must space commits (the `shouldFlush()` in the example gates on elapsed time
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
cut. Every open/read/cancel operation revalidates the exact action invocation,
app generation, service authority, and watchdog deadline. A cursor is opaque,
random, invocation-local, and never accepted by another action.

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
exactly as a mid-body loss does. The single cause enum alone would let
`timed_out` and `cancelled` silently drop the uncertainty that `ambiguous`
and mid-body `failed` preserve. This second axis is a normative v1
requirement that the reference pattern's single-status row does not yet carry;
it is recorded as an implementation gap below, and it needs a host-exposed
`initiated` fact so the axis is host-derived rather than author-inferred (the
authored mutation cannot otherwise know a timeout-before-metadata request
reached the wire). Resolution of the uncertainty is LLP 0070's
lookup/idempotency path, never a silent retry.

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
- **Trusted terminalizer.** Cursor closure is host-owned, but durable terminal
  settlement is left to an authored mutation. After generation retirement,
  service-authority terminalization, or watchdog abandonment the abandoned
  action cannot commit, so the attempt row can remain `running` with no
  durable winner to return. The contract requires a trusted compare-and-set
  terminalizer or lease-expiry reconciler and a direct attempt-to-cursor
  cancellation signal, raced for every lifecycle cause.
- **Retry fencing.** `ActionStreamRequest` carries no attempt identity or
  execution generation, and the reference `startReply` returns the same
  attempt to concurrent callers without a single-runner lease, so two callers
  can reopen the upstream request before either commits progress. The contract
  requires distinct client-operation-key / Snapback-attempt-id / provider-key
  identities, an atomic single-runner lease binding every progress and
  terminal mutation, and duplicate-sequence acceptance only when byte offset
  and digest agree.
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
- WebSocket, SSE, upload, or bidirectional streaming APIs;
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
   the two axes are separated, and does the host or the authored pattern own
   the effect-certainty channel?
5. Is `SNAPBACK_REPLY_PROGRESS_RATE_EXCEEDED` renamed to a profile-neutral
   host code before it becomes load-bearing in retained receipts?
6. Are authenticated secret-bearing AI-provider streams in v1 on every claimed
   target, and through the same opaque-placement seam as ordinary fetch?
