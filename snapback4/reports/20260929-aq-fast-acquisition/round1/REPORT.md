# AQ round 1 — fence cached pre-AQ clients

2026-09-29, `sb4-intent/aq-fast-acquisition`, eb1000 / expose-builder-pixel.

Both Astra findings are fixed. Format 3 now opens physical IndexedDB version
**2**. Chromium rejects pre-AQ version-1 opens with **VersionError** before an
older adapter can read or mutate migrated data. Migration remains strict and
the regression now asserts the actual transaction’s durability on abort and retry.

First ran `git fetch origin && git merge origin/main`. The only conflict was
append-only JOURNAL.md; retained both sides without rewriting entries. Merge
commit `50b66b6a0` includes origin/main `b7d05baff661db08bb99250d80b1090a8ed99346`.
Read the round-0 prompt/report and Astra review in full; checked Grok at start
and during verification. Its completed **READY** review was read in full; both
Low coverage findings are addressed below. Its verdict did not identify Astra’s
reproduced downgrade bug; that High is fixed regardless of the differing verdict.

## Change and browser evidence

`web-idb.ts` opens version 2 for both fresh and existing databases. Its upgrade
callback only creates `changes` and a new format marker when `oldVersion === 0`.
Existing object stores, format markers and records survive the version upgrade.
The later format-1/2 row migration remains a separate strict transaction. If it
aborts, the old row representation remains intact inside physical version 2;
the current adapter can retry, while version-1 adapters remain fenced.

The real Chromium test bundles the **verbatim pre-AQ adapter and its two runtime
dependencies from f9620c815** beside current source. Frozen files and SHA-256
custody live under `test/fixtures/pre-aq-f9620c815/`; running tests needs no git
history. It writes 600 rows through the old adapter, migrates with the current
adapter, and verifies all rows plus watermark, outbox, stage and base images.
A second object store retains its sentinel. Both the cached old adapter and a
new old instance then attempt load, point read, delete+watermark save and a
direct update: all eight reject with VersionError and leave contents unchanged.
The current adapter can delete and update, and reopen with 599 rows, watermark
2, the deleted row absent and the new packed update visible. A new format-3
database also rejects the old adapter.

Chromium’s error states that the requested database version is less than the
existing version. No data clearing or automatic reacquisition is used. The sync
guide tells builders to reload updated page/Worker bundles and keep them
available for offline reopening. Clearing storage would lose retained rows and
pending writes. The error protects sequential incompatible owners; Web Locks
alone only serialized them. Existing two inspection helpers and the navigation
witness now open the current version instead of hard-coding version 1. The
Node existence-fallback mock now supplies the browser’s `oldVersion: 0`
event when simulating database creation.

The format-2 abort/retry regression observes the migration transaction itself:
`durability === "strict"` on both attempts. This is a browser configuration and
atomicity witness, not a physical power-loss test. No bucket algorithm, wasm,
server, authorization, coverage, progress, meter or durability relaxation.
LLP 3000.007 §20.4 records the physical fence and abort/retry distinction.

Grok additionally found that deleting `b` from `packedStore` escaped the old
migration test. The fixture now includes a packed prediction-base image and a
direct base overflow image, and checks point reads after abort, migration and
updating the overflow key. The `base-store` mutant removes only `b` and fails. Grok’s `strict`→`default` mutation is also tested separately from Astra’s
`strict`→`relaxed` mutation. Its two weaker oracles are strengthened: format-1
bounds now check every physical bucket rather than the empty routing root, and
the split regression checks every key against a distinct original value.

These final test-only additions arrived after the full suite’s client stage;
the final browser suite was rerun separately. Product code stayed unchanged
throughout the full suite. The whole guide’s final text was tested before it.

## Validation

- Browser review suite: **15 passed / 0 failed** (14 child cases plus parent).
- Other affected tests: **86 passed / 0 failed** — web-start, web-durability,
  web-worker-control and web-navigation; final run uses the rebuilt package.
- Real navigation witness: two durable writes retained and both visible after
  reopen; exit 0.
- Whole guide: **98 passed / 0 failed**.
- The new test fails against round-0 product source. The isolated version-1
  mutant also fails its VersionError assertion. The strict→relaxed migration
  mutant fails the new durability assertion. Grok’s default-durability and
  base-store controls are also rejected. Each control’s other 13 tests pass.
- Reference audit: 523 LLP docs / 9,857 refs, no errors or unchecked refs.
- `scripts/test.sh` ran **once**, exit 0. Exact summary:
  **`== 0 failure(s) in 1374 s`**. Rust targets and doctests, fixture wrappers,
  builds/typechecks, release/size checks and every client stage passed.
  Clients: **4,566 passed / 0 failed / 10 existing skips**; final full-count
  models: **79 passed / 0 failed**. No full-suite failures are ours, baseline
  or environmental. The inherited 60-second suite target remains exceeded;
  no timeout, skip count, model count or size budget was relaxed.

Reproduction from `snapback4/` (the four mutants should exit 1):

```sh
node --test packages/snapback4/test/web-review.test.mjs
SNAPBACK4_WEB_REVIEW_MUTANT=database-version node --test packages/snapback4/test/web-review.test.mjs
SNAPBACK4_WEB_REVIEW_MUTANT=migration-durability node --test packages/snapback4/test/web-review.test.mjs
SNAPBACK4_WEB_REVIEW_MUTANT=migration-default node --test packages/snapback4/test/web-review.test.mjs
SNAPBACK4_WEB_REVIEW_MUTANT=base-store node --test packages/snapback4/test/web-review.test.mjs
node --test --test-concurrency=2 packages/snapback4/test/web-start.test.mjs packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/web-worker-control.test.mjs packages/snapback4/test/web-navigation.test.mjs
node witness/navigation.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 cargo test -p snapback4-lang --test guide
```

Full-suite command:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 bash scripts/test.sh
```

Every observed failure, including deliberate controls and corrected inspection
helpers/event fixture, is classified in [FAILURES.md](FAILURES.md). Gzip logs retain unedited results; decompress them to inspect the raw output.

Canonical rebuilt wasm: **2,040,529 B raw / 592,975 B gzip-9**, **744 B below
the unchanged 593,719 B gzip cap**. SHA-256
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
No performance remeasurement this round; round 0’s measurements remain historical
and Astra independently verified them. This correction adds a one-time database
version upgrade and preserves the steady-state packing algorithm.

Both review files were rechecked after the suite; their final contents and hashes
are retained in `input-*-review.txt` and `review-checks.json`.

Local commit includes `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
Nothing pushed or published.
