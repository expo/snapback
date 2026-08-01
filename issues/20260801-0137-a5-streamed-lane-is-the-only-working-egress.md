# A5 sweep: the streamed lane is the only working action egress on packaged 0.1.7 — and nothing says so

**Opened:** 2026-08-01
**Systems:** Actions, Runtime, Guide
**Related:** LLP 0137 (A5 arm), LLP 0076, issues/20260801-0137-a4-outbound-notification-effects-unauthorable.md, demos/improvement-sweep/arms/a5-snapback-web/findings/0137-a5-f1-streamed-lane-is-the-only-working-egress.json

The A5 arm proved, from a clean external consumer on a sessions server with
`SNAPBACK_OUTBOUND_ACTIONS=1`:

1. **`ctx.streamAttempt` works in the inline lane**: `start` returns
   `{attemptToken, leaseHeld, progressCommits, runnerGeneration, terminal}`,
   `settle('complete')` returns the durable winner
   `{cause, effectMayHaveExecuted, settledBy: 'authored'}`, and an
   idempotent rejoin returns that terminal verbatim.
2. **`bounded_response_stream_v1` artifacts admit on sessions targets** —
   the Diary 0031 product-blocking sessions+streaming composition refusal
   is gone on the public 0.1.7 closure.
3. **`ctx.fetchStream` works end to end**: a local chunked HTTP upstream is
   drained through the one-pull reader (3 pulls, 24 bytes, correct text),
   and request headers — including an authorization Bearer value staged
   from `ctx.secrets` — reach the upstream.
4. The A5 app's **scheduled refresh runs the full documented pattern**
   (attempt keyed by the run dedupe key, GET via `fetchStream`, drain,
   settle, receipt) with the secret carried server-side and absent from
   every client-visible surface (canary scan clean).

Meanwhile plain `ctx.fetch` still dies at runtime with
`SNAPBACK_HANDLER_HOST_CALL_UNKNOWN: unknown handler host call host.fetch`
(re-verified this arm, byte-identical to the A4 observation).

Consequence: the A4 ticket's "every action form fails" **narrows** — a
working egress idiom exists, but it is the streamed one only. The
actions-and-fetch guide teaches `ctx.fetch` as the primary path, so a
consumer following the guide hits the broken lane first and has no
documented reason to author a plain GET/POST effect as a stream.

Fix shape: register `host.fetch` for the inline lane under the existing
egress gate (making the guide's primary path real); until it ships,
document the streamed lane as the supported egress idiom for all outbound
effects on 0.1.7 (the A5 `runRefresh` in
`demos/improvement-sweep/arms/a5-snapback-web/evidence/app/functions.mjs`
is a working taught shape), plus a packaged-closure conformance test that
executes one plain-fetch action and one streamed action against a local
fixture.
