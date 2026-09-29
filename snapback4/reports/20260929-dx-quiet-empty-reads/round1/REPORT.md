# DX round 1 — flush refusal notices on managed shutdown

Both Astra findings and Grok’s additional card finding are fixed. Normal dev
shutdown explicitly drains the refusal writer and flushes counted notices while held request senders remain alive.
Every grouping field now has an independent identity-and-count regression.

Branch: `sb4-intent/dx-quiet-empty-reads`. First ran `git fetch origin && git
merge origin/main`. Resolved the sole conflict in the append-only journal by
preserving both entries; merge commit `1c3982a45`. Round 0 is `7e9208f47`;
merged main is `f9620c815`. No push or publication.

## Findings and changes

1. **Medium, ours: normal shutdown lost real refusal console notices.** The
   writer now receives an explicit shutdown marker after the server stops
   admission. New evidence submissions stop, accepted records and up to one
   bounded queue of racing handoffs drain, and console groups flush. The writer
   releases the live-instance lock before acknowledging. One two-second deadline
   covers both marker admission to a full queue and acknowledgement, so a stalled
   disk or stderr cannot make this wait unbounded. The owner does not depend on
   sender disconnection or an unbounded thread join. Dev without a worker also
   takes the managed INT/TERM/HUP path, exiting `128 + signal`; fatal signals and
   production retain their existing behavior. Worker cleanup remains intact.
2. **Low, ours: cause-separation coverage omitted three fields.** The regression
   independently changes operation, code, table, clause, phase, schema site,
   executionSite and generation. For each field it requires two identified lines,
   with counts 2 and 3 and the correct first request. Console output now includes
   phase and generation so all grouping identities are visible. The fixed-window,
   repeat-count and bounded-overflow tests remain.
3. **Low, ours (Grok): trace retention advice was missing from EMPTY_READ.**
   The card and manual now recommend one quiet reproduction, explain that traced
   empties share the 32-record stream and 32-slot queue and can crowd out older
   refusals, describe the pending/dropped latest-record failure, and advise
   restarting without the flag after inspection. The served-card test failed
   against the old card (`card-before.log`), then passed with the guidance.
   Grok’s other two findings overlap Astra’s and are covered above.

The current contract is updated in LLP 3000.015 §2.1, the operations manual,
the refusal guide and the signal-code description. Empty successes, caller
envelopes, the nonblocking request path, the 32-record bounds and production
evidence collection retain the round 0 policy. [CONTEXT.md](./CONTEXT.md) records
orientation and the shutdown boundary. Requests finishing after shutdown starts,
abrupt termination and stalled diagnostic sinks have no delivery guarantee.

## Regression evidence

Before the fix, all three initial process regressions failed: SIGTERM with a
worker, SIGTERM without a worker, and SIGINT without a worker. Each got **zero
console lines instead of one counted line for eight E_RULE refusals**. See
[shutdown-before.log](./shutdown-before.log). The final process tests cover all
four SIGINT/SIGTERM × worker/no-worker combinations. Each holds an actual
25-second change poll, confirms its opening heartbeat, issues eight refusals
inside the console window, signals the process, and requires prompt exit,
one `count 8` line, all eight persisted records, no drops and stale-instance
rejection. The held socket remains alive through process exit.

Removing only `executionSite` from `same_cause` made the new regression fail:
one `count 5` line appeared instead of separate counts 2 and 3. The mutant exited
101, and was restored before final validation. See
[mutant-execution-site.log](./mutant-execution-site.log).

## Validation

| Check | Result |
| --- | --- |
| `cargo test -p snapback4 --test dev_refusals --test lifecycle` | 20 refusal process tests and 21 lifecycle tests passed |
| `cargo test -p snapback4 --bin snapback4 dev_refusal` | 5 passed, including full-queue/missing-ack deadlines and live-lock release with a held clone |
| `cargo test -p snapback4-lang --test guide` | 98 passed |
| `./ref-check --verbose` | 523 LLP docs, 9,852 refs, 0 errors, 0 unchecked |

`scripts/test.sh` ran **once**, exit **0**, with the exact summary:

```text
== 0 failure(s) in 1332 s
```

Every stage passed. Rust completed in 536 s. Client tests passed **4,561** with
**10 declared skips**, no failures and no cancellations; final client models
passed **79/79**. `full-suite.log`, `full-suite.exit` and
`client-stage-counts.json` retain the evidence. **Full-suite failures: none —
ours, baseline or environmental.** [FAILURES.md](./FAILURES.md) separately
records the deliberate failing controls and setup corrections. The inherited
60-second suite target is still exceeded; no limit or timeout was changed.

Grok’s additional card finding arrived as the full-suite Rust stage ended. The
final process suite and whole guide were rerun after that documentation-only
follow-up; their logs are `affected-process-final.log` and `guide-final.log`.

Canonical wasm rebuilt by that suite: **2,040,529 B raw / 592,975 B gzip**,
against the unchanged **593,719 B** cap, **744 B headroom**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
[wasm.json](./wasm.json) and [environment.json](./environment.json) retain the
measurement and toolchain. No cap, timeout or suite scope was raised.

Both reviews were read in full. Astra: NOT READY with two findings. Grok’s
file initially contained only progress notes; its completed READY WITH CHANGES
review arrived during the full suite, with the two overlapping findings and
the additional card issue. All three distinct findings are addressed above.
The final review-file check after suite completion matched the saved complete
inputs (`input-astra-review.txt.gz`, `input-grok-review.txt.gz`); hashes and UTC time
are in `review-checks.json`. Neither input review is represented as a review of
this round’s final code.
