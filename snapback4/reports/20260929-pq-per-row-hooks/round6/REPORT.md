# PQ round 6 — queued presence and detecting coverage

All three requested items are addressed. Changes remain local; nothing is
pushed or published. Branch: `sb4-intent/pq2-per-row-hooks`, starting commit
`b90c2eca3`. Initial and pre-suite fetches found `origin/main` at `b7d05baff`,
already included in this branch, so no merge was needed.

Read the round 0–5 prompts/reports and both complete round-5 reviews:
[Astra](astra-round5.md) and [Grok](grok-round5.md). Applied `llp-orient`;
[CONTEXT.md](CONTEXT.md) records the governing documents and constraints.
Those reviews describe round 5, not approval of this revision.

## Changes

- **Queued presence.** `runLocal` captures the generation of
  `watch ?? backgroundWatch`. Evaluation checkpoints and the checkpoint
  immediately before remembered-answer writes check that generation. The
  presence continuation and its synchronous publication callback also compare
  their captured change version. Background evaluation still omits the
  observation argument, preserving its existing fetch/reload behavior.
- **Selective memory deletion.** A focused test starts a ticket, selectively
  deletes its key, and sends a reply from that ticket with sequence 20 after
  the previously accepted sequence 10. It must remain absent. Disjoint memory
  survives and a ticket begun after deletion can write sequence 20. The
  production barrier already existed and is unchanged.
- **Request listeners.** Separate success/rejection tests count the actual
  abort listeners on both the attempt and client-lifetime signals while a
  request is pending and after settlement. Three successive requests each
  leave zero listeners; later aborts cannot reach completed requests. The
  production cleanup already existed and is unchanged.

The presence regression fills eight slots on real wasm/process clients under
all three retention policies. A first relevant change queues the row; its
presence timer starts a real server read and holds that body. An owner transfer
then produces the second `/changes`, while its following sync is held to
isolate the change-version fence from the ordinary commit revision. Both
invalidations leave the exact same queued snapshot object. Releasing presence
must write no stale memory, publish nothing and preserve that snapshot. Opening
capacity then obtains the current null answer.

Six further cases inject a version advance at the final callback after the
earlier checks pass. A unit case injects it immediately before the memory
write. The response tests wait for the actual publication boundary, including
process IPC, rather than counting event-loop turns. The correction and all
control outcomes are retained in [FAILURES.md](FAILURES.md).

Five isolated removals produce **16 intended detecting failures**:
background-watch generation (6), final presence callback version (6), final
memory checkpoint (1), the exact `forget` mutation (1), and `.finally(clean)`
removal (2). See [controls.py](controls.py) and [controls.log](controls.log).

Updated LLP 3000.023 §7 in the same change. Queue bounds, retention policy,
expiry, resets and presence cadence remain unchanged. No public contract,
Rust runtime, meter, LV subsystem or size-cap change. `local.ts` is 1,500
lines. No new await or delivery classification. Grok's separate full-clear
and unobserved one-shot-query observations remain outside this narrow round.

## Verification

- Final focused regressions: **63/63**, no failures/skips/cancellations,
  `regressions-qualified.log`.
- Whole guide: **98/98**, `cargo test -p snapback4-lang --test guide`,
  `guide.log`.
- Reference audit: **523 LLP docs, 9,866 references, zero errors or unchecked**,
  `ref-check.log`.
- SDK build/typecheck and docs budget pass in the full-suite preparation.
- Broad affected run: **815/815**, no failures/skips/cancellations,
  `affected.log`. This includes all per-row tests, raw deadlines, remembered
  answers, scope resets, withdrawal, clocks, presence, ephemeral reads, expiry
  retries, keep-device behavior and the complete delivery fault matrix.
- Main full-suite client phase: **4,757 tests, 4,747 pass, zero failures or
  cancellations, ten existing conditional skips**. The skipped lanes are not
  qualified by this run. Final client models: **79/79**, no skips or failures.

The **one** `bash scripts/test.sh` invocation exited **0**, with exactly:

```text
== 0 failure(s) in 1229 s
```

Every phase passed. Qualification failures: **ours 0, baseline 0,
environmental 0**. [FAILURES.md](FAILURES.md) lists every intentional mutation
failure and the intermediate test-synchronization correction. The existing
60-second suite target remains exceeded; no time limit, model count or budget
was relaxed.

Affected command, from `snapback4/`:

```sh
node --test --test-concurrency=2 packages/snapback4/test/per-row*.test.mjs packages/snapback4/test/raw-read-deadlines.test.mjs packages/snapback4/test/remembered-answers.test.mjs packages/snapback4/test/keep-reset.test.mjs packages/snapback4/test/answer-withdrawal.test.mjs packages/snapback4/test/server-clock*.test.mjs packages/snapback4/test/presence*.test.mjs packages/snapback4/test/ephemeral*.test.mjs packages/snapback4/test/delivery-fault-matrix.test.mjs packages/snapback4/test/expired-server-watch.test.mjs packages/snapback4/test/keep-device.test.mjs packages/snapback4/test/expiry-retry*.test.mjs
```

The full invocation uses `bash scripts/test.sh` with the ordinary suite
scheduler. Production changes were complete before it began; the test-only
boundary refinements finished during its Rust phase, before client tests.
No tool was installed. Existing Node 24.13.1 and Bun 1.3.14 were used.

## Wasm

Canonical rebuild in this round's full suite:

```text
wasm 2040529 B raw, 592975 B gzip (budget 593719: ok)
```

**592,975 B gzip**, **744 B** below the unchanged **593,719 B** cap, zero
growth from round 5. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
`wasm-measurement.json` preserves the measurement and digest.

## Completion

The final main check still names `b7d05baff`; it is already included. Both
complete review copies match the originals. One appended round-6 journal entry
accompanies the local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing is pushed or published.
Whitespace checks pass. Logs preserve result text with trailing whitespace
normalized for the repository check.
