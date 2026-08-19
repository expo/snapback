---
title: Streamed actions
id: backend.streamed-actions
order: 35
audience: agent-first
capabilities: [backend.streamed-actions]
authorities: [llp/0076-bounded-streamed-actions.rfc.md, llp/0075-convex-checkpoint-protocol.spec.md, crates/snapback-sync/src/stream_attempt.rs, crates/snapback-server/src/server.rs, packages/snapback-harness/ctx-bootstrap.js, demos/competitive-checkpoint/snapback/handlers.mjs, cloudflare/app/all-aboard.app.js]
examples: [demos/competitive-checkpoint, cloudflare/test/acceptance.egress.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-03
reviewed-authorities-digest: sha256:e0fd6cecbea08f7ee19b849395320ffc839983a8c3e87af1635f502f1c53bf8d
---

# Streamed actions

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

`ctx.fetchStream` lets an **action** consume an upstream HTTP(S) response
incrementally — an AI provider's token stream, a large export — without
granting database access, retaining unbounded bytes, or letting a late
continuation write after cancellation. It is a bounded, pull-driven,
action-only *response-byte* reader, not a general streaming API: clients
never see a stream object. They observe ordinary authoritative live-query
commits that your nested mutations produce
([LLP 0076](repo:llp/0076-bounded-streamed-actions.rfc.md) is the semantic
authority, **Accepted** 2026-07-25; its evidence ledger is the honest
record).

**What is witnessed where** (`maturity: partial` made concrete): the full
surface on this page — reader, limits, attempt control plane, crash-safe
settlement — is implemented and witnessed on the local target. The Workerd
target passes a narrower Miniflare witness (pull/chunk/total/cancel/idle,
progress-rate and cursor caps, secret placement) but has **no
`ctx.streamAttempt` control plane** — it refuses attempt tokens fail-closed.
The gate-bearing hosted receipt exists (the 2026-07-25 Fly.io
`single-instance-container-vm.v1` drill; protocol amendment v0.7), and the
capability is **stable** in the LLP 0058 registry since LLP 0076's
acceptance; admission is decided by the **served instance manifest**, never
by this page.

## Require the capability and enable egress

A streamed action needs the same egress enablement as ordinary outbound
fetch (`SNAPBACK_OUTBOUND_ACTIONS=1`), and its artifact must be admitted by
a target whose served manifest supports `bounded_response_stream_v1`.
Codegen selects the outbound-actions capability-manifest variant only when
that variable is set; the base local manifest declares
`bounded_response_stream_v1` as a gap, so generation without it fails with
`SNAPBACK_CAPABILITY_UNSUPPORTED`.
Codegen detects `ctx.fetchStream` in your handler (AST-derived — aliases and
destructuring count, comments do not) and adds the requirement to the
function manifest; every loader then resolves it against the live `/inspect`
manifest before any handler runs. An egress-disabled instance refuses the
artifact with `SNAPBACK_CAPABILITY_UNSUPPORTED` at load, not at first use.

The capability is **stable** (LLP 0076 Accepted 2026-07-25), so positive
presence in the served manifest is the plain compatibility assertion — no
acknowledgment is needed. Artifacts generated while the id was
`experimental` still carry it in `acknowledgedExperimentalCapabilities`;
that entry is a harmless no-op (acknowledging a stable id never refuses), so
pre-promotion artifacts keep admitting unchanged. The experimental-maturity
admission rule itself (LLP 0058 §Capability maturity) still applies to ids
that remain experimental; `relational_query_v1` and `migration_keyset_scan_v1`
have since been promoted too (LLP 0080/0081 flipped Implemented 2026-07-26),
and the served manifest's `capabilityMaturity` map is the authoritative
current list (`vector_search_v1`, `jobs_one_off_v1`, the asset ids, and
others).

## Consume the body with one pull-driven reader

One reader owns the body. Each `read()` pulls at most one host-bounded chunk
(≤ 16 KiB), so application backpressure is the default — the host never
buffers ahead of you beyond one in-flight chunk per cursor:

```js source=cloudflare/app/all-aboard.app.js
    const reader = response.body.getReader();
    let reads = 0;
    let totalBytes = 0;
    let maxChunkBytes = 0;
    let checksum = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      reads += 1;
      totalBytes += chunk.value.byteLength;
```

`chunk.value` is a `Uint8Array`. `for await` async iteration delegates to
the same `read()`. `cancel()` is idempotent; a read after cancellation
returns `{ done: true }`, not an error. `releaseLock()` deliberately
deviates from the Web reader contract: it throws unless the stream reached
EOF or was cancelled. Overlapping `read()` calls on one cursor are refused —
one pull in flight per cursor is the profile, not a suggestion.

Every read result also carries the host-owned monotonic progress clock:
`elapsedMs` since the stream opened and `deltaMs` since the previous byte.
Use it to space durable commits — actions have no `Date.now()`, and
`ctx.runtime.now` is fixed per invocation.

## Own the attempt with the host control plane

Durable streamed work should be keyed by a host-owned **attempt**: the host
record owns the single-runner lease, the crash-safe `initiationState`
pre-mark, and the terminal cause plus the effect-certainty fact; a trusted
terminalizer guarantees a durable winner exists even if your action is
abandoned mid-stream. Start (or idempotently rejoin) the attempt before
opening the stream, and return an existing durable winner verbatim instead
of re-running:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
  const attempt = await ctx.streamAttempt.start('reply:' + args.attemptId);
  if (attempt.terminal) {
    // A durable winner already exists (a previous runner settled, or the
    // trusted terminalizer did): return it verbatim, never re-run.
    await runReconciled(ctx, 'settleReply', {
      attemptId: args.attemptId,
      status: attempt.terminal.cause === 'complete' ? 'failed' : attempt.terminal.cause,
      effectMayHaveExecuted: attempt.terminal.effectMayHaveExecuted,
    });
    return { outcome: attempt.terminal.cause, sequence: 0, replayedWinner: true };
  }
  const settleHost = async (cause) => {
    try {
      return await ctx.streamAttempt.settle(attempt.attemptToken, cause);
    } catch (_) {
      // Lease loss or abandonment: the trusted terminalizer owns the winner.
      return null;
    }
  };
```

Bind the upstream request to the attempt with `attemptToken`, then commit
progress through named mutations. While any cursor is open the host admits
at most ten nested-mutation commits per second (100 ms minimum spacing), so
coalesce chunks between commits:

```js source=demos/competitive-checkpoint/snapback/handlers.mjs
    const response = await ctx.fetchStream({
      url: args.streamUrl,
      method: args.method,
      body: args.method === 'GET' ? null : '{}',
      idempotencyKey: args.upstreamIdempotent ? args.attemptId : null,
      attemptToken: attempt.attemptToken,
    });
    if (!response.ok) fail('SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED', 'upstream returned a non-success status');
    reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += ascii(chunk.value);
      readsSinceCommit += 1;
      if (readsSinceCommit >= 2) {
        sequence += 1;
        const progress = await runReconciled(ctx, 'applyReplyProgress', {
          attemptId: args.attemptId,
          sequence,
          delta: pending,
        });
        if (progress.terminal) {
          await reader.cancel();
          const settled = await settleHost(progress.status === 'complete' ? 'complete' : progress.status);
          if (settled) {
            await runReconciled(ctx, 'settleReply', {
              attemptId: args.attemptId,
              status: settled.cause === 'complete' ? progress.status : settled.cause,
              effectMayHaveExecuted: settled.effectMayHaveExecuted,
            });
          }
          return { outcome: progress.status, sequence: progress.sequence };
        }
        pending = '';
        readsSinceCommit = 0;
      }
    }
```

The rules this pattern encodes, which the host enforces or checks for you:

- **The durable winner is authoritative.** `ctx.streamAttempt.settle`
  returns the committed terminal record — which may be a different cause
  than your local inference when a cancellation or timeout raced you.
  Record and return *that*, verbatim.
- **In-transaction terminal checks are yours.** Every progress and
  completion mutation must reject a terminal attempt row inside its own
  transaction (`applyReplyProgress` returns `terminal: true` above). The
  host fences late commits too, but the authored check is part of the
  contract.
- **Reconcile inner-mutation conflicts, never last-writer-wins.** A
  concurrent committed writer (a durable client cancel racing a progress
  commit) rejects the whole inner mutation with
  `SNAPBACK_MUTATION_CONFLICT`. `runReconciled` above is the reference
  reconcile: re-invoke boundedly so the mutation re-reads the row in a
  fresh transaction and observes the cancel as `terminal` instead of
  overwriting it.
- **No retry after durable progress.** Once any progress commit landed,
  reopening the upstream under the same attempt is refused — transport
  re-segmentation could bind one sequence number to different bytes.
- **Certainty is host-derived.** `effectMayHaveExecuted` comes from the
  host's write-ahead `initiationState`; your rows may mirror it read-only,
  never compute it. A bare `idempotencyKey` does not make a non-GET request
  retry-safe — safe methods are idempotent by grammar, everything else
  settles `ambiguous` on unprovable transport loss.

## Design for the v1 limits

The profile is deliberately narrow ([LLP 0076 §Surface](repo:llp/0076-bounded-streamed-actions.rfc.md)
is the sole numeric authority):

| Limit | Value | On breach |
| --- | --- | --- |
| Total response bytes | 1 MiB | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Application-visible buffered bytes | 64 KiB (structural: 4 cursors × one 16 KiB in-flight pull) | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Host read size per pull | 16 KiB | (bounded by construction) |
| Wall clock, open → terminal read | 30 s, absolute mid-read; capped below the action watchdog with ~2 s settlement grace | `SNAPBACK_ACTION_STREAM_TIMEOUT` |
| Idle (no delivered byte) | 5 s | `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT` |
| Concurrent cursors per invocation | 4 | `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` |
| Nested-mutation commits while a cursor is open | 10/s (100 ms spacing) | `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` |

Design consequences: budget the whole stream (including your commits) inside
30 s minus the settlement you must still perform; keep individual commits
≥ 100 ms apart using `elapsedMs`, not chunk counts, when cadence matters;
and treat the 1 MiB ceiling as a product constraint, not a tunable.

## Read the refusal codes

Stream diagnostics are structured and value-free: operation, expected
shape or limit, a safe received summary, and this page as the repair
anchor. URLs reduce to scheme+host; headers, bodies, secrets, and response
bytes never enter a diagnostic. The full v1 families:

| Code | Meaning |
| --- | --- |
| `SNAPBACK_ACTION_STREAM_INVALID` | Shape/protocol violation: bad URL or header shape, unknown cursor, overlapping pull, lease not held, retry after durable progress, descriptor slot this profile cannot resolve. |
| `SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED` | Total-byte, buffered-byte, or cursor-cap breach. |
| `SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT` | No delivered byte within 5 s (or no response metadata in time). |
| `SNAPBACK_ACTION_STREAM_TIMEOUT` | The absolute 30 s wall ceiling, including mid-read. |
| `SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED` | Transport failure that is retry-safe (safe method) or provably pre-send. |
| `SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS` | Non-idempotent transport loss the host cannot prove pre-send — never silently retried. |
| `SNAPBACK_ACTION_STREAM_UNSUPPORTED` | This target does not implement the profile (distinct from admission's `SNAPBACK_CAPABILITY_UNSUPPORTED`). |
| `SNAPBACK_ACTION_STREAM_CANCELLED` | Reserved internal cancellation reason; no v1 read path surfaces it (post-cancel reads return EOF). |
| `SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED` | The ten-commits-per-second fence while a cursor is open. |

Authority loss, generation change, and watchdog codes keep precedence when
they are the real cause: a read blocked across a service-authority
terminalization discards its late bytes and surfaces the authority refusal
(for example `SNAPBACK_AUTH_SCOPED_TOKEN_INVALID`), not a stream code.

## Secrets in streamed requests

Place secrets exactly as ordinary actions do on this target: stage values
through `ctx.secrets` handles; the staged-value redactor scrubs every stream
error envelope, and stream diagnostics never carry URLs or header values.
`secretSlots` (opaque descriptor placement, same shape as host-mediated
fetch) is accepted for hosted profiles that resolve descriptors at their
own boundary; the local value-mode profile refuses descriptor slots with a
typed diagnostic rather than sending a request missing its secret.

## Anti-patterns

- **Do not stream from queries or mutations.** `ctx.fetchStream` exists in
  actions only; the executed negative is part of acceptance.
- **Do not buffer the whole body before acting.** A target that does so is
  not implementing this profile; commit incremental progress through
  mutations so clients see authoritative intermediate state.
- **Do not commit per chunk.** You will trip the progress-rate fence;
  coalesce using `elapsedMs`.
- **Do not infer your own settlement when the host has a winner.** Return
  the settled record verbatim; a raced cancellation or timeout means your
  local view lost.
- **Do not treat an `idempotencyKey` as retry permission.** It is forwarded
  provider-visible, but only safe methods (or a future verified provider
  declaration) earn retry semantics.
- **Do not poll a stream you cancelled.** Post-cancel reads return EOF by
  design; settle and move on.
