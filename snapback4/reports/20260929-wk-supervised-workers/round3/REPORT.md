# WK round 3 — supervisor-owned refresh and schema-local packages

Branch: `sb4-intent/wk-supervised-workers`, starting from `13a00b80b`.
The first command was `git fetch origin && git merge origin/main`: already up
to date, clean working tree. Linux / Node 24.13.1. No push or publication.

## Changes

1. Supervised families now refuse `/auth/refresh` with HTTP 403 and public code
   `E_WORKER_REFRESH`. The supervisor already rotates these credentials; a
   successor returned through HTTP would escape the live log redactors. Refusal
   preserves the injected bearer and issues no successor. Both named and
   conventional workers follow the rule. Family-based detection leaves manually
   minted seats refreshable, including those with the same service name.
2. Private launch snapshots now preserve `snapback/node_modules` lookup before
   project-root packages, using the existing trusted host-dependency links.
   Entry/helper bytes still come from descriptor-relative no-follow traversal
   into a private snapshot. Every launch validates the source, and the existing
   symlink/FIFO/path-replacement witnesses pass. Dependencies remain trusted
   host-installed application code; this does not add a sandbox or bundler.
3. Grok’s later review exposed the same source-path problem in automatic dev
   `snapback/worker.*` and `snapback/server.*` entries. They now execute a private
   no-follow copy of the schema tree, including generated modules and relative
   helpers. Three controls detect symlink startup, symlink replacement on restart,
   and entry/helper replacement after validation. Keep relative imports inside
   `snapback/`; explicit operator-selected `serve --worker` remains external.
4. Added the standalone automatic bearer-redaction test requested in Astra's
   test-strength note. Deleting replacement in a disposable compiled module is
   detected. The original compiled module was never mutated.

All four regressions for the two findings fail on the round-2 binary: refresh
leaks for named and conventional workers; a schema-only import fails; and a
shadowed package silently resolves the wrong project-root version. The fixed
controls pass. The package tests execute the exact entry directly and under
supervision, including imports from nested helpers. Refresh witnesses log the
response in one write and split writes across both child log streams, check no
bearer, check the public refusal, retain initial-token authority and confirm a
single supervised service row.

LLP 3000.009 §5.3, the effects card, diagnostic registration/routing, existing
guide inventories and operations manual co-evolve with the code. Effect
identity, ordering, attempts, meters, ledger behavior and native jobs are
unchanged. The provider-call/ledger-commit ambiguity remains documented.
Linux execution does not qualify macOS or actual provider behavior.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| New live-worker/package/standalone controls | **5/5 pass**; four fail against round 2 | `red-controls.log.gz`, `fixed-controls.log.gz` |
| Pre-Grok affected suite: worker regressions, named dev/serve, standalone/HTTP worker and generated effect contexts | **99/99 pass** | `affected-final.log.gz` |
| Whole guide after final conventional-entry prose | **98/98 pass** | `guide-qualified.log.gz` |
| Final host unit suite, canonical two-thread concurrency | **203 passed / 0 failed / 4 ignored** | `host-qualified.log.gz` |
| Final post-Grok affected suite | **102/102 pass** | `affected-qualified.log.gz` |
| Standalone redaction mutation | **killed, 0 pass / 1 fail** | `mutant-standalone-redaction.log.gz`, exit file |
| Docs budget | pass | `docs-budget-qualified.log.gz` |
| Reference audit | zero errors / unchecked | `ref-check-qualified.log.gz` |
| Canonical full-suite build, wasm, typecheck and package build | pass | `test-sh.log.gz` |

The first affected run was **77 pass / 1 fail**: the unchanged shared-ledger
process witness observed two provider actions instead of one. Its isolated rerun,
all 20 repeat trials, and the final 99-test run passed without a source repair.
This is **baseline relative to round 3, inherited lane code**; its root cause
is unresolved, and no environmental explanation or fix is claimed. The evidence
is retained and tracked in [the filesystem ticket](../../../../issues/20260929-snapback4-worker-ledger-intermittent-duplicate.md).
Every failed control, build attempt, guide check and affected test is named and
attributed in [FAILURES.md](FAILURES.md).

The final affected command, from `snapback4/`:

```sh
node --test --test-concurrency=1 \
  packages/snapback4/test/worker-regressions.test.mjs \
  packages/snapback4/test/supervised-workers.test.mjs \
  packages/snapback4/test/worker.test.mjs \
  packages/snapback4/test/generated-effect-context.test.mjs
cargo test -p snapback4-lang --test guide
```

## Required single full-suite run

Ran `scripts/test.sh` **once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1336 s
```

Every stage passed: Rust 519 s, clients **4,605 passed / 0 failed / 10 declared
skips** in 487 s, final models **79/79 passed** in 319 s. There are **no
full-suite failures** to attribute to ours, baseline or environment. The standing
60-second suite target remains a **baseline process-budget miss**; no ceiling or
timeout was raised. `test-sh.log.gz` preserves the original invocation.

Grok's completed review arrived during the full client stage, after Rust had
finished. Its automatic-entry snapshot and the later watchdog test synchronization
repair were qualified separately by the final **102/102 affected**, **203-pass
host-unit**, **98/98 guide** and docs-budget/reference checks. The full script
was not repeated or relabeled as an atomic test of all final follow-up source.

## Wasm

Canonical full-suite build, independently measured with `gzip -9 -c`:
**2,040,529 B raw / 592,975 B gzip**. Cap **593,719 B gzip**, margin **744 B**.
SHA-256: `3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json` for the exact measurement command. No cap increase.

## Reviews and custody

Astra's complete round-2 NOT READY review is saved as `review-astra.md`;
all findings and the surviving mutation are addressed in [REVIEWS.md](REVIEWS.md).
Grok was checked at the start and throughout verification.
Grok’s complete **READY WITH CHANGES** review arrived during the full client
stage and is saved as `review-grok.md`. Its blocking conventional-entry issue
is fixed; the nonblocking observations are explicitly disposed in REVIEWS.md.
The rare fallback process-group identity concern is tracked in
[its ticket](../../../../issues/20260929-snapback4-watchdog-fallback-group-identity.md),
not claimed fixed. Both review files were checked again before commit and matched the input hashes
in `review-inputs.json`. Saved Markdown copies trim trailing whitespace only.

`full-start-source-digests.json` binds the sources at full-run start;
`source-digests.json` binds the final implementation/docs/tests after Grok.
Final affected/host/guide runs qualify that follow-up separately; the full
invocation is not a claim that all final source was tested atomically.
The report preserves the original logs, including red results. One append-only
journal entry and the local commit carry this round; the commit includes
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
