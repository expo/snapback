# DK round 1 — dev clock and stale-session explanations

Date: 2026-10-07. Revision base: `a57f089564` (r0); original main base:
`46803201b499`. Branch: `sb4-intent/dk-dev-clock-and-stale-sessions`.
This report supersedes the r0 implementation report preserved in that commit.
Work stayed in the supplied lane on eb1000. No other worktree/process was
modified, nothing was published, and nothing was pushed.

## Review dispositions

Astra's r0 review was NOT READY. All three findings and the requested storage
simplification are addressed:

- **P1, public dev routes:** detailed bearer explanations require dev mode **and**
  the same loopback peer, literal loopback Host and optional loopback Origin check
  as dev-only endpoints. Public POST route admission stays unchanged. All bearer
  refusal sites use that predicate, including route authentication, detached
  reads, held-poll rechecks and refresh. Serve and untrusted dev requests get
  exactly `this session is not live; sign in again` for each token state. No
  cause field is added. This deliberately avoids disclosing whether a token
  belongs to this public server or how it ended.
- **No persistent token history:** diagnostics add or remove no SQLite objects
  or records, at open or during session lifecycle operations. No process cache
  is used either. A read-only lookup can identify expiry while the existing
  session record remains. An absent record cannot distinguish expiry, sign-out,
  refresh or another store; the trusted-dev message states that uncertainty:
  `this session is unknown to this store: it may come from an earlier or replaced
  store or another instance, or have expired or been signed out (including before
  this server started); sign in again and discard saved tokens from an earlier store`.
  This is the calibration repair without inventing durable token provenance.
- **P2, startup cost:** inspection traverses the latest 64 `_commits` records in
  reverse primary-key order. It reads no application rows, performs no global
  timestamp maximum/sort and retains no historical stamp set. Table metadata
  uses `octet_length(touched)` before materialization: SQLite gets the byte count
  from record metadata, so oversized values are omitted without loading them.
  At most 4,096 bytes per commit are decoded and at most eight names of at most
  128 bytes each are printed. Omissions are explicit; all 64 timestamps still
  participate in the largest-lead calculation.
- **P2, appointment false positive:** only `_commits.at` can trigger the note.
  Application IDs, appointment times, expiries and other row values are never
  examined. A normal appointment matching a historical future commit cannot add
  its table to the note or supply clock evidence.

The note now describes **recent commit stamps**, not an inventory of retained
future rows. It can miss future commits outside the newest 64, even with their
rows still present. Conversely, historical commit evidence can outlive deleted
rows. The false-positive control explicitly checks this: the already-present
historical warning remains about the original table after a matching appointment
is inserted into another table; after 64 normal commits it disappears while the
future appointment values remain. These limits are stated in the guide's note
text, Operations recipe, client documentation and governing LLP.

## Retained behavior

Dev startup prints one `N_CLOCK_STORE_AHEAD` note at a lead above 5,000 ms, with
the largest observed lead, table names and both remedies. Normal stores and
matching-offset restarts remain quiet. Doctor shows the offset from wall time
and the same bounded fact; with no host it explicitly uses wall time. Its quiet
result now also says “in the latest 64 commits”, avoiding an exhaustive claim.

`clock advance` CLI/endpoint still return cumulative `offsetMs` and the restart
lifetime, with `dev --fresh --port 4401` advice when application data exists. The
guide recipe uses that disposable store/port and an explicitly configured client
URL, then stops the host and starts fresh for each test. New stores need new
sessions. No new flags or store format changes are required. `check --store`
remains a schema-adoption check: without a running-clock selector, wall-time
comparison there would warn during intentional offset tests.

SDK online/local clients, app fences and the app online arm still preserve the
first current-credential terminal refusal. Ordinary signed-out clients still ask
to sign in. `E_AUTH`, family `auth` and generated public types stay unchanged;
package build regenerated declarations and typecheck passed. No wasm or device
engine source changed in this round; no wasm budget change was needed.

## Startup benchmark

The checked-in [benchmark](round1/benchmark.py) recreates Astra's workload in its
own temporary directory: 100,000 rows with 8 KiB payloads seeded through the
product API, then one future commit/row (100,001 total; 882,970,624-byte store).
Published 0.4.14 was downloaded from npm and verified against Astra's recorded
SHA-512 integrity. Its binary SHA-256 matches Astra's
`ea8b00e2316f8457cc5bdf46a17c8f1a2202f2315ee9c235c8cf84a9bfc620f1`.
The new production binary SHA-256 is
`6e792f9405bc70aace5dd3e5eeb32afbe3379823d13d255dc06de7ea4f24ba14`.
Both ran on the same fixture, five interleaved times per case, after this lane's
builds/tests finished. The production build used
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production`.
Like Astra's comparison, this compares the published musl package with the local
production build; the small difference is not a general speedup claim.

| Store | Published 0.4.14 startup, ms | DK round 1 startup, ms |
|---|---|---|
| 100,000 normal-clock rows | 7.255, 6.038, 6.585, 6.254, 6.001 | 5.151, 5.575, 5.673, 5.627, 5.142 |
| 100,001 rows, including future commit | 5.723, 6.565, 6.524, 5.404, 6.556 | 4.918, 5.647, 5.289, 5.681, 5.128 |

Future-store startup medians were **6.524 ms published / 5.289 ms round 1**.
This meets the requested few-millisecond budget; Astra's r0 result was
674–699 ms against 5.6–6.9 ms. Round-1 `/dev/clock/status` took **1.16–2.58 ms**
including the HTTP request and reader acquisition. Doctor succeeded in every
run; its total time still includes its existing non-clock work (about 0.53 s).
Every normal-clock run had no note, every future run had the expected note,
and the complete SQLite schema remained identical to the published-created
fixture. The 12 KiB difference from Astra's fixture is not used as performance
proof; data/row counts and the construction recipe are recorded explicitly.

[Raw measurements, binary digests and startup output](round1/production-scale.json)
are retained. Reproduce from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production
python3 reports/20261007-dk-dev-clock-and-stale-sessions/round1/benchmark.py target/production/snapback4 /tmp/dk-production-scale.json
```

## Validation

- SDK build, declaration generation, typecheck and supplied dependency checker:
  passed; the latter printed `deps-ok`.
- HTTP auth diagnostics: two tests covering full/read sessions, unknown,
  retained-expired, signed-out and refreshed tokens, dev/serve wording on
  query/schema/change-poll/refresh, ordinary signed-out behavior, and public
  routes with trusted/foreign/malformed/duplicate Origin and Host controls.
- Core identity unit tests: **6 passed**, including unchanged SQLite schema and
  zero writes during diagnostic lookup. Identity/read-session/bound-session
  integration: **17 passed**.
- Server affected unit tests: **192 passed, 4 ignored** (existing child-process
  fixture entry points). The public-route controls are included.
- Clock/replay/dev-refusal integration: **65 passed**. Clock includes actual
  startup, normal/future stores, matching offsets, doctor, cumulative advance,
  isolated-store advice, and the historical-commit/appointment control.
- Clock bound/tolerance/metadata omission tests: **2 passed**; clock integration
  rerun after the final bounded-metadata query: **22 passed**.
- SDK reason/session-security/read-only/app-session regression selection:
  **228 passed, 1 skipped**. The skipped existing downgrade test requires a
  separate verified 0.4.13 binary; the benchmark uses the requested 0.4.14.
  Reason preservation covers local, online, app-online and app-device, both
  dev/serve messages and subsequent query/mutation/action calls.
- App session model: **52 passed**, including **5,000 online and 5,000 local**
  seeded three-runtime sequences at normal counts (244.85 seconds total).
- Guide checks: **113 passed**. Definition/recovery pins match the bounded note.
- Root `./ref-check --verbose`: **531 LLP docs, 10,539 refs, zero errors/unchecked**.
- `git diff --check`: passed.

Rust verification commands, from `snapback4/`:

```sh
cargo test -p snapback4 --bin snapback4 dev_clock_store
cargo test -p snapback4 --bin snapback4 session_diagnostics_tests
cargo test -p snapback4 --bin snapback4 serve::
cargo test -p snapback4 --test clock --test replay --test dev_refusals
cargo test -p snapback4-core --lib identity
cargo test -p snapback4-core --test identity --test read_sessions --test bound_session
cargo test -p snapback4-lang --test guide
```

SDK selection, from `snapback4/`, after build/typecheck:

```sh
node --test --test-concurrency=4 packages/snapback4/test/session-reasons.test.mjs packages/snapback4/test/session-security.test.mjs packages/snapback4/test/read-only*.test.mjs packages/snapback4/test/app-local-session.test.mjs packages/snapback4/test/online-session.test.mjs packages/snapback4/test/app-online-arm.test.mjs packages/snapback4/test/app-online.test.mjs packages/snapback4/test/app-store-replacement.test.mjs
node --test packages/snapback4/test/app-session-model.test.mjs
```

The first clock integration run had one obsolete text assertion (`ms in`) after
the note changed to `ms (latest 64 commits; tables: ...)`; the assertion was
updated and the entire file passed. No product regressions were observed in
this round's affected tests. This is affected-scope verification, not a claim
that the complete repository battery was run.

## Governing documents

Updated LLP 3000.007 §20.2 (trusted-dev refusal privacy and absent-record
ambiguity) and §20.12 (bounded commit-clock evidence), including Revised;
jobs/personas/services/codes guide cards; client/operations documentation;
and the append-only JOURNAL. LLP 3000.033 §1.3's lazy read-session schema and
read-only/opening guarantees remain unchanged. The historical r0 journal entry
is superseded by this round's appended correction, not rewritten.
