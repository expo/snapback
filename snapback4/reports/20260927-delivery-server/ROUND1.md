# DS round 1 — delivery binding fences and review repairs

Date: 2026-09-27. Branch: `sb4-intent/ds-delivery-server`.
Merged `origin/main` first in `db887d978`, retaining both append-only journal
entries. Read both round-0 reviews and the amended LLP 3000.022. No push or
publication. This report supersedes round 0's interface and open-problem status.

## Interface for lane DC

Send **`delivery: { fingerprint }`** beside **`id`, `args`, `store_id`** in
`POST /m/<mutation>`. Both the compiled binding and every manifest binding
carry `fingerprint` as a string. No schema fetch or API codegen change is needed.

The digest is **SHA-256, 64 lowercase hex digits**. Hash ASCII
`snapback4.delivery.v1` and one zero byte, followed by these seven UTF-8 strings:
table, group column, position column, mutation, group argument, first argument,
last argument. Precede each string with its UTF-8 byte length as an unsigned
64-bit big-endian integer. JSON ordering, serialization and host word size do
not enter the digest. LLP 3000.022 §§4–5 now state this exact protocol.

The fixture compiles either inline or continued headers:

```quarry
mutation delivered(group: chats, low: int, high: int)
  reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

The same header compiles inline:

```quarry
mutation delivered(group: chats, low: int, high: int) reports delivery of messages by .chat, .ordinal:
  require low <= high else NOT_A_RUN
  return null
```

As in round 0, this test body isolates platform behavior; the receipts card's
real body records coverage. Its compiled binding is:

```json
{"table":"messages","group":"chat","position":"ordinal","mutation":"delivered","args":["group","low","high"],"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443"}
```

For `messages['m1'] {alias: .text} {alias}`, the manifest binding is:

```json
{"table":"messages","mutation":"delivered","args":["group","low","high"],"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443","rows":[["c1",1]]}
```

Use the accepted answer's store ID and the attempt's persisted write ID:

```json
{"id":"report-1","args":{"group":"c1","low":1,"high":1},"store_id":"<accepted store ID>","delivery":{"fingerprint":"2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443"}}
```

A bound durable receipt replays before current binding/program/signature
judgment, including after conversion to ephemeral. For an unrecorded report,
SQLite and Postgres check the fingerprint under their writer transaction before
argument validation and the body; HTTP checks before typed decoding and the
engine rechecks at execution. A stale, removed or malformed binding refuses
non-retryable `E_DELIVERY_BINDING`, with site and rewrite. Handwritten calls
without `delivery` retain their existing mutation meaning. Positions outside
±(2^53−1) are omitted, including legacy/imported rows that exceed today's input
validation. Ordinary ephemeral correlation IDs still execute on every call.

## File-by-file changes

Paths are relative to `snapback4/` unless prefixed `../`.

| File | Change |
|---|---|
| `../llp/3000.022-delivery-the-sdk-reports.rfc.md` | Pins SHA-256 input encoding, HTTP field, replay precedence and manual-call compatibility. |
| `crates/snapback4-core/src/schema/delivery.rs` | Compiled fingerprint, streaming field decoder, portable digest, binding refusal helper. |
| `crates/snapback4-lang/src/bind/delivery.rs` | Computes the fingerprint from admitted names and argument order. |
| `crates/snapback4-core/src/engine/mod.rs` | Context fingerprint; durable receipt before ephemeral dispatch; writer-bound check before body/signature; removes replay's ephemeral bypass. |
| `crates/snapback4-core/src/engine/ephemeral.rs` | Checks report binding while holding ephemeral execution ownership. |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Checks in each write attempt, before argument validation and mutation-kind judgment; preserves replay before program lookup. |
| `crates/snapback4-core/src/error.rs` | Non-retryable binding diagnostic with `delivery.fingerprint` site and concrete rewrite; server-only arm excluded from wasm. |
| `crates/snapback4-core/src/engine/delivery.rs` | Metered table index built once per query; stops metadata collection on exhaustion; charges selection, fields, variable cleanup and final flag work; fingerprint envelopes, safe positions, real fixed skeleton and row byte reservation. |
| `crates/snapback4-core/src/engine/runner.rs` | Preserves disclosed field origin through `OptionalField` and `expr`. |
| `crates/snapback4/src/serve.rs` | Reads fingerprint before typed argument decoding; replay precedes execution-class dispatch; passes binding into the executing engine. |
| `crates/snapback4/src/serve_ephemeral.rs` | Bound receipt lookup before ephemeral decoding/rate admission/execution; parses the named delivery field. |
| `crates/snapback4-lang/src/diag.rs` | Routes `E_DELIVERY_BINDING` to the receipts card. |
| `crates/snapback4-lang/src/guide/codes.rs` | Registers the binding refusal and recovery. |
| `crates/snapback4-lang/src/guide/receipts.rs` | SDK persistence versus online memory, committed-success retirement, parked-run wakes; removes the superseded delivery hook while retaining `seen` and its view debt. |
| `crates/snapback4-lang/tests/delivery_clause.rs` | Golden fingerprint, all seven components, wire-order independence and updated schema expectations. |
| `crates/snapback4-lang/tests/delivery.rs` | Owner disclosure/aliases, colliding table IDs, many bindings, exact output reservation, second-envelope overflow and safe-integer endpoints. |
| `crates/snapback4-lang/tests/delivery_replay_conversion.rs` | Permanent conversion regression, removed/rebound/renamed/argument-changed bindings, ephemeral positive controls and explicit cost benchmark. |
| `crates/snapback4-core/src/engine/postgres/tests/delivery.rs` | Matching fingerprint success, stale/removed binding refusal, mutation-to-query refusal and replay in both write modes. |
| `crates/snapback4/tests/serve_delivery/mod.rs` | Manifest fingerprint, HTTP conversion/replay, malformed/stale bindings, positive ephemeral controls and adoption between preflight and writer execution. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Binding definition and editorial regression for the SDK protocol and retained `seen` hook. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins drop-binding recovery and no old-report retry. |
| `packages/snapback4/test/react.test.mjs` | Updates executable card extraction; replaces superseded hook-delivery expectations with no-delivery controls while retaining visible/hidden, pending, offline, retry, remount and viewer/client/conversation-scoped `seen` checks. |
| `scripts/build-wasm.sh` | Tries exact duplicate-function elimination before `-Os`, keeps only a gzip improvement, enables already-used sign-extension instructions, compares candidates without filename bias. |
| `../issues/closed/20260927-snapback4-replay-across-ephemeral-conversion.md` | Closes the replay ticket with tests and measured cost; preserves the historical issue text. |
| `JOURNAL.md` | Dated round-1 append with final validation and measurements. |
| `reports/20260927-delivery-server/` | Current report, historical round-0 report, and retained round-1 evidence. |

## Review findings and regression evidence

1. **Durable-to-ephemeral replay:** engine and HTTP tests replay the old receipt,
   verify no signal is written, refuse a fresh stale SDK report, and execute two
   ordinary fresh signals with the same correlation ID. The HTTP writer-gap
   test adopts a removed clause after preflight; only the executing writer's
   check can prevent the replacement body.
2. **Owner-controlled origin:** Alice's `fields`, `alias` and scalar-variable
   projections report the stored image; Bob sees no field value or delivery.
   The alias case has a successive projection. Removing the `expr` exception
   fails the test.
3. **Binding lookup/steps:** 1,001 bindings, 100 candidate rows and an 800-step
   ordinary ceiling exhaust the separately charged metadata work and return
   `partial`, with at most 200 supplemental steps. Removing index-work charging
   fails the regression. Index construction, indexed lookups, selection and
   tracking all reserve before their work; stopped stamping never scans again.
4. **Wasm:** the unchanged size gate now passes. The same unoptimized module is
   573,266 gzip bytes and fails the gate by 425; duplicate-body elimination
   brings it to 570,429. Imports and exports are byte-shape equivalent in the
   retained WebAssembly module comparison. Full client tests exercise the
   optimized artifact.
5. **Card:** the editorial test requires local persisted debt, online memory,
   committed-success retirement, the wake delay and the `seen` call; it refuses
   the old `client.mutate(api.delivered, ...)` hook and confirmation wording.
   The browser test executes the new card hook and verifies that only visible
   settled rows cause `seen`, with no hook delivery or automatic page walk;
   existing `seen` retries and scope isolation still pass.
6. **Colliding IDs:** `messages['x'] {preview: notes['x'].text}` reports neither
   row. Returning each row's own `{text}` image reports both. Deleting
   `origin.source.table == coordinate.table` fails with a false message report.
7. **128-byte floor:** only `Manifest::Partial` reserves its 24 bytes. Binding
   output reserves the actual fixed JSON skeleton (including the potential
   partial marker), framing, escaped names and exact row number lengths. The
   exact-fit test admits a row at the computed ceiling; adding the old extra
   24-byte charge fails. With a full SHA-256 fingerprint this fixture's envelope
   really exceeds 128 bytes, so its floor still correctly returns `partial`.
8. **Second-envelope failure:** two bindings share an answer; the tight ceiling
   fits the first envelope and a row, but cannot fit the second envelope. The
   surviving envelope must say `partial`. Dropping the second and clearing
   `ledger.partial` fails. The initial version left no row headroom and missed
   this mutation; the final regression fixes that test weakness.

Six intentional production-code mutations each fail the named test. See
[`round1/mutations.json`](round1/mutations.json), the six `mutant-*.txt` logs,
and the reversible [`round1/mutations.py`](round1/mutations.py) reproducer.
Run it only with no concurrent build using this worktree.

## Measurements and validation

Warm in-memory SQLite, optimized test profile, ten alternating batches of
5,000 operations: direct ephemeral write **19,678 ns**, write via receipt-aware
`mutate` **25,978 ns** (delta **6,300 ns**, about **32%**). An isolated missing
receipt lookup is **2,890 ns**. The write-path delta includes raw-argument
conversion and the mutation outcome wrapper. This is local engine overhead,
not a network latency claim. Reproduce:

```sh
cargo test -p snapback4-lang --test delivery_replay_conversion measure_ephemeral_receipt_lookup_cost -- --ignored --nocapture
```

| Wasm artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| Round 0 | 1,985,215 | 572,996 |
| Round 1 before duplicate elimination | 1,985,385 | 573,266 |
| Round 1 qualified artifact | 1,964,064 | 570,429 |
| Change from round 0 | −21,151 | −2,567 |

Budget remains **572,841**; headroom **2,412**. SHA-256 of the qualified wasm:
`d843f60e9776069dbaa92c9040b68dedb6480cd0be953f301d93125c3ea53926`.
The size result uses Binaryen **108** (`wasm-opt`) on PATH. This lane used
`/tmp/ds-binaryen/extracted/usr/bin`. The build's existing
optional optimizer behavior remains: a host without it must install Binaryen
to reproduce this qualified artifact; its unoptimized artifact remains above
the cap. No ceiling, ABI or binding wire field was removed or weakened.

Focused validation: 13 delivery tests, 5 clause tests, 2 replay/fingerprint
tests, the whole 87-test guide, 3 read-through provenance tests, 5 HTTP tests,
and the Postgres test in both
Serialized and Serializable modes. The benchmark is intentionally ignored in
ordinary runs and was run explicitly. Reference audit passed:
`ref-check: ok — 517 LLP docs, 9621 refs in 27218 files, 0 errors, 0 unchecked`.

`scripts/test.sh` ran **once**, exited **1**, and printed exactly:

```text
== 1 failure(s) in 1446 s
   client tests
```

The sole failure is **ours, fixed**: `packages/snapback4/test/react.test.mjs`
crashed at its old line 166 while extracting the removed `runsOf` delivery
recipe (`TypeError: Cannot read properties of null (reading '0')`). Its old
assertions also required delivery from the mounted hook, deliberately changed
by this round's card correction. Updated the extraction and assertions to the
SDK protocol while retaining the independent `seen` controls. The affected
browser file then passed **45/45, zero skipped**, in 3.337 s:

```sh
node --test packages/snapback4/test/react.test.mjs
```

No baseline or environmental failures occurred. Cargo build, wasm build,
docs budget, release guard, package typecheck/build, chat check, all Rust tests
(929 s), chat/Expo typechecks, fixture wrappers, and all 78 client model tests
(267 s) passed in the full run. The other client files passed; the original
client phase reported ten skips. This records the original full-run red,
not a claim that the whole script was rerun after its repair.

Full evidence: [`round1/full-suite.log.gz`](round1/full-suite.log.gz),
[`round1/full-suite.exit`](round1/full-suite.exit), and the passing
[`round1/react.txt`](round1/react.txt). Reproduce the original extraction crash
by keeping this round's card and restoring the React test from merge commit
`db887d978`; no baseline package or React dependency mismatch was involved.

The final HTTP check was rerun after restricting request fingerprint parsing to
mutations and pinning writer-time `E_DELIVERY_BINDING` to HTTP 200, so it stays a
terminal coded refusal rather than a transport failure. These small HTTP
refinements followed the full run's Rust phase; the full script was run once,
as requested. Postgres's mutation-kind fence also passed its separate final
run, including a reporter converted to a query.

Evidence: [`round1/focused.txt`](round1/focused.txt),
[`round1/http.txt`](round1/http.txt), [`round1/postgres.txt`](round1/postgres.txt),
[`round1/ephemeral-cost.txt`](round1/ephemeral-cost.txt),
[`round1/wasm.txt`](round1/wasm.txt),
[`round1/wasm-interface.json`](round1/wasm-interface.json), and
[`round1/wasm-without-dedup.json`](round1/wasm-without-dedup.json).

## Decisions, deviations and remaining scope

- The mandated fingerprint is the only new wire field. Missing `delivery` is
  an ordinary handwritten mutation call; a present malformed field refuses.
  Durable receipt custody wins over the current binding, as §§2.2 and 6 require.
- The digest encoding is now in the RFC's words. No client collection, debt
  persistence, scheduling, comparative change or publication was implemented;
  those remain DC/integration work, not unfinished DS scope.
- The card's executable TypeScript example also needed its obsolete delivery
  hook removed; changing only the Owing/Waiting paragraphs would leave it
  teaching the protocol the review rejected. `seen` and its retry debt stay.
  Accordingly the React card test no longer tests run debt/confirmation/walking
  inside that hook; it verifies the new boundary. SDK queue coverage belongs
  to lane DC, while server coverage and receipt rules remain tested here.
- The large binding index is built once per query under the supplemental
  allowance; subsequent source stamps use indexed lookups. Exhaustion stops
  collection, and the answer's ordinary meter/completeness is untouched.
- The wasm repair is an artifact transformation with measured output savings,
  not a budget increase. Smaller decoder experiments alone did not clear the
  cap; the retained decoder keeps the same streaming interface and validation.
- No review finding remains open. The one full-suite failure was ours and its
  affected rerun passes. The wasm build still depends on an optimizer being
  available to clear the unchanged cap: reproduce with
  `PATH=/tmp/ds-binaryen/extracted/usr/bin:$PATH bash scripts/build-wasm.sh`
  on this host, or install Binaryen 108 elsewhere. Without `wasm-opt`, the
  measured module is 425 gzip bytes over; this is an explicit tool prerequisite
  for the qualified artifact, not an increase in the budget.

Scoped LLP orientation: [LLP 3000.022](../../../llp/3000.022-delivery-the-sdk-reports.rfc.md)
§§2, 3, 5 and 6 govern receipt custody, safe positions, origins and independent
meters; [LLP 3000.021](../../../llp/3000.021-what-the-comparative-builder-still-wrote.rfc.md)
§3.2 is amended by §8. The relevant authoring surface is the receipts card.
The design change was authorized by the amended RFC and this round's brief;
no new design decision is waiting for approval.
