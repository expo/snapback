# LLP 0076: Bounded streamed actions

**Type:** RFC
**Status:** Draft
**Systems:** Actions, Runtime, Outbound fetch, Durable mutations, Diagnostics, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-22
**Revised:** 2026-07-23 (first model-family review round — Fable NOT READY,
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
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  await ctx.runMutation('applyProgress', { attemptId, bytes: [...value] });
}
```

`value` is a `Uint8Array`. Only one reader may own a body. `read()` is
pull-driven: the host obtains at most one bounded chunk because the reader
asked, so application backpressure is the default. `cancel(reason)` closes the
host cursor idempotently. Dropping or finishing the action closes every cursor
owned by that invocation.

The first profile uses these enforced maxima, matching LLP 0075's frozen
fixture:

- 1 MiB total response bytes;
- 64 KiB application-visible buffered bytes, with a host read size no greater
  than 16 KiB;
- 30 seconds from stream open through terminal read, further bounded by the
  action watchdog;
- 5 seconds without a delivered byte;
- 10 durable progress commits per second for the durable progress pattern;
  and
- at most 4 concurrently open cursors per action invocation.

These are v1 profile limits, not claims about an eventual general-purpose
streaming API. A later profile may widen them only prospectively with its own
resource and abuse evidence. Limits are checked at read boundaries: a
blocking read that begins inside the wall-clock budget may overshoot it by up
to the idle window before the next check fires. The reader also supports
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
mutation that skips the terminal-row check forfeits that guarantee. This is
the one obligation an application author must not get wrong.

Settlement classification is by host-provable phase, and ambiguity strictly
over-approximates: an upstream failure the host can prove preceded request
initiation is `failed`; for a non-idempotent request, any transport failure
the host cannot prove preceded initiation is `ambiguous`, and the runtime
must not silently retry it. Mid-body transport loss after response metadata
on a non-idempotent request settles `failed` while the durable row records
that the upstream effect executed. Exhausting the idle or wall limit is
`timed_out`. An explicitly cancelled reader is `cancelled`. Where the
action's local inference and the durable row's committed terminal state
disagree — for example a cancellation/timeout race — the durable winner is
authoritative and the action must return it.

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

`SNAPBACK_ACTION_STREAM_CANCELLED` names the cancellation reason surfaced on
reads after cancellation; explicit `cancel()` itself succeeds idempotently
rather than erroring.

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
- reload/reset, authority loss, and watchdog abandonment close cursors and
  preserve the existing late-mutation fence;
- queries and mutations cannot open streams; and
- diagnostics and retained receipts pass secret/private-data scans.

The witness must run through the real action, nested mutation, commit, and
native live-push path. Client animation, a buffered body split after receipt,
logs, or a single terminal replacement cannot pass.

## Evidence status and implementation gaps (2026-07-23)

Recorded from the `llp/reviews/0076-*` round-1 reviews so the Draft does not
overstate its witnesses. Witnessed today: the happy path through the real
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
a fix before gate 2: the local host-op validation checks abandonment,
generation, and deadline but not service authority, and a blocking read has
no post-read revalidation before exposing bytes; capability admission is
inconsistent — the raw dev loader installs a stream-requiring artifact
without resolving `require_capabilities`, while complete-pair preflight
checks a static declaration instead of the live instance manifest; the
Workerd open path's Begin/Initiated cut does not visibly match LLP 0059's
normalize-before-Begin rule; the Workerd manifest claims idle, wall,
progress-rate, watchdog, and typed-settlement evidence its witness does not
earn; and the retained local witness still hardcodes the retired
`local-ibex-sqlite.v1` target alias that LLP 0075's protocol amendment
prohibits, so it must derive identity from the served manifest and rerun
prospectively.

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
