# DX round 0 — quiet empty reads

Ordinary empty query answers no longer print `dev refusal` lines or enter
`why recent` by default. This addresses calibration #26's 14,802 milestone-log
lines and 55,210 scale-log lines, including ordinary typing, reactions and
not-yet-created profiles. Supplied counts, representative lines and the builder
run-log statement are retained under `inputs/`.

Branch: `sb4-intent/dx-quiet-empty-reads`. Base:
`4fd338de59407ab6b7cc7009e27001c877cacfe9`. No push or publication.

## Behavior and decision

- `snapback4 dev --trace-empty` opts into unknown-empty evidence in `why recent`.
  These records still produce no console notices. The stream identifies the
  option with `traceEmpty`; synthesized records carry `emptyRead: true`.
- Every real refusal continues through MP's existing individual-record path:
  mutation/query/asset envelopes, receipt replay, uninstrumented refusals and
  parked jobs. Even an application-authored `require … else EMPTY_READ` remains
  a real refusal. Successful visibility filtering remains outside the stream.
- Remaining console lines combine identical operation, code and cause for a
  **fixed, non-sliding one-second window**, then print once with `count N` and
  the first event's identity/time. Causes include table, phase, clause, schema
  site, execution site and generation. Idle windows flush; at 32 distinct
  groups the oldest flushes early. Save errors also coalesce. Individual recent
  records, their 32-slot queue/ring, ordering, liveness and stale-watermark checks
  retain their existing semantics. Counts cover accepted records; dropped queue
  entries remain separately reported. A killed process can lose a buffered line.
- `snapback4 why EMPTY_READ` and `snapback4 guide EMPTY_READ` serve the new card.
  It defines empty evidence, says it does not prove denial, and gives exact
  commands for an operation's read sites, table/parent rules, residency, fixture
  acquisition, sync horizons and requested evidence.

The policy is recorded in [LLP 3000.015 §2.1](../../../llp/3000.015-shared-baseline-for-snapback5.spec.md).
The operations manual, refusal/sequence guide, E_RULE card and CLI help were
updated together. [CONTEXT.md](./CONTEXT.md) records the governing constraints.

## Cost evidence

The actual response-producer modules, seven rounds of 55,210 calls each, measured
median **9.846 µs → 2.944 µs per call**. The new default creates zero records,
submits nothing and leaves the watermark at zero. Response parsing and request
scope setup remain; I/O was already on MP's background writer.

In the matched ordinary-dev HTTP burst, the old implementation emitted 54,669
lines, dropped 541 records and wrote **437,955,712 B** through file descriptors.
Both new 55,210-request bursts emitted **zero lines**, performed **zero file
writes**, stored **zero records** and dropped **zero evidence**. All HTTP answers
were verified. Overall elapsed times do not establish a general speedup on this
shared host. Separate measurements cover the old console formatter, formatter
plus file I/O, and refusal-store ring/serialization/replacement.

[MEASUREMENTS.md](./MEASUREMENTS.md) contains the methods, limits, component
timings, matched-profile results and reproducible scripts. The initial profile
mismatch is explicitly excluded rather than presented as a speedup.

## Validation

| Check | Result |
| --- | --- |
| `cargo test -p snapback4 --test dev_refusals` | 16 passed, 0 failed |
| `cargo test -p snapback4 --bin snapback4 dev_refusal` | 3 passed, 0 failed |
| `cargo test -p snapback4 --bin snapback4 refusal_tests` | 3 passed, 0 failed |
| `cargo test -p snapback4-lang --test guide` | 98 passed, 0 failed |
| `./ref-check --verbose` | 0 errors, 0 unchecked |
| `git diff --check` | Passed |

The process tests cover repeated empty pages, points and nested empty answers;
default/opt-in recent behavior; caller-envelope preservation; real repeated
refusal counts; separate individual records; both card-serving verbs; and MP's
existing assets, jobs, rule exhaustion, replay, blocked-writer, source-map,
liveness and stale-record cases. Deterministic console tests cover different
causes, fixed expiry, count accumulation and bounded overflow.

`scripts/test.sh` ran **once**, exit **0**. Its exact summary is:

```text
== 0 failure(s) in 1520 s
```

Every stage passed. The Rust stage completed in 654 s; the client stage passed
4,561 tests across its main process and shards, with 10 declared skips and no
cancellations; the final client models passed 79/79. `full-suite.log`,
`full-suite.exit` and `client-stage-counts.json` retain the evidence.
**Full-suite failures: none — ours, baseline or environmental.** Earlier lane
failures were corrected and are classified individually in FAILURES.md.
The suite still exceeds its documented 60-second target; the base journal
already records a 1,690-second run. No suite limit, timeout or scope changed.

Canonical wasm from that run: **2,040,529 B raw / 592,975 B gzip**, against the
unchanged **593,719 B** cap (**744 B headroom**). Rust 1.97.0,
wasm-bindgen 0.2.127; optional wasm-opt absent. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json` and `environment.json`.

[FAILURES.md](./FAILURES.md) names every earlier failed check, attribution,
correction and superseded measurement. No cap or test timeout was raised.
