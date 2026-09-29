# EA round 6 — semantic backend refresh and suspended-runtime coverage

The waiting mutation now accepts a refreshed representation of the same backend.
Comparison retains the full schema and only the common interpreter program
fields, sorts programs by name, and stabilizes object-key order recursively.
It preserves ordered bodies and the independent store, generation and pinned
backend-fingerprint checks. No admission, custody, prediction, authorization,
ordering or write-ID rule changes. Round 3's memory-only wait remains.

Read rounds 0–5's prompts/reports and Astra's full round-5 NOT READY review
(preserved in `astra-r5.md`). Grok's round-4 READY review was already addressed
in round 5. These are implementation dispositions, not a new independent
reviewer verdict. Used llp-orient; see [CONTEXT.md](CONTEXT.md).

Fetched origin/main at `283be371e98288c9119f1c9af227e0a060e07862` and merged
before editing in `f1ac03ae467d00816b8a5778be29e9e88fcbdbbf`. The incoming commit
changed only issue records; both histories remain and no conflict occurred.
The shared origin/main tracking ref later advanced to native-witness merge
`aedd35615ad54901a481a01481e5d8f6110c69b4`; the full-suite manifest distinguishes
that observed ref from the entry merge. Verification is bound to the entry merge
plus this round's patch, without requiring main to stay quiet. No await changed
or was removed; the delivery matrix verifies the unchanged await census. No sub-agent, push, publication or calibration-app edit.

## Repairs and detecting coverage

1. **Medium: cached backend versus /schema falsely changes identity.**
   `backendKey` projects each program onto `name`, `kind`, `args`, `body`,
   `native`, `read_time_granularity_ms` and `returned_shapes`, matching
   core::ir::Program. Optional interpreter fields receive their actual defaults.
   All schema content stays in the comparison. Server-only execution metadata
   and native descriptors do not participate. Program names sort independently
   of declaration order; object keys sort recursively, while arrays retain order.
   The two additional optional fields in ProgramJson describe existing IR.

   The real regression starts a native-module chat server and process device,
   caches the backend while module fetching is unavailable, then reopens offline.
   It confirms the device's program order and missing predicts/requires/sites
   differ from actual /schema. It publishes identity after open, submits a write,
   holds its final identity read, reconnects, and queries the native read. That
   query fetches real /schema and installs the real wasm module. Store, generation
   and device fingerprint remain equal. Releasing the read must admit the original
   ID exactly once, POST once, and produce one sent notification and lookup.
   No refreshed response is cloned from cached data.

   This test fails on round 5 and with raw comparison restored. A separate
   normalization control reorders keys and programs and fills default/server
   metadata; seven semantic controls individually change every interpreter field
   and require E_ADMISSION_STORE. The existing schema/program, store, generation,
   fingerprint and browser transaction controls remain.

2. **Low: suspended-runtime deadline detection.** Production already checks
   wall time after identity I/O; no deadline code change was needed. Two new
   tests hold initial or final identity, use mocked setTime to advance 15,001 ms
   without executing timers, and resolve the read. Both require public
   E_ADMISSION_TIMEOUT, zero admissions and no pending call. A separate due timer
   proves no timers ran. The initial case also forbids entering the final read.
   Deleting both checks fails both tests; deleting either one independently
   fails its corresponding test. Late identity never acquires custody.

LLP 3000.007 §20.4 and the operations manual now explain the semantic comparison.
The guide already describes the unchanged public contract and suspended-runtime
behavior. The negative controls and all failures are in [FAILURES.md](FAILURES.md).

## Scoped verification

All commands use the pinned Node v24.13.1, from snapback4/ unless noted.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused repairs plus existing descriptor/schema/program controls | 6/6 | `fixes-focused.log` |
| Normalization, seven semantic controls and the focused repairs | 14/14 | `fixes-normalization.log` |
| Affected admission, online journal, lifecycle, write IDs, explicit sync and web recovery | 216/216, no skips or cancellations | `affected.log` |
| Delivery fault matrix | 321/321 | `delivery-matrix.log` |
| Whole guide: cargo test -p snapback4-lang --test guide | 99/99 | `guide.log` |
| Package build and typecheck | pass | `build.log`, `typecheck.log` |
| Root ./ref-check --verbose | 523 LLPs / 9,916 refs, zero errors or unchecked | `ref-check.log` |

The affected command selected admit-before-identity, online-intent-store,
client-lifecycle, write-ids, sync-after-call and web-admission-review with three
concurrent files. The unchanged delivery inventory retains all 160 sites,
49 required and 111 optional. No new source await is introduced.

## Wasm

The full script rebuilt the canonical wasm: **2,040,531 B raw / 592,979 B gzip**,
**740 B below** the unchanged **593,719 B** cap. Independent `gzip -9 -c`
measurement agrees. SHA-256:
`76ffca354815401fdf2f29ed59d9a4a2b14d3abbbdf76cda9bc8c4f4efaefc95`.
See `wasm.json` and the build line in `full-suite.log`. Generated wasm is not
committed; this round's production change is TypeScript.

## Full run and delivery

Ran `bash scripts/test.sh` **exactly once**, exit **0**. Exact summary line:

```text
== 0 failure(s) in 1253 s
```

| Full-run scope | Result |
| --- | --- |
| Rust including doctests | 4,331 passed, 0 failed, 33 declared ignores; 503 s |
| Whole guide within Rust | 99/99 |
| Clients | 5,166 passed, 0 failed, 0 cancelled, 10 existing skips; 410 s |
| Fixture wrappers | 9/9 |
| Client models | 79/79; 329 s |
| Build, wasm, docs budget, release guard, package build/typecheck, chat check, chat and Expo typechecks | pass |

The model stage retains **10,000 session sequences** (5,000 online + 5,000 local,
I1–I13) and **3,000 online-client sequences** (R1–R6). The full output,
`session-model-coverage.json`, `rust-summary.json`, `client-summary.json` and
`model-summary.json` preserve their results. The three new regression cases and
the semantic normalization controls also pass in this full client run.

**Full-run failures: ours 0; baseline 0; environmental 0.** Expected refusal
messages from fault-injection models are not failed tests. Every deliberate
negative control remains listed separately in FAILURES.md. No timeout, sequence
count, assertion or size ceiling was relaxed. The inherited 60-second suite
budget remains exceeded; this is not a performance qualification.

`full-suite-inputs.json` binds the final source, test and governing-doc changes
to the entry merge. `full-suite-completion.json` verifies they remained byte
identical through the entire run. No production/test change followed it.
One appended round-6 journal entry and the local commit carry this result, with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
