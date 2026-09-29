# PQ round 7 — merge RL and PQ read behavior

Merged `origin/main` at `78bcc92c8e2668bad1ce580cd9f728e99ed6abed`
into `sb4-intent/pq2-per-row-hooks`, starting at
`6b71b7379bb35863884c4729766ee36481e75731`. The result combines RL rounds 0–3
and PQ rounds 0–6. This is a local merge; nothing is pushed or published.
Grok's prior round-6 READY review is preserved as `input-grok-round6.md`; it
reviews that revision, not this merge. `CONTEXT.md` records orientation.

## Conflict resolutions

The original twelve conflicted files and their hunks are preserved in
`merge-conflicts.patch.gz`.

| File | Resolution |
| --- | --- |
| `src/read-observation.ts` | Combine RL's plain/change distinction with PQ's queued transition. `reload(bounded, { queued })` remembers a pending change even through later plain reloads; the replacement attempt starts the timestamp. Existing timestamps never move. Both retaining policies obey change bounds. Preserve the same snapshot object when adding the hidden timestamp, so queued presence still needs a version fence. Plain failures retain identity, original `since`, offline freshness and row deadlines. A failure while queued cannot start an episode outside attempt service. |
| `src/client.ts` | Retain the eight-start/eight-active queue and cancellation signal. Route durable/ephemeral notifications and successful mutation receipts through bounded scheduling; omitted durable table lists remain conservative. Reconnect/refetch remain plain. Keep PQ's deadline-floor/replaced-answer checks and RL's failure retention together. A cancelled attempt does not publish a failure. |
| `src/local-query.ts` | Keep PQ's `deadlineWithdrawn` result alongside RL's `transportOffline`/`retryExhausted` metadata; preserve cancellation, evaluation/memory checkpoints, recovery and final candidate selection. |
| `src/local-reads.ts` | Preserve selective dependency clearing and ticket barriers. Keep both `changeVersion` and RL's pending `changeCut`; reported changes advance the former, while only applied sync clears the latter. Commits mark a queued change episode. Scope resets clear pending cuts and reset answers. |
| `src/local.ts` | Every affected durable notification, including locally runnable queries, carries its cut through queued scheduling. Generation changes reset before table filtering. Ephemeral changes also advance the version; sampling does not. Ordinary and background presence publication check both version and pending cut. Preserve final cancellation/reset/floor checks, eight-slot scheduling, lifetime release and paced retry. Save the accepted authority revision so a closed raw handle notices intervening commits on resubscription, while unchanged resubscription stays plain. |
| `test/answer-withdrawal.test.mjs` | Wait for the queued replacement to begin before reading its bound. Apply withdrawal assertions to both retaining policies. |
| `test/expiry-retry-watch.test.mjs` | Preserve PQ's acquisition-only wakeup and notification count; the eventual offline replacement follows RL and stays `revalidating`. Park `/changes` independently of expiry. |
| `test/keep-app-model.test.mjs` | Keep PQ's saved answer reference so an attempt can attach its deadline later. Initialize that reference from the remounted snapshot, and allow deadline withdrawal for both retaining policies. |
| `test/raw-read-deadlines.test.mjs` | Keep PQ's real process/wasm ownership-transfer/resubscription tests, including real timer notification and non-renewal. The isolated raw timer test explicitly introduces change evidence. |
| `test/delivery-await-boundary.json` | Recompute the two merged await-expression hashes, preserve PQ's deadline module, and retain RL's thirtieth local-query await (`pending()` during offline ephemeral recovery). Review found no new delivery side effect or custody path in the integration; the delivery fault matrix checks classification. |
| `llp/3000.023-answers-stay-on-screen.rfc.md` | One current §10 combines both lanes: plain retention, change bounds from attempt start, non-renewal through queueing, both fences, memory/deadline rules, queue/lifetime limits and evidence. Retarget PQ refs and current guide links; historical review sections remain. |
| `JOURNAL.md` | Preserve both sides of all three append conflicts. `journal-preservation.json` verifies every complete entry from each parent is still present unchanged (1,024 PQ chunks and 1,023 main chunks). Append one round-7 entry with the completed proof. |

Auto-merged RL freshness propagation, facade episode inheritance, search and
ephemeral recovery were checked with the merged queue paths. The current client
card, operations manual, README and contract comments state the attempt-start
bound. No public type, Rust implementation, meter, size cap or LV mechanism was
added. `local.ts` remains 1,500 lines; existing comments were shortened to fit.

## Added and adapted evidence

The queue/in-flight integration now runs all three hosts with omitted `keep`
and `keep: true`. Four additional observation/facade cases cover a long plain
offline refresh, queued change evidence, subsequent plain reloads, and failure
or timeout after service. They require the original offline `since`, no deadline
before service, one fixed deadline afterward, facade withdrawal, and late success.

RL's commit unit tests now explicitly start the queued replacement before
checking the bound. PQ's queued `keep: true` case now requires that same bound,
and its unrelated-write/offline test requires RL's `revalidating` metadata while
still requiring zero evaluations for the unrelated write.

The seeded model keeps all authority assertions, 300 seeds per host and the
240-second per-host timeout. `AsyncLocalStorage` identifies the independently
started direct-query attempt so the injected observation fault cannot catch
that query's retry. After ending an injected failed replacement, a public raw
handle resubscription requests recovery; queue coalescing need not leave a
redundant attempt. Sign-out still uses the public method and checks its immediate
hard boundary. Its completion is awaited in bounded cleanup batches, and delayed
notifications remain in their seed's failure array until cleanup finishes.
No SDK ordering/deadline output is used to choose the reference authority.

## Verification

Final affected tests: **740/740**, no skips or cancellations
(`affected-final.log`). Includes every `per-row*.test.mjs`, every
`answers-stay*.test.mjs`, raw deadlines, answer withdrawal, expiry-retry watches
and the complete delivery fault matrix. The separate corrected retention and
facade-model run passes **72/72** (`corrections.log`), including all 18 facade
schedules.

Real-clock 1,000-hook React results, from `affected-final.log`:

| Host | Loading renders | Evaluations | Revalidating hooks | First-to-last replacement start |
| --- | ---: | ---: | ---: | ---: |
| wasm | 0 | 2,000 | 1,000 | 2,013 ms |
| Worker | 0 | 2,000 | 1,000 | 2,126 ms |
| process | 0 | 2,000 | 1,000 | 2,313 ms |

The online 1,000-hook React case and RL's React routing/history traces also
pass. The local measurements use the real clock, with attempts spanning more
than one second; each new bound still starts at its own attempt.

Seeded model: **300/300 process seeds and 300/300 wasm seeds pass**, with
zero failed seeds or cancellations (`oracle-complete.log` and its two JSON
records). Process: 206.689 s; wasm: 159.470 s, within
the unchanged 240-second host timeout. The negative-reference test passes too.
The additional RL retention unit file passes **65/65**, including a repeat
after the full client phase reported its old assertions
(`retention-unit-final.log`, `retention-after-full.log`).

The one required full script's client phase reports **4,956 tests: 4,940
passed, six failed, ten existing conditional skips, zero cancellations**. The
six failures are **ours**: `local apply/admit/settle retains within a change
episode`, each with omitted `keep` and `keep:true`, in `retention-episode`.
That test process loaded the enqueue-time assertions before the correction.
The corrected whole file passes 65/65 afterward. No runtime source changed
during the full run. It remains a red full run; it is not repeated or described
as an all-green final-tree run. Baseline failures: 0. Environmental failures: 0.

The full client phase also independently passed **300 seeds per host** in the
merged mixed-evidence model (process 196.151 s, wasm 160.276 s), and all other
PQ/RL tests. Its ten conditional skips are not qualified by this run. Cargo,
wasm, release guard, all builds/typechecks, docs budget and fixture wrappers
passed. The final model phase passes **79/79**, with no skips or cancellations.
The exact script summary is:

```text
== 1 failure(s) in 1241 s
   client tests
```

Exit status: **1** (`full-suite.exit`). `scripts/test.sh` was invoked exactly
once. The inherited 60-second target remains missed; no budget was increased.

Whole guide: 98/98. Canonical wasm: 2,040,529 B raw, **592,975 B gzip**,
**744 B** under the unchanged **593,719 B** cap. `wasm.json` records the exact
`gzip -9 -c` measurement and SHA-256
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

`ref-check --verbose` passes: 523 LLP documents, 9,877 references, zero errors
or unchecked references. Text logs have trailing whitespace trimmed; the original
conflict patch is retained losslessly in gzip.

`FAILURES.md` records development and qualification failures with attribution.
The local merge commit uses `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
