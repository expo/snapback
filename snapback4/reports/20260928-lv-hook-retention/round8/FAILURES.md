# Round 8 failure accounting

## Full suite

Exactly one `scripts/test.sh` run, exit 1:

```text
== 1 failure(s) in 1181 s
   client tests
```

Only failing test: **social starter runs through the public client: feed, likes,
receipts, typing, media and retained history**, at `social-starter.test.mjs:205`.
Classification: **ours**, an existing LV-contract fixture assumption, not a
baseline/environmental exemption. A late poll fences the replica; its current
server fallback correctly returns an empty page after leave. Sync restores the
retained device domain. The fixture now synchronizes after the intervening
online typing-refusal call and preserves the exact-ID assertion.

The unchanged SDK reproduces this failure in 7/15 diagnostic smoke repetitions;
a separate wire trace reproduces at attempt 8. Each failed probe has this same
name/assertion; all are ours. The first standalone rerun passed, which alone
would not establish a cause. Corrected fixture: 30/30 smoke repetitions and 5/5
complete-file checks pass. The full run remains red; a green full run before
landing is still outstanding under the one-full-run instruction.

All 18 expiry cases pass in the full run. Rust: 4,288 pass / 33 ignored; client
shards: 4,836 pass / 1 fail / 10 skipped; full models: 79/79; fixtures: 9/9.
No other failing stage or case. See `full-run.json` and `test-sh.log.gz`.

## Expected reproductions and controls — ours

The supervisor’s round-6 failure is the lane’s round-1 cross-invocation test
assertion, not a baseline exemption. Replaying the real streamed-expiry schedule
against unmodified round-7 product produces the same assertion failure on both
wasm and process, with direct and observed first pages (four failures):

- `expiry retry server pagination wasm`
- `expiry retry server pagination watch wasm`
- `expiry retry server pagination process`
- `expiry retry server pagination watch process`

All return the correct two pages before failing the request-log assertion.
Evidence: `controlled-before.log.gz`, `controlled-before.test.mjs.gz`.
The ordinary timing probes all pass and are not represented as reproductions.

Three isolated controls each intentionally fail the four new names below:

- `expiry retry server pagination delayed changes wasm`
- `expiry retry server pagination watch delayed changes wasm`
- `expiry retry server pagination delayed changes process`
- `expiry retry server pagination watch delayed changes process`

1. `old-cross-invocation-assertion`: restores the supervisor’s exact assertion;
   0 pass / 4 fail / 0 cancelled. Existing product behavior is correct.
2. `restart-continuation`: substitutes null on the second invocation’s retry;
   0 pass / 4 fail / 0 cancelled. The returned suffix wrongly repeats page one.
3. `leak-expired-cursor`: installs the discarded local candidate’s cursor before
   re-evaluation; 0 pass / 4 fail / 0 cancelled. The local post-expiry branch no
   longer reports the required unavailable/speculative result.

Each is an assertion failure, not a syntax/import failure or timeout. See
`controls.json` and each `control-*.log.gz`. The live SDK was never modified by
these controls. The corrected complete expiry file passes 18/18, and its final
version is included in the full run. All affected 1,021 cases and 98 guide
cases pass. Counts overlap and are not additive.

## Operational setup — ours

One exploratory concurrent repetition was interrupted before collecting results:
a broad text replacement in an ignored diagnostic copy accidentally removed the
`until` helper’s 10 ms yield along with the optional fetch delay. It busy-waited,
so that experiment is invalid and has no pass/fail qualification claim. Ctrl-C
stopped that tool session. After restoring the helper, the separate 100-run
pagination probe completes with 400/400 passing cases. The committed test and
live SDK were never changed by the faulty copy.

Read-only lookups initially guessed nonexistent guide/media helper paths. Those
commands exited nonzero; subsequent `rg` location searches found the actual
files. They did not execute tests or change product state.

No product failure is classified baseline or environmental. No new Expo UI
witness was attempted; the native host named here is the process ABI.
