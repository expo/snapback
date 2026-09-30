# PR round 6 — replacement work after no-op publication

Branch `sb4-intent/pr-subscription-pressure`, starting at round 5
`642ac9dc7188e8c1bf1930d92c3e340e8adca832`. Read rounds 0–5's prompts/reports and
both complete round-5 reviews (Astra READY WITH CHANGES; Grok READY).

Fetched origin and attempted the requested merge before editing. Both the
fetched ref and GitHub's advertised `main` were
`267788df36b2ef6ccbcce53042180c5dd642b126`, already an ancestor through the
round-5 merge `56571c0274`. Git returned **Already up to date.** No new merge
commit or conflict resolution was needed; both histories remain. MERGE.json
records the refs and commands. Nothing pushed or published.

## Fix and governing rule

**Every live owner invalidated by apply must receive replacement work,
regardless of footprint, `keep`, or change cut.** Round 5 violated this for
locally runnable reads answered by the server outside the replica horizon:
apply withdrew the answer, but empty-footprint scheduling omitted its owner.

The product delta is five changed lines in `local.ts`, entirely scheduling.
`invalidateAnswers` returns its selected owners; the committed apply callback
adds them to sync's existing `resumed` set. Sync's `finally` block already
schedules current live members of that set. This also preserves selection when
nonretention clears remembered-wakeup deadlines, and through fallible
post-commit work. No new set, revision, watermark, cache, timer or public API.
Cold acquisition, scope/refusal fences, eight starts/eight active, bounded
overtaking and all episode limits retain their existing paths. The file remains
1,500 lines. Purely local disjoint owners remain outside apply invalidation.

`llp-orient` scoped this work to LLP 3000 §4, LLP 2000.000 §7.2–7.4 and
LLP 3000.023 §10 (in `current/`, with no Snapback 4 foundation overlay).
The client guide and reference retain their existing retention policy. LLP
3000.023 §10 now records the replacement-work invariant.
[PUBLICATION-AUDIT.md](PUBLICATION-AUDIT.md) extends round 5's authority audit
with corrected live-answer coverage, including recovered answers, failed
post-commit work, staged cuts and owners detached during sync. Hand-off: none.

## Detecting control and qualification

The new regression has eighteen cases: wasm/process × omitted/false/true `keep`
× empty/unknown/unrelated reported footprints. A real public profile horizon
contains one newer profile; Bob remains authorized on the server outside that
horizon. `/changes` stays parked. The underlying no-op applies have zero events,
unchanged watermarks and empty footprints. Each of two syncs must perform a new
HTTP query, return Bob beyond the one-second withdrawal bound and drain work
without remounting. Unknown/unrelated footprints are adapter controls around
those real publications.

On the SDK built from round 5, **16 pass / 2 fail**. Both failures are the
empty-footprint `keep: false` case, one on each device. At 1.5 seconds the answer
is loading, query count stays one, and queued/in-flight counts stay zero.
Transpiling every SDK module from exact commit `642ac9dc71` with the existing
`round5/control-sdk.mjs` independently repeats **both failures**. These controls
share the current real server/device/wasm; they isolate SDK scheduling.

Final affected qualification: **1,821 passed / zero failed, cancelled or
skipped**, in 380.778 seconds, including all eighteen new cases, every pressure,
retention/keep/per-row suite, raw/facade lifecycle, remembered answers, one-shot
settlement, both corrected round-5 suite failures and the delivery fault/await
matrix. The extra raw-deadline/page run passes **20/20**, for **1,841 affected
checks total**. The whole guide passes **107/107**. SDK build/typecheck pass;
reference validation reports **525 LLP docs / 10,043 refs, zero errors and
zero unchecked**. No final failure is classified as ours, baseline or environmental.

**No full-suite invocation:** the fix touches scheduling only, so the round-6
condition for running `scripts/test.sh` does not apply. Round 5's historical
failed full run is not relabeled. No new LL latency or social-fallback measurement
is claimed in this small round; the reviews' previously confirmed costs remain.
Every development failure and expected control is in [FAILURES.md](FAILURES.md).

The unchanged Chromium pressure harness runs two real devices per tier with
124 observations each. All four histories converge to **42 unique messages**,
with **zero withdrawals**, peak **116 queued / eight active**. PRESSURE.json
summarizes the complete retained convergence traces.

Existing wasm, measured with the repository's `gzip -9 -c <path>` command:
**1,994,357 B raw / 598,401 B gzip**. Both raw and gzip hashes match round 5.
No rebuild, Rust edit or budget increase; the ratchet stays 598,401 B.
WASM.json records the measurement. INPUTS.json captures 230 scoped source/built
artifact hashes during the early affected run. No product/test/build input edits
followed; CONSISTENCY.json verifies that all 230 hashes remain identical.

## Reproduce

From `snapback4/` with the existing workspace dependencies and device/server:

```sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
PR_EVIDENCE=reports/20260930-pr-subscription-pressure/round6 PR_LABEL=affected node --test --test-concurrency=24 packages/snapback4/test/subscription-pressure*.test.mjs packages/snapback4/test/answers-stay*.test.mjs packages/snapback4/test/retention*.test.mjs packages/snapback4/test/keep-*.test.mjs packages/snapback4/test/per-row*.test.mjs packages/snapback4/test/remembered-answers.test.mjs packages/snapback4/test/read-observation.test.mjs packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/approval-lifecycle.test.mjs packages/snapback4/test/one-shot*.test.mjs packages/snapback4/test/ordinary-history.test.mjs packages/snapback4/test/unread-range.test.mjs packages/snapback4/test/delivery-fault-matrix.test.mjs
node --test packages/snapback4/test/raw-read-deadlines.test.mjs packages/snapback4/test/page-observation.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
node reports/20260930-pr-subscription-pressure/round5/control-sdk.mjs 642ac9dc71 pr-round5
RL_TEST_SDK=target/pr-round5/dist node --test --test-name-pattern='no-op empty.*keep=false' packages/snapback4/test/subscription-pressure-noop.test.mjs
```

The last command intentionally fails twice. `./ref-check --verbose` runs from
the repository root. Logs/traces are retained losslessly as gzip files.
