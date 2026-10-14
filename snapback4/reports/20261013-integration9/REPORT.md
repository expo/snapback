# Integration 9 — wave 10, Snapback 4 0.4.26

Base: `d814b279d0080a4f44da8aeed43e6155a1bd7d9d`, branch `sb4-loop`.
All six lane reports were read before their ordered `--no-ff` merges and are
preserved verbatim under `snapback4/reports/20261013-integration9/lanes/`.
No GitHub push or npm publication was performed.

| Lane | Merge commit |
| --- | --- |
| REL2 | `9a1c353177` |
| DX2 | `c17f387101` |
| DIAG | `55b2b3ffb9` |
| PAGE2 | `4aaa4808eb` |
| GATE | `96d1a5efc3` |
| FLAKE | `103b6a6afd` |

## Integration decisions

Retain every lane's flags and verbs in the shared refusal parser, both guide
cards and both journal/design records. REL2 owns release lifecycle prose;
DIAG's service-bootstrap recipe fits the existing deployment checklist. New
PAGE2 timed-disclosure LLP 3000.036.002 collided with DIAG's new document:
PAGE2 is now 3000.036.003, with live references and current links updated;
immutable reviews retain their original submitted text.

Regenerate diagnostics, root guide projections, await-boundary and native
censuses rather than hand-merging frozen inventories. The final delivery await
boundary has 213 sites; the native census has 722 entries, 412 mutation
occurrences and 90 private sites. Lean has 71/71 examples, 58 theorem axiom
audits and seven oracle fixture cases, with no new axioms or `sorry`.

Qualification repaired interactions that isolated lanes did not expose:
non-timed servers bypass the timed audience writer barrier; expiry-only search
word heads retain key-only discovery; timed heads still decode and step before
admission. Keep contextual `not` columns compatible, preserve precise DIAG
causes in existing tests, and restore complete compilable DX2 Composer/staff
recipes within card budgets. Frozen birth-oracle raw writes now obey their
schema's unique membership key, retaining strict event/meter/birth comparisons.
Snapshot refusal tests preserve the requested watermark; successful acquisition
owns progress. Existing starter/adaptation and generated census expectations
follow the newly implemented surfaces without weakening runtime limits.

## Repair commits and affected evidence

| Integration repair | Commits | Evidence |
| --- | --- | --- |
| Merged wasm, README and await inventories | `289f1a470b`, `8e5a7d7841` | Locked wasm audits; docs/card budgets; generated await census |
| Schema-dependent test clock and ordinary reader barrier | `78501c5efb`, `53e4cc2bb1` | Nine held-writer reader cases; full CLI and 5,961-test Rust run |
| Valid generators and Lean-admitted residuals | `ad8f8ee1cd`, `34002f5fef` | Native 20k/device 1k/Lean 20k campaigns; 19 smoke tests |
| Valid raw birth oracle and complete compiled client recipes | `72c80653bd` | Strict birth event/meter/maps; 123 guide tests; full client pass |
| Contextual `not`, precise diagnostics and guide discovery | `4c8a0b3e9a`, `0477b5852d` | Language/guide/friction suites; no card budget relaxation |
| Expiry-only search authorization and bounded snapshot progress | `634956b299` | Dense real drains, column snapshot controls, native 20k with no disagreement |
| Starter/Expo adaptation | `ad8f8ee1cd`, `f0210519f6` | Init/periphery/README adaptation in full Rust/client suites |
| Live upgrade release pin and 0.4.26 bump | `e43bb5b35c`, `82855e5ed5` | Four upgrade cases; 98 Rust and 185 client post-bump passes |
| Mac Lean setup and optional-model test contract | `86e805946f`, `ae5d7836c5` | Linux 19 required-model passes; absent-optional native passes; absent-required refusals; Mac 19 restored-model passes |
| Cross-tab browser scheduling | `b6dc002a4b` | Linux 67 runner/adoption passes; Mac 24 follow-window passes; final full host passes use 17 drained timer files with unchanged guards |

## Linux

The complete client stage was repeated at 0.4.26 on `b6dc002a4b`, using the
repaired dispatcher and all 17 serial timer files, with the same green counts.
Final root inventories/guide and fixture/docs/ref closeout checks pass.

Full five-crate `--no-fail-fast` run: **5,961 passed, 0 failed, 41 ignored**,
382 target summaries. Ordinary clients: **381/381 files, 7,382 passed,
0 failed, 56 skipped**. Models: **81 passed, 0 failed**, full 5,000 and 3,000
sequences. Fixtures: nine passed. Package/chat/Expo typechecks and chat check
passed; DX2's ten real browser witness cases passed within the complete pool.
README budget and ref-check passed: 545 LLP documents, 11,771 refs, zero errors
or unchecked references. Root guide: 22 passed, zero failures/skips/preconditions,
121 inherited warnings.

Post-bump qualification at `82855e5ed5`: **98 Rust passes** (74 CLI/init, one
CLI version, one protocol, one native stamp, two versioned guide, 19 difftest
smoke) and **185 client passes / nine skips in 13 files**. Frozen install, native
and wasm build, package build, docs budget and strict wasm attribution passed.
One additional exploratory Node budget check inherited Cargo defaults; it was
immediately repeated with all required flags. Its unused six incremental caches
and guide binary were removed. Required qualification runs used all three flags.
Root inventory audit passed after restoring frozen root dependencies and
regenerating projections: 365 package tests, 35 scripts tests, 31 demos/catalog
entries, 487 publication leaves, 162 guide pages and 1,937 snippets.
Root generated-artifact check passed; no root projection content changed.
Snapback 4 guide: 123 passes. README: 320/320 lines.

Difftest native: 20,000 compiled seeds, 1,096,383 executions, zero generator or
unexpected binder errors and zero disagreements. Device seeds 0–999: 1,000
compiled, 31,406 executions, zero errors or disagreements.

Lean 20,000 compiled seeds / 51,746 executions: 15,282 matched, 4,515
unsupported, 203 disagreements in four existing signatures, **zero new
signatures**. Its exit 1 is retained transparently. Baseline proof is in
`lean-signature-baseline.json`: all four quarry signatures exist at the original
`d814b279d0` and were first committed on 2026-10-08; no new signature is accepted.

## Version and wasm

Bump commit: **`82855e5ed5`**, exactly the ten paths from `5a4779e48a`, including
both test pins. DX2's new live upgrade witness was made package-version-aware in
`e43bb5b35c` before the bump, retaining the intentionally old 0.4.24 baseline.

Clean locked Linux artifact: **2,308,188 B raw / 704,178 B gzip / 531,888 B
brotli**; glue 16,053 / 3,695 / 3,260 B. Cap **704,678 B = measurement + exactly
500 B**. Whole-artifact delta versus Integration 8: +5,447 B gzip; versus merged
pre-bump artifact: -139 B gzip. No per-feature attribution or runtime ceiling
increase. All 69 distinct historical budget rationales survive; only exact
repeated paragraphs were removed. Measurement/budget/drivers: `68f82925d9`;
Linux evidence archive: `940da46b2a`.

## Mac

The first full Mac attempt exposed two missing-oracle smoke failures and two
pooled direct-window browser adoption guard failures. Preserve its actual logs;
stop that already-red attempt after diagnostics and scoped repairs. Its witness
target passed; the earlier commentary attribution to that target was corrected.

The fresh repaired pass at `b6dc002a4b` builds the pinned Lean oracle and sets
`SNAPBACK4_REQUIRE_LEAN=1` for the complete workspace Rust stage. The browser
file runs in the 17-file drained timer-sensitive group, retaining every
assertion and its original 40/60-second guards. The complete repaired pass **passed every stage**: **6,046 Rust passes / zero
failures / 41 ignored** across 1,094 reported summaries; **381/381 ordinary
client files, 7,417 passes / zero failures / 20 skips**; **81 model passes** with
full 5,000/3,000 sequences; nine fixture passes. Cancellation and TODO counts
are zero. Both app typechecks, chat check, release guard, docs budget, package
checks/build and frozen installation passed.

Locked Mac wasm: **2,308,519 B raw / 703,333 B gzip / 531,983 B brotli**, clean
source `b6dc002a4b`, cap 704,678 B, over zero. Linux is the larger gzip artifact:
704,178 B + exactly 500 B = the common cap. Both measurement records are kept.

The xcframework build passed with **two slices**, 15 MiB total. Each static
library exports `_sb4_engine_info` once and contains no wasm info-data export.
The Integration 8 generic arm64 iOS Simulator **Release Swift build passed**
(`BUILD SUCCEEDED`), code signing disabled and bundling skipped. No simulator
was booted. The Mac driver used default TMPDIR, FD limit 65,536, Node 24.19.0,
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and the required published
0.2.33 fence. No other Mac worktree was modified. The only reused
worktree is `~/projects/snapback-integ6`, detached at the SSH-only `sb4-integ9`
ref. Preserve its pre-existing untracked artifacts. Default TMPDIR, FD limit
65,536 and the published 0.2.33 fence are mandatory; no simulators are booted.

## Evidence and reproduction

Committed drivers preserve the actual test commands and platform environment.
Logs and final stage statuses are archived with source commits, counts and
SHA-256 manifests in `linux/` and `mac/`. First-attempt actual failures and
cancellation context are in `mac-attempt1/`. Inspect a compressed log with
`gzip -dc <path>.log.gz`. The Linux complete Rust run began at `3d4730ca24`;
its only subsequent pre-bump delta was the tested JS upgrade witness and
journal. The repeated complete 0.4.26 clients and complete Mac pass bind
`b6dc002a4b`; later archive/journal/measurement commits change no product or
harness semantics. Native library digests are in `mac/native-audit.json`. Required qualification Cargo invocations use
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Never run the full `scripts/test.sh`; execute its publication stages directly.

## Remaining red and delivery

Only the Lean 20k campaign retains an exit-1 red: 203 cases across the four
classified pre-existing signatures, with zero new signatures. Baseline commit
and tree evidence is in `lean-signature-baseline.json`. Required product, client,
root and native compilation checks have no unresolved red. No task is deferred.
The integration and 0.4.26 bump are committed locally on sb4-loop. SSH delivery
uses only sb4-integ9 in the named Mac repository; no GitHub push or npm
publication is performed.
