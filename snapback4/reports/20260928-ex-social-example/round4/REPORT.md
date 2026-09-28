# Lane EX round 4 — exercise the published adoption document everywhere

2026-09-28. Branch `sb4-intent/ex-social-example`, starting at `c72f716b8`.
Read rounds 0–3 prompts, reports and EX journal entries. Kept the existing
base: no main merge, push or publication. No shared tool installation.

## Repair and governing context

The supervisor's two `snapback4::init` residency failures are **ours**:
round 2 moved the executable adoption example into the package but left
four `include_str!` sites reading the old forwarding-only file. Those sites
now load `packages/snapback4/FOLLOWING-ADOPTION.md` directly. This includes
the example extractor, the calibration's documented row/byte comparisons,
the authorization census and its generated-bridge fixture.

Every assertion is unchanged, including exact census membership, prediction
outcomes, page completeness, privacy, calibrated rows and bytes. The package
document is unchanged in this round; tests compile the bytes builders read.
Deleted `src/recipe/ADOPTION.md`: its only remaining function was forwarding
to that document. Updated the remaining live link in the legacy feed fixture.
Historical reports/journal entries and the published-text guard's deliberate
negative controls retain the old spelling as evidence, not live guidance.

Read-only `llp-orient` covered the shared Following fixtures, authorization
census, package adoption procedure and compiled feeds/social cards. Governing
constraints are LLP 3000#4 (the Snapback 4 fence), LLP 3000#6 (simulator
invariants), LLP 2000.000#7 (declared partition custody) and LLP 3000.028#8
(executable published recipes). These are in `llp/current/`, not foundation.
No runtime, authority, budget or protocol decision changes; no hand-off is
needed. The scoped corpus update is the round-4 note in LLP 3000.028 §8.

## Consumer audit

`changed-documents.json` enumerates the guide, recipe and package documents
changed by the five EX implementation commits across rounds 0–3, including
the embedded social README. Searched repository paths and loader spellings:
`include_str!`, `include_bytes!`, `readFileSync`, `readFile`, `read_to_string`,
Python reads, local `read` aliases, `guide::card`, `guide::language`, constants,
keyword iteration and CLI `guide` invocations. Followed shared Rust modules
to their top-level targets. The raw search and the reviewed target mappings
are retained in `document-load-search.txt.gz`, `rust-consumers.json` and
`other-consumers.json`.

The Rust inventory is deliberately conservative: **65 source consumers in
45 targets**, including unchanged cards reached by shared guide loaders.
Every mapped target runs in the Cargo artifact inventory used by the full
suite. This includes:

- `snapback4::init`, `feed_bridge`, `timeline_adoption`, `maintenance_chunks`,
  `maintenance_latency`, `scale`, `scale_row_ranges`, `check`, `fix`, `clock`,
  the binary unit target (including doctor), `witness`, and `latency`;
- `snapback4-device::device`, `readauth`, and `unread_range`;
- `snapback4-sim::clique` (Following, calibration/promotion, trending and search);
- `snapback4-core::lane_source` and `review_walk`;
- 26 `snapback4-lang` targets, including whole guide, aggregate census,
  owner keys, residency notes, search guidance, maintains and discovery.

Package consumers are `first-account`, `online-session`, `ordinary-history`,
`react`, `readme-examples`, `social-starter`, and `unread-range` tests; the
full suite runs each. `scripts/docs-budget.mjs` also reads the README and
runs its first-account guide check. The CLI embeds guide modules and the
social README; the suite rebuilds it and exercises discovery and scaffolding.

The retained round-3 published-module checker is a separate consumer of the
packed adoption text. Reran it with `--named-keys` on published Linux 0.4.7,
using the prior published installer fixture. First verified its packed
document is byte-identical to the current package file. Manual wiring passes;
adding the absent `feedAppPublish` helper fails with the expected
`E_QUARRY_UNKNOWN`. This preserves the prior explicit legacy-key adjustment
and makes no claim that untouched 0.2.33 source compiles on 0.4.7.

## Qualification

Existing Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127.
Commands ran from `snapback4/`; no test environment override was supplied.

| Check | Result | Evidence |
| --- | --- | --- |
| `cargo test -p snapback4 --test init` | **21 passed, 0 failed**; both reported residency tests pass | `snapback4-init.log.gz` |
| `cargo test -p snapback4-device --test readauth` | **81 passed, 0 failed**; exact census unchanged | `snapback4-device-readauth.log.gz` |
| `cargo test -p snapback4-device --test device` | **436 passed, 0 failed, 1 existing ignored** | `snapback4-device-device.log.gz` |
| `cargo test -p snapback4-sim --test clique` | **253 passed, 0 failed, 1 existing ignored** | `snapback4-sim-clique.log.gz` |
| `cargo test -p snapback4-lang --test guide` | **97 passed, 0 failed** | `guide.log.gz` |
| Published-module manual / missing-helper control | Both expected outcomes pass | `published-module.log.gz`, `published-module.json` |
| Assertion/source audit | Only four path substitutions; package document unchanged | `assertion-audit.json` |
| Root `./ref-check --verbose` | **522 LLP docs, 9,792 refs; 0 errors, 0 unchecked** | `ref-check.log.gz` |
| Whitespace, source caps, journal append-only | Pass | `audit.json` |

The named `init` and `readauth` targets completed first. The whole guide ran
while the broader device/simulator targets progressed; all five completed
before `bash scripts/test.sh` began. No ignored test was added or changed.
Ran `bash scripts/test.sh` **exactly once**, exit **0**, with the unchanged
suite inventory, assertions and timeouts. Its exact final summary is:

```text
== 0 failure(s) in 1325 s
```

Full-run totals: **Rust 4,210 passed / 0 failed / 33 ignored**; **client shards
3,944 passed / 0 failed / 10 skipped** across all eight shard summaries;
**client models 79 passed / 0 failed**; **fixture wrappers 9 passed / 0 failed**.
The Rust count excludes the separate docs-budget probe. Every mapped Rust
consumer target ran successfully, including every shard of the larger targets;
`rust-consumer-results.json` records their results. All seven mapped package
consumer files ran in the complete client glob. This includes starter
new/check, full app/four-snippet typechecking, cold native/wasm owner-key
coverage and the public-client smoke. The social browser witnesses also pass.

Cargo/workspace build, production wasm build and budget, release guard,
package build/typecheck, chat schema check, chat and Expo typechecks, and
README **300/300** budget all pass. `test-sh.log.gz` preserves the entire run;
`full-suite.json` records its launch and exit, and `suite-summary.json` its
counts. The final test-source diff still equals `tested-diff.patch.gz` (decompressed) exactly.
No second full run or post-run source repair was necessary. Log compression
preserves exact content; `logs.json` records original lengths and SHA-256s.

## Failures and wasm

**No test failure this round: ours 0, baseline 0, environmental 0.**
One final evidence-formatting failure was **ours, corrected**: staged
`git diff --check` flagged two blank context lines in the retained raw patch
as trailing whitespace. Compressed that exact patch, preserving its hash and
contents, and reran the staged check. No test source changed and no full-suite
rerun was needed.
The supervisor's prior-round `w7a_residency_measures_the_wired_500_follow_reader`
and `w8b_residency_measures_the_wired_calibration_shape` failures were ours,
caused by the missed document consumers. Both pass in the focused run and the
full suite. No baseline or environmental attribution is needed to explain
this round's results; passing once does not close historical flake tickets.

The published-module negative control intentionally exits 1 with
`E_QUARRY_UNKNOWN` for `feedAppPublish`; the checker itself exits 0. It is
sensitivity evidence, not a failing product test. Inspection-only commands
encountered guessed `following.rs`/`doctor.rs` paths and unmatched report
file globs; corrected by source/module lookup. The doctor consumer mapping
was corrected to the binary unit target and checked against Cargo metadata.
No edit or test was skipped because of those inspection misses.

Fresh production wasm from the full suite: **2,018,847 B raw / 585,970 B
GNU file-input gzip-9**, unchanged **586,193 B** budget, **223 B** headroom.
Raw artifact SHA-256:
`9609882339d4e5d73065c5d608c90da71efaa27c824a7d92d32ebed5ee581bd1`.
Byte-identical to the round-3/input artifact, **0 B raw / 0 B gzip size delta**.
`wasm-before.json` and `wasm-after.json` retain the measurements. Rechecked
its final hash after the suite finished. No device/core/build/budget inputs,
dependencies or publication versions changed.

Native Expo/Hermes/iOS/Android lifecycle qualification and OS adoption remain
outstanding. This repair adds no native lifecycle, scale, calibration or
publication claim and does not complete LLP 3000.028 §8.
