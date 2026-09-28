# Lane MP — round 2

2026-09-28. Branch `sb4-intent/mp-modeling-papercuts`.

Fetched origin and merged `origin/main` (`129ffc36892a0e1c0289d8687382b8e310d8ca11`)
in `b7775db58d31daaabdddea021231645bbb5e9418`. RG and FL are included. The
only conflict was LLP 3000.015's Revised header: both complete revision histories
were kept. Both sides' journal and guide changes were preserved. No push or
publication. Read both prior prompts/reports/journal entries and Astra's full
round-1 NOT READY review. Grok had progress only initially; its completed READY
review arrived during work, and its three Lows and both test gaps were
incorporated. Its final contents were checked again before committing and are
unchanged. Both reviews are copied beside this report.

## Repairs

- **Query authorization.** Both detached and memory query branches attach the
  dev trace. A checked-out reader retains its source map with its generation,
  even while a save publishes another map. The real-process regression seeds
  8,193 expiring grants, first establishes an unrelated mutation refusal, then
  proves the point query's E_RULE becomes the newest record at the parent's
  read declaration. The memory branch, source-map publication race and reader
  generation replacement have separate tests.
- **The response layer owns records.** Every dev E_RULE and NOT_FOUND response
  carries operation, code and a server-generated request identity scoped to its
  store/instance. Without a specific cause it records `cause not instrumented`.
  A deliberately bare E_RULE responder bypasses all operation collectors and
  still supersedes the prior record. Replay receives a new request record,
  without synthesizing historical authorization. Filtered query results have
  local code FILTERED_READ; empty/null results without a captured cause have
  EMPTY_READ, including composed results. Those conservative unknown records
  do not assert that ordinary absence/optional nulls are rule denials.
- **No stale latest cause during writer lag or loss.** A native shared-memory
  response watermark advances before sending; this is an atomic memory store,
  with no filesystem write/flush in the response path. Persistence is handed
  off after the response. `why recent` rejects an older persisted snapshot
  while newer evidence is pending or dropped. The writer sorts response
  sequences before retaining 32 records, so out-of-order handoffs cannot put
  an older cause last. The bounded queue still drops diagnostics rather than
  blocking, and its test now drains stderr, recovers, and asserts `dropped > 0`.
- **Actual authorization phase.** Capture exhaustion records `read through
  capture` before the outer write remaps the caller's effect to insert. Its
  source is the read-through declaration, never `insert <- allow`, which has
  not run. Query allowance exhaustion maps to the evaluated read rule. A
  filtered read earlier in the same request is not used as the cause of a
  later uninstrumented terminal refusal.
- **Grok's additional findings.** A same-table witness also proves the sequence
  group through a residual equality on the actual parent column, including a
  literal-key witness without `viewer`. A residual `access = .parent` remains
  silent and its first insertion succeeds. The generic why card uses the
  declared column/parent and no longer invents a message table. The single
  writer unlinks a stale instance-local temp before creating its replacement;
  the recovery test fails if that unlink is removed. Aggregate hidden/expired/
  missing equivalence now includes the point form and nested object shape,
  with a readable control, in addition to the existing grouped scan. A FIFO
  barrier also kills a dev producer after `why` passes its first live-lock check
  but before it finishes reading the snapshot, covering Grok's second-check gap.

Caller bytes and every logical meter field match trace-off execution for the
new query/capture exhaustion probes and existing write/capture paths. Production
starts no request scope, collector, writer or watermark; its process test still
matches the caller refusal and produces no private records/log. No HTTP header,
endpoint, receipt field, authorization rule, aggregate admission or ceiling was
changed. The full coverage account is [REFUSAL-AUDIT.md](REFUSAL-AUDIT.md), and
the governing context is [CONTEXT.md](CONTEXT.md).

## Validation

Logs are stored losslessly as `.log.gz`; read them with `gzip -dc FILE.log.gz`.
Commands initially produced the corresponding uncompressed `.log` files.

- Affected matrix: **388 passed, 0 failed, 0 ignored**, 25 targets
  (`affected.log.gz`). This was the initial broad run; subsequent focused checks
  cover the final trace helper and Grok additions. Overlapping counts are not
  added together.
- Final whole guide: **94 passed**. Final MP target: **18 passed**
  (`grok-guide.log.gz`; trace-helper extraction rechecked in `final-trace-helper.log.gz`).
- Final focused native refusal tests: **16 passed** (`final-native.log.gz`),
  including memory/query site ownership, bare fallback, out-of-order handoffs
  and existing latency/refusal contracts. Final process tests: **8 passed**
  (`final-process-race.log.gz`), including saturation/recovery, production isolation
  and the producer-stop race during `why recent`.
- Complete Rust recovery: **4,246 passed, 0 failed, 33 existing ignored**,
  exit 0 (`rust-recovery.log.gz`, 987 test-result summaries, including doctests).
  Its artifacts precede the eighth process test; the final process run above
  covers that addition. Counts from overlapping runs are not added together.
- Seven removal probes each fail a submitted regression: query collector,
  response fallback, capture phase, positive dropped count, residual same-group
  matcher, stale-temp recovery, live watermark (`counterfactual.log.gz` and
  `mutation-*.log.gz`). The script restores exact source bytes in `finally`.
- Final reference audit: `ref-check: ok — 522 LLP docs, 9803 refs in 28258 files,
  0 errors, 0 unchecked` (`ref-check-final.log.gz`). Final source files remain under
  1,500 lines; the shared HTTP test-host setup was extracted into the new
  test module to respect that cap.

The single requested `scripts/test.sh` returned exit 1 with exact summary
**`== 2 failure(s) in 1034 s`**, listing `wasm build` and `cargo test`.
The wasm overrun is **baseline/inherited**, quantified below. Cargo's artifact
build failure was **ours**: the included HTTP-test module was directly under
`tests/`, so Cargo also compiled it as an independent integration target, with
93 missing-parent/import diagnostics. Moving it to `tests/serve_refusals/mod.rs`
fixes discovery. The complete Rust stage then passed separately with the same
runner and process limits. The original full-script failure remains recorded
and is not relabeled green; `scripts/test.sh` was not run again.

All other full-script stages passed, including **4,194 client tests, 0 failures,
10 existing skips**, **79 model tests, 0 failures**, and **9 fixture tests**.
Every observed development failure and attribution is in
[VALIDATION.md](VALIDATION.md).

Wasm before the round: **2,020,060 B raw / 586,297 B gzip**, inherited budget
failure by **104 B**. The full script measured **2,019,904 / 586,235 B** (42 B
over). The final build after the source-cap helper extraction measures
**2,019,925 B raw / 586,252 B gzip**, a round-2 delta of **−135 raw / −45 gzip**
against the merged baseline (`wasm-confirm.log.gz`). The unchanged **586,193 B**
budget still fails by **59 B**. This is an inherited integration qualification
failure, reduced by this round, not a passing budget claim. No budget raise.
Final wasm SHA-256:
`39dbc171e30ed10ac19152381cf3e7ae0908afaf0b01ae285c2341ce542480b5`.

No tool was installed, no shared tool path or other lane was changed, and no
push/publication was performed. The local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
