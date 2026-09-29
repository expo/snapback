# Lane AG — first paste, round 2

Base: c14b8ef9b2977daa7375a1cfe8533c00247f3668 on sb4-intent/ag-first-paste.
Read rounds 0–1 prompts, reports and journal entries; their constraints persist.
Read Astra's complete round-1 NOT READY review. Grok was still writing at the
start; its completed READY review arrived before the full suite and was read
in full. No runtime/client implementation, authority, disclosure, bounds or meter
change. The only package edit is the explicitly requested README correction.
No push or publication.

## Findings and detecting regressions

| Finding | Resolution and evidence |
| --- | --- |
| Astra Medium: mixed-key upsert advice can swap id/tag | Withhold advice whenever keys mix positional and named components. The original program remains accepted. The test seeds id A/tag B, executes the original, and executes any offered rewrite verbatim. Round 1 produces **two rows**; the corrected compiler offers no speculative branch. Stable unmixed positive tests still execute insert/update. `pre-fix-final-regressions.log`, `affected-lang-guide-pass.log`. |
| Astra Low: count alias in equality predicates | Resolve the alias in named keys, order keys, seek columns and extracted equality/comparison columns before index selection. A real group column named count keeps precedence. Execute both equality directions and range predicates; compare alias/canonical results and meters. Value-pinned id-order rankings retain the canonical E_QUARRY_MAINTAIN refusal, rather than an undeclared-count error. No traversal rewrites another read's focal scope. Same pre-fix and final language logs. |
| Astra Low: guide promises default rewrites | Default note summaries, verbose rewrites/explanations and explicit cost/residency details are stated throughout the current cards and README. The new guide assertion fails against the old bounds paragraph. Existing fact-home checks were updated to preserve all facts under their correct flag. Full audit and corrected passages: CONTEXT.md. `pre-fix-guide.log`, final 99-test guide pass. |
| Astra Low / Grok test weakness: missing group-filter coverage | Seed an authorized DM with the same title and id 0-dm, before six groups. Assert exact first-page identities for both pasted queries on memory and SQLite. Deliberately dropping the filter returns 0-dm and fails both. `dropped-group-filter-final.log`, `affected-device-final.log`. |
| Grok additional test weakness: cursor unused | Supply the printed groupNamed query's next cursor and assert that the second page contains only f. Removing after c fails both stores because continuation disappears. `dropped-cursor-control.log`, final device log. |

Grok reported no blocking findings. Its note that round 0's after-cal25-plain.log
is historical is correct; that file remains round-0 evidence, not current output.
The present report qualifies the round-2 source.

## Verification

- Final language/guide: ephemeral compatibility **1**, first-paste **13**, whole
  guide **99**, lowering **11**, maintains **14**, mixed keys **10**, residency
  notes **41**, selected prefix **5** — all pass (`affected-lang-guide-pass.log`).
- Device memory/SQLite, including group filtering and continuation: **2 passed**
  (`affected-device-final.log`).
- CLI check **81**, check_cost_source **10**, check_notes **3**, fix **27**, scale
  **28** — all pass (`affected-cli-pass.log`).
- To preserve the 1,500-line source cap, the new guide assertion lives in the
  existing guide/familiar.rs module. A final whole-guide rerun passed **99/99**
  (`guide-final-module.log`); the move changes no assertion or product behavior.
- Ref-check: **523 LLP docs, 9,862 references, zero errors/unchecked** (`ref-check.log`).
- Diff whitespace check passes. Existing tests and manually maintained guide
  facts changed; no new test file, diagnostic code, registry or tracked generated
  artifact. No root Snapback 1 inventory regeneration is required by this fence.
- All controls and development failures, including setup errors and corrected
  expectations, are named and attributed in FAILURES.md.

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1354 s
```

Every stage passed. The Rust runner reports 274 binaries / 987 executions;
the client stage totals **4,561 passes / 10 declared skips / 0 failures** over
eight processes, and all **79 client-model tests** passed. Full-suite failures:
**ours 0, baseline 0, environmental 0**. The existing 60-second target remains
missed; no timeout, ceiling or test count was reduced.

Fresh canonical wasm: **2,040,529 B raw / 592,975 B gzip**, unchanged cap
**593,719 B**, **744 B headroom**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
Built by this full-suite invocation; see wasm.json. No runtime source changed.

Rechecked both final review files before committing; reviews.sha256 binds the
reviewed copies. LLP 3000.007 §23 and one append-only journal entry record the
round. Commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
No push or publication. Captured logs are normalized only for trailing whitespace
and blank lines at EOF; test outcomes and the exact summary are unchanged.
