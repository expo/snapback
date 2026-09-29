# Lane AG — first paste, round 4

Merged origin/main first, preserving both sides of the journal-only conflict.
Merge commit: `7dec18559b35dc78362738ce3d13cf03ea824efe`; merged main:
`b7d05baff661db08bb99250d80b1090a8ed99346`. Branch:
`sb4-intent/ag-first-paste`. Read all prior prompts/reports and Astra's complete
round-3 NOT READY review. Scope remains compiler advice, tests and guide.

## Decision and changes

Removed the generated read-through upsert rewrite completely, including its
eligibility guards, source-syntax lookup and dedicated row-key tracking. No
reference or row caller receives generated branch code. The shared-helper Low
is therefore **moot**, and surrounding-expression precedence cannot be changed
by this diagnostic's advice. No replacement generator or automatic fix is added.

The truthful reason remains **“upsert on a read-through child queues without a
row”**, including default and failing check output. It points precisely to
`snapback4 guide prediction`, section **“Read-through upserts: explicit
insert/update”**. That card includes a compiling branch example for the builder
to adapt, explicitly returns null, and discusses evaluation order, named keys,
shared-helper argument types, return values, downstream effects, expiry,
optional/defaulted images, hidden writable rows and read authority. It names
missing coverage, horizons, Left groups, unknown authority, expiring caps and
runtime prediction allowances as reasons the adapted operation can still queue.
Its public parent is stated as a product choice, not advice to widen authority.

Removed all eight generator-specific first-paste tests and their helpers.
Existing truthful-reason coverage remains. One new CLI test checks the reason,
precise pointer and absence of an associated `rewrite:` line in `why`, default,
verbose and residency output, using a fixture that previously received generated
code. It fails on the old compiler's emitted rewrite (`pre-fix-no-rewrite.log`).
Other diagnostics may still print their own rewrites, as the private builder
fixture's horizon sites do; no unrelated advice is suppressed.

The existing declared-helper assertion now executes both **len(41)** and
**length(41)** with each helper defined as `n + 1`, requiring 42. The control
that overrides only declared `len` fails this test, and was restored. LLP
3000.007 §23 records the withdrawal and all four rounds of behavior changes;
the earlier claim of a proved equivalent subset is explicitly superseded.

No interpreter, client implementation, authorization, disclosure, bound or meter
changes. No budget increase, new diagnostic code, new test file or generated
publication leaf. The guide's new mutation required one existing census fixture
entry; its full-suite discovery and correction are attributed below.

## Affected verification

- Language and whole guide: **1 compatibility, 9 first-paste, 99 whole-guide,
  11 lowering and 41 residency-note tests passed** (161 total),
  `affected-lang-guide-verified.log`. Historical lowering digests remain intact.
- CLI: **82 check, 10 cost, 3 notes, 27 fix, 28 scale passed** (150 total),
  `affected-cli.log`.
- Both device first-paste witnesses passed, `affected-device.log`.
- After the census expectation correction, all **81 read-authorization tests
  passed**, `census-repair.log`. Only the expected corpus entry changed after
  the full suite built its tests; final product/compiler/guide source was already
  covered by the checks above and the single suite invocation.
- `./ref-check --verbose`: **523 LLP docs, 9,864 refs, zero errors/unchecked**.
- Guide size/fact-home checks and compiled examples pass without removing any
  pre-existing fact or block. Source whitespace checks pass.
- Rendered CLI evidence: `why-upsert.log`, `check-upsert.log`,
  `check-upsert-verbose.log` and `guide-prediction.log`.
- Every red control and development failure is classified in `FAILURES.md`.
  Those logs retain the failures rather than representing a later targeted
  pass as the original run.

## Full suite and wasm

Ran `scripts/test.sh` **exactly once**, exit **1**. Exact summary:

```text
== 1 failure(s) in 1381 s
   cargo test
```

Only `snapback4-device::readauth` / `census::authoring_census` failed:
**ours**, a stale expected authoring-corpus entry for the new guide example.
The observed set has exactly one addition, `card/prediction/4:setReaction |
eligible`, no removals, and no new private write site. The expected entry is
updated; the complete readauth target subsequently passed **81/81**. This does
not change the original full-suite outcome or claim a second full run.

Full-run Rust: **274 test binaries / 987 executions**, **4,329 passed / 1 failed /
33 ignored**. Client stage: **4,561 passed / 10 skipped / 0 failed**. Client
models: **79 passed / 0 failed**. Fixture wrapper: **9 passed**. Every other
script stage passed. Full-suite failures by attribution: **ours 1 (fixed),
baseline 0, environmental 0**. Authentication refusals printed during model
fault scenarios are expected observations, not failed tests. The inherited
60-second suite target remains missed; no ceiling or timeout was raised.

Fresh canonical wasm built by that invocation: **2,040,529 B raw / 592,975 B
gzip**, cap **593,719 B**, **744 B headroom**. SHA-256:
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.
See `wasm.json`; no wasm build input changed after this measurement.

## Delivery

The final report and one append-only journal entry accompany the local commit
with `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or
published. `review.sha256` identifies the reviewed Astra file.

Captured logs are normalized only for trailing whitespace and blank lines at
EOF; outcomes and the exact suite summary are preserved. The final reference
and staged whitespace checks pass. No product-source edit followed the affected
checks or the full-suite build; the late correction is one test-census entry.
