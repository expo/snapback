# NP-mac round 6 — snapshot environment and receipt validation

Astra's three findings and Grok's additional Medium are addressed with detecting regressions. Repack
remains withdrawn. This round changes only witness preparation, receipt
validation, tests and their documentation; no client/core/wasm change.

## Review and changes

First fetched and merged origin/main `6234118df8`, producing `35638e8041`.
The only conflicts were four journal blocks. Both parents' complete journal
line sequences were verified as preserved. Rounds 0–5 prompts and reports,
host rules and Astra's full round-5 NOT READY review were read. Grok was absent
initially and arrived at the first completion check, after the first successful
native run; its full READY WITH CHANGES review was then read and applied. The scoped
[context and write audit](CONTEXT.md) records the governing LLPs. The prior
review is not an approval of these changes.

| Finding | Fix and detecting evidence |
| --- | --- |
| Medium: copied `.xcode.env.local` follows an outside link | Remove only the snapshot entry, then create its regular replacement with `wx`. The successful preparation fixture starts with an absolute symlink to an outside sentinel; it requires the sentinel and source link unchanged, a regular snapshot file and exact quoted NODE_BINARY contents. Before the fix, the sentinel becomes the export line. The copied old-write mutation fails the same assertion. |
| Low: rejected generation leaves segment passed | Validate origin, both generation fields, query facts and lifecycle fields before assigning the segment status/error. Collection uses the same validator. Driver fixtures require wrong `queryGeneration` and `generation` to produce exit 1, prime failed with its error and later segments not-run, while retaining the app's pass receipt. A late appended restart receipt tests collection separately. Both new tests fail on the old driver: prime stays passed and the collection case exits successfully. |
| Low: tests miss writable build receipts | The successful preparation assertion now requires `build.json` permissions exactly `0444`. The existing create-once/EEXIST assertion remains. With ordinary umask `022`, deleting `mode: 0o444` produces `0644` and fails the new assertion from a passing baseline. |
| Grok Medium: sibling Xcode output destinations and dangling links | Share the raw/resolved output-key predicate; cover module/precompiled-header/module-map destinations, Clang build-session files, per-architecture link/Swift/metadata lists, prelink dependencies, temp/object/Metal directories, and Info.plist/dSYM names relative to their output roots. Pin the build-session file in every query/build invocation. Canonicalization uses lstat and resolves missing targets through final/ancestor links, so the private-output check sees their actual destinations; cycles refuse. Raw conditional-setting and resolved Pod tests cover each key, private positives and relative escapes. Command-boundary tests preserve an outside sentinel for every key and require a dangling linker target to remain absent, before compilation or receipt creation. |

Grok's repeated Low request to require `--udid` always remains the explicit
round-2/round-4 deferral recorded in LLP 3000.030 §12. This round does not change
the sole-booted-device product policy; every native command here supplies a
newly created owned UDID. Its generation-status finding is fixed above.
The review's signing/HOME observations do not become claims of sandboxing or
physical-device qualification.

The direct-write audit finds no other preparation helper write into copied
snapshot files. Other direct writes are logs, receipts and phase summaries in
the artifacts directory. Existing prebuild/Pods/Xcode adapters and their
output audits remain; this is not a new arbitrary-script sandbox claim.
LLP 3000.030 §§3 and 6 now state the corrected preparation and validation rules.
The witness guide already promises read-only receipts and no rejected segment
marked passed, so its product wording needs no expansion.

## Checks and native verification

Affected checks pass: **33 JavaScript helper/preparation/smoke tests, 30 driver
tests, 10 witness unit tests and 99 guide tests**. The CLI builds successfully.
The 33 helper and 99 guide checks/build were rerun after Grok's additions;
the Rust smoke/driver code is unchanged from the passing 30/10 runs.
The deliberately red pre-fix and mutation runs are retained separately from
these passing checks. No unexpected affected-test failure occurred.
Final reference audit passes: 524 LLP documents, 9,923 references, zero errors
or unchecked references. Diff whitespace checks pass.

Commands ran from `snapback4/` with commissioned Node/Bun/Rust first on PATH,
explicit DEVELOPER_DIR and TMPDIR under `~/sb4-np/`:

```sh
node --test packages/snapback4/test/witness.test.mjs packages/snapback4/test/native-smoke.test.mjs packages/snapback4/test/witness-preparation.test.mjs
cargo test -p snapback4 --test witness -- --test-threads=1
cargo test -p snapback4 --bin snapback4 verbs::witness::
cargo test -p snapback4-lang --test guide
cargo build -p snapback4
```

The pre-fix generation run used `cargo test -p snapback4 --test witness
generation -- --test-threads=1`: two new regressions failed and the existing
served-source-race case passed. The pre-fix preparation run used
`--test-name-pattern='preparation rejects wrong'`. Isolated JS mutation copies,
commands and results are retained by `tools/mutations-r6.py`.
Both added Grok unit cases also fail on the preceding implementation. The final
baseline plus six isolated mutations detect the original environment overwrite,
writable receipts, an omitted sibling output key, missing relative-output checks,
the old dangling-link canonicalizer and a removed build-session pin. No mutation
is counted from a failing baseline.

Final `warm-build-smoke-4` passes in **149.491 s** complete, including preparation,
installation, prime/cold-offline/restart, capture finalization and hashing.
Preparation is 119.912 s, Xcode 49.899 s; prime/offline/restart are
6.224/4.925/5.238 s. This satisfies the requested complete warm rerun after the
last behavioral change. It uses a new simulator's normal app signup and eight
messages seeded through ordinary mutations into the existing subject backend.
No driver-supplied credentials, rows or replies; no reset/reinstall between segments.

Independent Python lstat/hashlib verification passes for every app and xcresult
inventory entry, HBC 98/hash, phase log, native dependency record, read-only build
receipt, proof binding and finalized artifact. Each launch's selected file,
Release/Hermes flags, query generation/facts and NP B/eight-message/font/media
probes agree. All five embedded preparation helpers match final source bytes.
Final CLI SHA-256 is
`6a7140b0c454a38b68471023abfea615d9d8bd93d25cf0a1eca51cccbfbc455f`.
The records retain actual server-only unavailable-offline results and online
answers; no smoke classification changed. Both reviewers' files were rechecked
byte-for-byte against the saved copies after this run.

## Every native attempt and limitations

The first attempt, `warm-build-smoke`, injected the outside environment link
into the real subject before invoking `--build`. It exited 1 in **5,764 ms**:
the subject's explicit Xcode `$(SRCROOT)/.xcode.env.local` input reference
triggered the existing `E_WITNESS_NATIVE_COMPAT` audit before snapshotting.
The sentinel stayed byte-identical, but this is **not detecting evidence for
the new write guard or a successful native run**. The wrapper's success
assertion failed. Its finally block restored the original source entry by
rename. Full commands, diagnostics and sentinel hashes remain in evidence.
The preparation fixture models the reported shape without that explicit
Xcode reference and reaches the vulnerable write. The normal-source native
run uses a new artifacts directory, `warm-build-smoke-2`.

`warm-build-smoke-2` passed all three segments in **212,958 ms** (179,970 ms
preparation, 77,017 ms Xcode; prime/offline/restart 6,978/5,636/6,079 ms).
It was independently verified and its simulator removed before Grok arrived.
Its evidence remains under `pre-grok-*` records; this is a pre-Grok success,
not final qualification of the additional output checks. A fresh owned simulator
and `warm-build-smoke-3` were used for the next rerun. Xcode succeeded, but
the initial dangling-link implementation then refused the system Accelerate
`vecLib.framework/libBLAS.dylib` input, whose target has no on-disk file. That
attempt failed in **142,818 ms**, without a build receipt or install. The final canonicalizer
resolves missing targets, allowing system input provenance while refusing
outputs that resolve outside the cache. Private dangling-target and cycle
tests cover the distinction. `warm-build-smoke-4` uses that final code on the
same owned simulator, with a fresh artifacts directory.

No five-run timing sample or new median/p95 is claimed in this narrow round.
The previous round's sample remains historical; native warm-cache timing here
is a single shared-host observation. The subject's native-module/helper and dependency pins,
normal app authentication and smoke classifications are unchanged.

## Custody and scope

Apple M5 Pro mini, macOS 27.0, Xcode 27.0 / iOS 27.0, CocoaPods 1.17.0,
Node 24.18.0, Bun 1.3.12 and Rust 1.97.0. Exact command/tool/package/source
pins are retained. The subject remains Expo 57.0.22 / RN 0.86.3 with published
Snapback 0.4.7 client and native core bytes: 178 client and seven framework
files compare equal to stage 0. Its disclosed seven-file local witness helper
patch is unchanged from round 2. No dependency/tool download or signing change.

Only newly created UDIDs `72601CAE-DB7D-4EFD-B1A2-57F6DE800DF4` (pre-Grok) and
`9C5C3FF1-7970-44C0-890F-FD26F4DCE14F` (final rerun) are used.
Creation/boot took 37.587 / 20.833 s separately; both owned simulators were shut
down and deleted after preservation. No other simulator or unowned process,
system/Xcode selection, keychain or credential file was touched. No provider
secret file was read or copied. Private backend/session stores are excluded
from report artifacts. No new wasm measurement is claimed; the 593,719 B gzip
cap is unchanged. M6/M8 admission, physical devices, repack and publication
remain outside this round. Nothing pushed or published.

Raw evidence remains under `/Users/ccheever/sb4-np/evidence/round6/`.
[EVIDENCE.json](EVIDENCE.json) binds 2,662 lossless compressed copies, all
reverified after archiving; large app,
xcresult and video artifacts remain local, bound by the retained inventories.
One journal entry accompanies the local commit and the commissioned
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer.
