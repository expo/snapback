# PQ round 6 failure ledger

The required single full-suite invocation exited 0 with exactly
`== 0 failure(s) in 1229 s`. Every phase passed; main clients: 4,747 pass,
zero failures, ten existing conditional skips; final models: 79/79. Broad
affected checks passed 815/815, focused regressions 63/63, whole guide 98/98.
No unexpected qualification or development-test failure occurred.
Qualification failure attribution: **ours 0, baseline 0, environmental 0**.

## Intentional removal controls — ours, expected failures

`controls.py` copies the SDK source, built modules and tests into a temporary
directory inside this worktree. It mutates only those copies, runs the named
tests against them and requires assertion failures. Qualification source and
artifacts remain intact. Final results are in `controls.log` and the five
individual logs:

| Removal | Every detecting test | Failures |
|---|---|---:|
| Use only `watch`, ignoring `backgroundWatch`, in the evaluation generation fence | `queued presence checks a second change at the response boundary`, wasm/process × keep omitted/false/true | 6 |
| Delete only the presence callback's change-version comparison | `queued presence checks a second change at the callback boundary`, wasm/process × keep omitted/false/true | 6 |
| Delete the checkpoint immediately before memory writes | `the final memory checkpoint rejects a change after the earlier acceptance check` | 1 |
| In `forget`, replace `this.fence(key)` with `this.written.delete(key)` | `selective deletion rejects an older ticket with a higher sequence` | 1 |
| Delete `.finally(clean)` from `withReadSignal` | `request abort listeners are removed after success`; `request abort listeners are removed after rejection` | 2 |

Total: **16 expected failures**, with every requested removal detected.
These are test controls, not full-suite or baseline failures.

## Intermediate controls and test correction — ours

The first controls (`controls-initial.log`) used the original six response
cases, three existing selective-clear cases and two listener cases. They
reported 6 + 3 + 2 intended failures. The next boundary diagnostic
(`controls-boundary-diagnostic.log`) added the final-callback and memory
controls and selected the new standalone selective-delete test: 6 + 1 + 4 +
1 + 2 intended failures. Two process response cases passed that mutation
because their fixed 60-event-loop-turn wait could assert before process IPC
and final evaluation completed. This was our test synchronization gap.

The corrected fixture positively observes the result reaching the actual
publication checks before asserting memory and snapshot state. All six
response cases then detect the isolated generation removal. No product code,
timeout, queue limit, retention policy or assertion was relaxed. Original
diagnostic logs are retained with `-initial` and `-boundary-diagnostic` suffixes.
