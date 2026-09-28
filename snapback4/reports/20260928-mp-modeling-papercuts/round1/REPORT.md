# Lane MP — round 1

2026-09-28. Branch `sb4-intent/mp-modeling-papercuts`.
Read the round-0 prompt, report, journal entry and Astra's complete NOT READY
review before implementation. Grok had progress only at startup; its complete
READY review arrived during work and its additional findings were incorporated.

First fetched origin and merged `origin/main` (`91c769c60625649c2e522ecf9aa2f08125d2dd6c`)
in merge `07179b8dd`. The sole conflict was JOURNAL.md; both complete entries
were retained in order. EQ and FL are included. RG had not landed in that fetched
snapshot; this round does not claim its later integration. No push/publication.

## Repairs

1. **Store and instance identity.** A dev process owns
   `.snapback4/dev-refusals/<storeId>/<instance>.json`, with a random instance
   ID, store ID, PID, listen address and start time. Its exclusive lock proves
   the producer is live. `why recent` identifies the producer, requires selection
   among multiple live producers (`--instance`, optionally `--store`), and rejects
   stopped/mismatched streams or records predating the process. The former global
   file is ignored. Two simultaneous fresh processes, empty selected streams,
   crossed identities and stopped producers are covered by real-process tests.
2. **Capture causes.** Missing/expired parents and unreadable parents now record
   their actual capture denial at the child's read-through declaration. Invalid
   reference capture is covered defensively too. The three committed tests prove
   identical trace-on/off caller bytes and meters. The [complete path audit](REFUSAL-AUDIT.md)
   lists every remaining cause-free case and its reason; hidden write/read/field
   denials found by the audit are also instrumented.
3. **Sequence proof.** The note pairs the selected index's columns with its key
   terms and requires the witness parent column to equal the inserted row's
   sequence parent. Astra's cross-group `access = .parent` witness admits an
   insertion and gets no categorical note. The builder's same-group trap still
   gets one. Grok's extra case now gets a rewrite naming `joinedAt` and `rooms`,
   without inventing a message/ordinal column. A separate messages witness gets
   no note; removing the same-table guard is caught.
4. **Asynchronous persistence.** Capture handoff follows engine-lock release
   and response sending. A dedicated dev writer owns stderr and atomic file
   replacement, with a 32-slot nonblocking queue and 32 retained records.
   Saturation drops diagnostics instead of blocking requests; `dropped` is
   reported when the writer resumes. Persistence can lag, and abrupt process
   death can lose queued records. A deliberately unread, capacity-pinned stderr
   pipe cannot stall a later mutation. Production collection stays off.
5. **Conditional preview advice.** The rewrite now says “if this viewer query
   is unused, remove `<name>`”; it does not infer external app usage.
6. **Stronger aggregate/eviction tests.** Forty refusals leave exactly the latest
   32 (`add8` through `add39`); deleting eviction fails. An expiring authorization
   witness precedes parent/source deadlines and controls `next_expiry` and denial
   at expiry. Missing, hidden and expired parents also compare data, full meter,
   cursor, deadline, tables and completeness. No aggregate admission changed.

## Orientation and contract

Applied `llp-orient`, read from the available local coldclone skill source
because this worktree's vendor symlink is uninitialized; it was read-only.
No tools were installed and no shared path or other worktree was changed.

Scope: native refusal evidence, compiler notes/source map and affected tests.
Governing context: LLP 3000 and LLP 2000.000 (fences/budgets), LLP 3000.007
(rules and hidden-target NOT_FOUND), LLP 3000.014 §§4–5.1 (capture and parent
aggregate authorization/lifetime), LLP 3000.015 §2.1 (shared sequence disclosure,
dev-only evidence), and LLP 3000.028 §2.4 (builder-context diagnostic rewrites).
Read the compiled sequences, rules, maintains and E_RULE/N_SEQUENCE_READ surfaces.
The three governing notes and published CLI guidance changed with the code.
There is no sequence-counter exception, caller detail, production opt-in,
new HTTP endpoint, engine meter change, or aggregate audience change.

## Validation

See [VALIDATION.md](VALIDATION.md) for exact commands, counts and every failure.
The complete guide is included in the affected run. `scripts/test.sh` was not
run, per the round-1 instruction; the supervisor's landing suite remains next.
No complete-suite or publication qualification claim is made.

Wasm: **2,020,060 B raw / 586,299 B gzip**. Same-toolchain merged baseline:
2,020,184 / 586,384; round-1 delta **−124 raw / −85 gzip**. The unchanged
586,193 B gzip budget still fails by **106 B**, down from the baseline's 191 B.
This is an inherited integration qualification failure, not a passing budget
check. No ceiling was raised. The trace payload and formatting remain native-only.
Final wasm SHA-256: `2fac20835e0f4f2eb344a7b751dc89dab87d9d216443466a3630d3d1c3dbb967`.


The affected matrix completed 27 targets: **396 passed, 1 failed, 1 ignored**.
Its sole failure was our unequal-length input-ID fixture, corrected and rerun:
**all 16 MP tests pass** (`final-mp.log`). All other affected tests passed;
there is no remaining observed product-test failure. The 93-test whole guide
passed in both the broad run and the focused run. The existing ignored DG
full-store test requires a worktree-owned full calibration store; it was not
requalified. Counts across overlapping reruns are not added together.

The repaired process tests pass, and removal probes fail for every requested
repair. They additionally catch eviction removal, a cross-table sequence note,
and explicit propagation of an expired parent's deadline. Mutation source
files were restored byte-for-byte; the wasm artifact still matches the final
build hash. Both merge-parent journals survive in order and changed source
files remain below 1,500 lines. No scripts/test.sh, tool installation, shared
path change, push, or publication. The local repair commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
