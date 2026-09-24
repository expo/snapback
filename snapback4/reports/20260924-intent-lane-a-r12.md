# Lane A, round 12 — delta review closed

2026-09-24. Branch `sb4-intent/a-planner`; starting commit `eb85e323f`.

## Behavior and examples

The generated empty-search browse read owns its normalization. Nested reads
keep their own table, key columns and ordering. These compile and execute:

```quarry
return t[owner] matching q first 1 by byWords after c where exists input[i]
return t[owner] matching (input[i] ! else MISSING).value first 1 by byWords after c
```

With no `input` row whose id is `wanted`, an unrelated row with
`{ id: 'other', owner: 'wanted' }` cannot satisfy the first query. The second
raises MISSING for that missing id and returns the correct row for a real id.

An explicit words index still disambiguates its ordering:

```quarry
unique byOwnerAt: owner, at
by byTime: owner, at, id
by byWords: owner, words(body), at, id
```

`return t[owner] matching q last 1 by byWords after c` chooses byOwnerAt for
empty search, regardless of declaration order. Both browse and word pages
walk ids 3, 2, 1 without gaps. Ordinary `where .owner = owner … by .at`
remains ambiguous with these two covering declarations. The native and JS
retained-history fixtures again declare both original indexes.

Conditional population domains refuse. The approved ordinary-sweep rewrite
compiles, runs and changes all three seeded rows when status is absent:

```quarry
job sweep(status: int ?):
  for row in t:
    if status = null or row.n = status:
      update t[row.id] { n: 9 }
```

For mutations, iterate the complete capped group and put the optional filter
inside the body. A truncated conditional page cannot emit effects under the
bounded-list exception; the alias spelling refuses too. For stored/raw job IR,
no recorded sweep means E_JOB_SWEEP and parked, zero chunks, zero row writes
and zero effects, rather than done.

## File-by-file changes

| File | Change |
|---|---|
| [llp/3000.013-quarry-states-intent.rfc.md](../../llp/3000.013-quarry-states-intent.rfc.md) | Records outer-leaf normalization, deterministic authored-search browse selection, conditional-loop refusal and the no-sweep runtime guard. |
| [snapback4/crates/snapback4-lang/src/bind/intent_variants.rs](../crates/snapback4-lang/src/bind/intent_variants.rs) | Normalizes the generated browse leaf during construction, never recursively altering its predicate, needle or key expressions. Authored merge browse lanes use the same helper. Chooses the lexicographically first compatible plain index, comparing effective id suffix and normalized computed-key identity. |
| [snapback4/crates/snapback4-lang/src/bind/intent.rs](../crates/snapback4-lang/src/bind/intent.rs) | Shares the existing canonical computed-key descriptor with browse selection; ordinary authored-read ambiguity rules stay unchanged. |
| [snapback4/crates/snapback4-lang/src/bind/program/control.rs](../crates/snapback4-lang/src/bind/program/control.rs) | Refuses a presence-selected top-level job loop with E_QUARRY_PLACEMENT, its source site and a rewrite naming the actual loop binding/table. |
| [snapback4/crates/snapback4-core/src/ir.rs](../crates/snapback4-core/src/ir.rs) | Adds an internal expression-scan traversal entry point for admission provenance; no IR or cursor serialization changes. |
| [snapback4/crates/snapback4-core/src/engine/admission.rs](../crates/snapback4-core/src/engine/admission.rs) | Preserves scan provenance through expression blocks and aliases; presence-selected populations cannot use the bounded-list emit exemption. Refuses with E_STRUCTURAL_FANOUT and an ordinary capped-loop/job rewrite. |
| [snapback4/crates/snapback4-core/src/engine/job.rs](../crates/snapback4-core/src/engine/job.rs) | Parks stored non-native jobs with no recorded sweep as E_JOB_SWEEP before the done path. No skipped domain is reported successful. |
| [snapback4/crates/snapback4-lang/src/diag.rs](../crates/snapback4-lang/src/diag.rs) | Routes E_JOB_SWEEP to the jobs guide. |
| [snapback4/crates/snapback4-lang/src/guide/codes.rs](../crates/snapback4-lang/src/guide/codes.rs) | Registers E_JOB_SWEEP and its why/rewrite entry. |
| [snapback4/crates/snapback4-lang/src/guide/jobs.rs](../crates/snapback4-lang/src/guide/jobs.rs) | Explains the ordinary-sweep optional-filter rewrite and no-sweep refusal. |
| [snapback4/crates/snapback4-lang/src/guide/reads.rs](../crates/snapback4-lang/src/guide/reads.rs) | Documents the mutation-population and top-level job-loop restriction. |
| [snapback4/crates/snapback4-lang/tests/intent_variants.rs](../crates/snapback4-lang/tests/intent_variants.rs) | Strengthens existing tests with non-member hidden-org reads in all four variants, unique point-probe/no-merge assertions, empty/missing optional exists, and null/incomplete interrupted exists before a witness. |
| [snapback4/crates/snapback4-lang/tests/intent_variants_review.rs](../crates/snapback4-lang/tests/intent_variants_review.rs) | Four new regressions: nested point/inline needle preservation, deterministic explicit-search compatibility, population-loop refusal plus a running ordinary-sweep rewrite, and raw-IR job parking. |
| [snapback4/crates/snapback4-device/tests/search_merge/mod.rs](../crates/snapback4-device/tests/search_merge/mod.rs) | Restores unique byRoomAt plus byTime, retaining the original two-index compatibility fixture. |
| [snapback4/packages/snapback4/test/retained-history.test.mjs](../packages/snapback4/test/retained-history.test.mjs) | Restores the same two-index fixture for the real WASM/process client tests. |
| [snapback4/JOURNAL.md](../JOURNAL.md) | One appended dated entry with validation, measurements and exclusions. |
| [snapback4/reports/20260924-intent-lane-a-r12.md](../reports/20260924-intent-lane-a-r12.md) | This report and failure accounting. |

## Regressions and proof

- `generated_browse_never_retargets_nested_points_or_inline_needles`: every
  input read remains a point read on byId; missing-id filters return an empty
  complete page for both empty and nonempty needles; inline missing needles
  raise MISSING, while a real point needle returns the visible row.
- `authored_words_order_disambiguates_browse_independently_of_declaration_order`:
  restores both competing plain indexes; reversed declaration order picks the
  same browse index and cursor pages. An ordinary unqualified predicate read
  still refuses ambiguity.
- `presence_domains_refuse_population_loops_with_an_ordinary_loop_rewrite`:
  optional and plain truncated emit pages both refuse E_STRUCTURAL_FANOUT;
  the optional page alias also refuses. The top-level conditional job refuses
  at its site with the body-filter rewrite. The rewritten job actually visits
  and updates all seeded rows.
- `engine_parks_an_unrecorded_conditional_sweep_instead_of_skipping_it`:
  constructs raw job IR to bypass the language refusal, queues status=null,
  and asserts parked/E_JOB_SWEEP, no chunks/writes/effects. Removing the engine
  guard changes this to done and fails the test.
- Existing board test: seeds an actual issue in hidden org matching every
  optional filter; alice, who is not a member, gets no rows and no cursor in
  all four presence combinations.
- Existing exact-exists test: asserts one unique point probe and no discovery
  merge/scans on issueLabels, in addition to the authorized-row oracle.
- Existing optional aggregate test: has(start=6) is false over populated data;
  both variants are false on an empty domain. A zero-examined cut before any
  witness returns null, incomplete and no cursor. `count >= 0` fails the
  absence assertions.

Affected checks passed: 9 intent-variant tests, 4 new review regressions,
57 guide tests, 15 simulator admission tests, 12 work-intent tests and all
12 device search-merge tests (memory/SQLite coverage and restored fixtures).
`bun install --frozen-lockfile` passed. No changed source exceeds 1,500 lines.

## Choices and deviations

- Chose the supervisor's permitted bind-time refusal, not a new resumable
  conditional-sweep runtime. The ordinary loop/sweep with a body filter is the
  concrete supported rewrite. Query variants and streaming consumers remain.
- Generated browse alternatives resolve compatible declared indexes by name
  only after equality of effective ordering and normalized computed keys.
  No general ambiguity rule, index definition or unique constraint changed.
- The runtime guard rejects every non-native job with zero recorded sweeps,
  including malformed empty stored jobs; native jobs retain their own path.
  This is stricter than merely detecting one particular conditional IR shape.
- No authorization, disclosure, cap, meter or residency rule was relaxed.
  No version bump, publication or push. No new IR fields or byte-budget raise.

## Validation and failure accounting

Final complete run: **`== 0 failure(s) in 690 s`**. Command from snapback4/:

```sh
taskset -c 32-47 env SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

The complete Rust group passed in 171 seconds; client tests passed in 670
seconds (1,088 passed, 0 failed, 10 inventory skips). No suite group was
omitted. Final log: `/tmp/lane-a-r12-test-serial.log`.

The rebuilt device measures **1,751,318 B raw / 487,805 B gzip**, the same
sizes as round 11, under the unchanged 488,000-byte ratchet. Engine ceilings
remain unchanged.

Initial affected checks had two test-compilation errors (new assertions used
Option for Value::field's Result) and one new-test expectation error (an
interrupted exists is null, not false). These were ours, corrected; all named
checks above passed afterward. The first full run reported `== 1 failure(s) in 286 s` (client tests).
All Rust and build checks passed. Its two client failures were:

- `shared logout fences a held online rotation while signed out`:
  `UND_ERR_SOCKET` / other side closed during the test's fetch at app.test.mjs:437.
- `stopped full-release restore preserves its recovery point and stays separate from the original`:
  `done` versus `parked` at release-activation.test.mjs:335 (the same timing
  failure recorded during round 11).

Both are classified environmental/timing-sensitive: they passed unchanged
in the isolated two-test rerun, 2 passed / 0 failed. No test or client code
was modified to accommodate them. Reproduction/rerun:
`node --test --test-concurrency=1 --test-name-pattern='shared logout fences a held online rotation while signed out|stopped full-release restore preserves' packages/snapback4/test/app.test.mjs packages/snapback4/test/release-activation.test.mjs`.
The baseline log was checked; neither is claimed as a baseline failure.

The second full run reported `== 1 failure(s) in 305 s` (client tests),
again with all Rust/build checks passing. Its two client failures were:

- `a device restores its session on its own`: the signed-out request lacked
  the expected E_AUTH at local-e2e.test.mjs:205.
- `sync store identity survives a server restart; a live client detects an equal-watermark replacement`:
  the client still observed the old store identity at store-reset.test.mjs:135
  (also observed during round 11).

Both passed unchanged in an isolated rerun, 2 passed / 0 failed. They are
classified environmental/timing-sensitive, not baseline. Reproduction/rerun:
`node --test --test-concurrency=1 --test-name-pattern='a device restores its session on its own|sync store identity survives a server restart' packages/snapback4/test/local-e2e.test.mjs packages/snapback4/test/store-reset.test.mjs`.

Separate inherited audit issue: `./ref-check --verbose` reports exactly one
error at `snapback4/crates/snapback4-core/src/store.rs:809`: the anchor
`LLP 3000.013#5.3-effects-keyed-once` does not exist; the document uses `#5.3`.
It is unchanged from the starting commit and was recorded in round 11.
Reproduce with that command. The audit reports 504 LLP docs / 9,238 refs,
1 error, 0 unchecked. No new reference errors. No known remaining round-12
functional finding.
