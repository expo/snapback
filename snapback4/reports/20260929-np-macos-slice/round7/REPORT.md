# NP-mac round 7 — landing fixes and output traversal

Both reported landing failures are fixed without weakening smoke. The output
resolver follows filesystem component order, snapshot-source custody has a
detecting regression, and LLP 3000.030 states preparation's threat model.
Repack remains withdrawn. Nothing pushed or published.

The first command fetched and merged origin/main `b9a4051494`, producing
`209c6ebebbeaa2d99903680afcd38e62c1d61965` without conflicts. The previously
merged PQ, AV and WK work remains. Prompts/reports 0–6, host rules, the supervisor's
failure record and Astra's full round-6 review were read. [CONTEXT.md](CONTEXT.md)
records the scoped LLP orientation. The earlier NOT READY review is preserved,
not represented as approval of this revision.

## Fixes and detecting evidence

| Finding | Fix and evidence |
| --- | --- |
| Six strict TypeScript errors in smoke | Validate each fact and return a `{ program, fact }` pair, then execute from that validated array. This preserves whole-set validation before the first query and gives strict indexed access a defined fact. No non-null assertion or relaxed compiler setting. The real README-examples compile passes on Linux. |
| Restored-session smoke timeout | The old test launch omitted `queryFacts` and `queryGeneration`, so smoke correctly emitted failure instead of `primed`. The fixture now fetches `/schema` from its actual compiled, running backend with its normal guest session, derives the eligible query facts, and supplies that generation. It additionally asserts the receipt's facts and both generation fields. The existing two opens, discarded candidate, single published attachment, refreshed token, success and detachment assertions remain. The targeted Linux test passes. |
| Symlink plus parent traversal escapes | `canonical()` walks components, resolves each link target, then applies `..`; it handles existing, missing and nested targets with a finite link limit. Relative output and native-reference bases preserve raw components, and product lookup uses the resolved build directory. Audit and command-boundary tests cover Clang `-MJ`, forwarded Swift output, linker maps, relative Info.plist paths and parent components inside symlink targets. Existing sentinels remain unchanged, absent destinations remain absent, and preparation issues no build receipt or build command. Both new tests overwrite their sentinel on the old implementation; restoring the old resolver is detected from a passing final baseline. |
| Missing snapshot custody regression | The Xcode fixture changes only snapshot JavaScript from B to C before bundling; live source stays B and the produced HBC contains C. Preparation must fail with `E_WITNESS_PROOF: snapshot source changed during preparation` and no `build.json`. Removing only that existing guard makes preparation exit zero and the regression fail. |
| Threat model | LLP 3000.030 §3 explicitly says output confinement is hygiene for well-behaved projects, not a security boundary: Pods and build phases execute arbitrary scripts with the user's privileges. Source inventories and settings audits are not an adversarial sandbox. |
| README budget discovered during this round | The inherited lane README was 314/300 physical lines. Shortened the native introduction and repeated prose to 300, retaining the command, pins, exact measured timings, setup costs, limitations and examples. No budget increase or removed example. |

The pre-fix and mutation failures are intentional detecting controls, retained
separately from passing qualification. There is no bypass for missing compiler
facts, server-only online loading, device loading, stale generations or failed
session candidates.

## Linux verification

Linux execution uses the fleet's **expo-build-1000**, endpoint hostname
`expose-builder-pixel`, Ubuntu kernel `6.8.0-138-generic`, x86_64, 96 available
CPUs. Node **24.13.1**, Bun **1.3.14**, Rust/Cargo **1.97.0**. The short alias
`eb1000` did not resolve on this Mac; the inventory's authenticated SSH address
worked. Initial load was 2.17 with 241 GiB available memory and 351 GiB disk free.

A separate worktree at `~/sb4-np/lane-linux-r7` received the local merge through
a Git bundle and the exact working diff. The supervisor's worktree was read only;
its 17 GiB Cargo cache was copied without hard links, then rebuilt in this lane.
Dependencies were installed with the frozen lockfile. The supervisor's generated
wasm was copied after verifying no core/device/Cargo/build-script source delta;
its hashes are retained. This is artifact reuse, not a fresh wasm measurement.

The complete client stage uses exactly `scripts/test.sh`'s file selection and
CPU formula: **238 files, concurrency 24**, excluding the two model files, then
both full-count model files in their separate serial stage. No reduced seeds,
timeout increases or extra client shards. [tools/linux-checks.sh](tools/linux-checks.sh)
records the commands and prerequisites. It does not claim a complete `scripts/test.sh`
run: the commissioned client, docs and affected witness stages ran.

| Check | Result |
| --- | --- |
| Complete client stage | **5,123 passed, 0 failed, 10 declared skips; 407.668 s** |
| Full-count serial models | **79 passed, 0 failed, 0 skipped; 307.976 s**; 5,000 online and 5,000 local session sequences, plus 3,000 online-client interleavings and all replay cases |
| README examples, final prose | **6 passed**, including the strict TypeScript compile |
| Restored-session smoke, targeted | **1 passed**; also passes in the complete client stage |
| Docs budget, final prose | **300/300** lines; named self-containment test **1 passed** |
| Guide, final prose | **99 passed** |
| Witness unit / Linux driver tests | **10 / 10 passed** |
| Package typecheck/build and chat check | Passed |

The final Linux implementation/README hashes equal the local files in
`source-pins.json`; `linux/source-binding.json` records that comparison. README
prose changed during the client stage, so the final README, budget and full guide
checks were repeated afterward; all executable changes preceded the full run.

The initial docs-budget failure (314/300, with self-containment passing) is
retained beside the corrected result. A preliminary Mac package build failed
because ignored generated wasm declarations were absent after dependency setup;
Linux reused the source-matched generated artifact and passed package typecheck
and build. Neither setup failure is relabeled as a passing test.

## macOS checks and native rerun

On the commissioned Node **24.18.0** / Bun **1.3.12** / Rust **1.97.0** PATH,
all **34 helper/preparation/smoke tests** and **30 witness driver tests** pass. The isolated preparation baseline
passes **13 tests**; restoring lexical resolution or deleting snapshot custody
makes the appropriate tests fail. The CLI builds. Root reference and whitespace
checks pass. No core, device, client contract or wasm source/budget changed.

One final warm own `--build` with the updated local smoke helper passes all three
segments. This is the only native attempt in round 7, not a five-run timing sample.

| Phase | Milliseconds |
| --- | ---: |
| Complete invocation, through finalized evidence | **142,168** |
| Preparation | 114,735 |
| Snapshot / Pods / Xcode | 6,714 / 12,404 / 45,472 |
| Prime / cold offline / restart | 5,798 / 5,046 / 4,847 |
| Separate simulator creation and boot | 17,658 |

The app signs in normally and creates eight messages through real mutations on
the newly created simulator, then uses the same account/store through all three
segments. No driver-supplied credentials, rows, fabricated responses or resets
between segments. The [offline screen](screens/smoke-ios-offline.png) shows NP B,
the green asset and held history. Six device-answerable queries return data
offline; compiler-declared server-only operations record expected unavailability
offline and answer online. Restart consumes the exact barrier.

Independent Python verification recomputes every app/xcresult entry, HBC 98 and
hash, phase log, native dependency record, read-only receipt, preparation/proof
binding and finalized artifact. Each selected bundle URL/path, Release/Hermes
flag, generation/fact set and eight-message/font/media probe agrees. All five
embedded preparation helper hashes match final source. CLI SHA-256:
`dd6546c0ea4bcce2d25040777c2322cd54c5d3da745b73b653b9b36a4931fae6`.
HBC is 3,468,310 B; SHA-256
`c78cfebf8348bab1110b1222ef2525655d1683d56a61603d07c83444aed2f092`.
App inventory is 51,652,693 B; digest
`fde2b1ab0fea97f8eb323a5392995296cd74902c8e18d5e8d8f2b36d2431598d`.

The subject retains Expo 57.0.22 / RN 0.86.3 and the previously disclosed native
helper patch against published 0.4.7 packages. Only its smoke source was updated
this round; [subject-helper.patch](subject-helper.patch) records the complete
unpublished helper delta. No native-core/client-package edit or new tool install.
The sole owned UDID, `E6E47B14-F1B7-49E7-8571-D9F9D8680485`, was shut down and
deleted after evidence preservation. No other simulator, unowned process,
system/Xcode selection, keychain or provider secret file was touched.

## Retention and scope

[EVIDENCE.json](EVIDENCE.json) maps lossless compressed raw evidence to both
source and archive hashes; every archived entry is reverified. Raw originals and
large `.app`, xcresult and video artifacts remain under
`/Users/ccheever/sb4-np/evidence/round7/`, bound by committed inventories.
Private backend/session stores are excluded. Linux raw logs and source hashes
are copied into the same record; the remote worktree remains recoverable.

LLP 3000.030 stays Accepted for the bounded build route. Repack, physical devices,
general native shapes, M6/M8 admission, broader repeatability and publication
remain separate. One journal entry accompanies the local commit with
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
