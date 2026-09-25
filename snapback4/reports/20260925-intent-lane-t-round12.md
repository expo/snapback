# Lane T round 12 — retained projections of anonymous fallback elements

Branch: `sb4-intent/t-read-through`, based on round-11 head `12d203d7f`.
Reviews: `~/sb4-intent/reviews/t-r11.astra.md` (READY) and
`~/sb4-intent/reviews/t-r11.grok.md` (READY WITH CHANGES).
Governing design: LLP 3000.014 §5, with the user's round-12 clarification.

## Changes, file by file

- `packages/snapback4/src/local-through.ts`: collects table-qualified source
  identities throughout the server array's provenance. An unpaired element
  with no source contributes only its retained projection: current row images
  are removed, nested sources already returned by the server are omitted,
  and containers with no remaining history disappear. Retained rows preserve
  scalar and JSON contents; nested source rows use their own retention marks.
  Identified unpaired elements remain whole. The server envelope is indexed
  lazily once per array that needs this projection.
- `packages/snapback4/test/read-through-provenance.test.mjs`: adds a compiled
  `return [{rows}]` query and four actual-device regressions, two each on wasm
  and native. The partial-rejoin case holds a stale current row beside retained
  history; the in-place-edit case holds a retained version of the same source
  the server returns. Both inspect real device masks before checking fallback.
- `packages/snapback4/test/read-through.test.mjs`: adds Astra's object-source
  mismatch witness, a nested source/table-qualification test that also checks
  unidentified versus identified leftovers, and a retained-JSON witness that
  excludes nested current rows without discarding the retained row's data.
- `../llp/3000.014-a-child-reads-through-its-parent.rfc.md`: records the
  anonymous retained-projection clarification in §5 and the revision header.
- `JOURNAL.md`: one dated append with implementation and qualification.
- This report: examples, mutation evidence, measurements and failure accounting.

## Existing form that now composes correctly

No new syntax or refusal code. This compiled fixture runs on both device tiers:

```quarry
query nested(parent: parents):
  rows = children where .parent = parent first 10 by .id {id, body}
  return [{rows}]
```

With a local current `children/c` and retained `children/old`, a server page
containing current `c` contributes its current wrapper; the appended local
wrapper contains only retained `old`. An in-place edit to `children/x`, when
the local copy of `x` is retained, returns only the server wrapper with current
`x`, without a stale duplicate or an empty appended wrapper. Table-qualified
source identity drives both cases, independent of projected `id` fields.

## Tests and mutation evidence

New tests and what they prove:

- `an anonymous nested page appends only retained history after a partial
  rejoin` (wasm and process): actual partial-acquisition masks identify current
  `c` and retained `old`; fallback cannot append the stale unmarked `c`.
- `an in-place edit under an anonymous nested page replaces its retained copy`
  (wasm and process): matching nested source identity removes retained `x`
  already present in the server answer and elides the now-empty local wrapper.
- `retained fallback never attaches one object's history to a different source`:
  local parent A stays local instead of giving its retained child to server B.
- `anonymous retained projections use nested source identities and keep
  identified leftovers whole`: stale current rows disappear, including a row
  the server does not return; a reaction sharing a projected ID with a comment
  survives because its table differs; an identified unpaired parent stays whole.
- `anonymous projection preserves retained JSON fields but excludes nested
  current rows`: retained scalars, nested JSON and arrays remain intact, while
  an independently current nested row is excluded.

Before the fix, all four device cases and the anonymous-projection helper case
failed on the actual duplicate/stale data; Astra's existing guard already
passed its new test. No fixture-authoring failure was needed to reproduce it.

Deliberate mutations, restored before final checks:

- Append an anonymous leftover whole instead of projecting it: all four
  wasm/native overlap regressions fail (exit 1).
- Remove `source !== identity(currentMask) ||` from the object guard: Astra's
  new mismatch test fails (exit 1), showing B with A's retained history.

Final focused qualification: **34 client tests passed**, plus package build
and typecheck. No Rust implementation changed in this round.
Logs: `~/sb4-intent/lane-t-r12-{red-client,focused-client,mutation-wholesale,mutation-object-source}.log`.

## Decisions and limits

No deviation from round 12 and no requested fix deferred. The retained
projection keeps container paths leading to surviving history, drops unrelated
current wrapper fields, and preserves a retained row's own scalar/JSON values.
A nested source row establishes retention independently of its containing row.
These details implement the requested retained-only projection and are tested.

Identified unpaired elements remain whole as requested. Missing server
provenance still keeps the local subtree incomplete; object-source mismatches
still preserve the unmatched local subtree. No pairing uses position or a
projected field. No new guide syntax, refusal code, clock change, runtime meter
change, store format, authorization rule or server deletion change. Nothing
was pushed or published.

## Full qualification

Required full run, exit 0, exact summary:

```text
== 0 failure(s) in 1207 s
```

Rust target runner: **3,048 passed, 16 ignored, zero failed**. The docs budget
separately rechecked one guide case. Clients: **1,615 passed, 10 skipped, zero
failed (1,625 total)**. All blocking phases passed on this round's first full
run. No failure was waived as baseline or environmental. The baseline log tail
was read; its historical Cargo failure did not recur here. The only failures
in this round were the intentional pre-fix and mutation probes listed above.

Full log: `~/sb4-intent/lane-t-r12-test.log`. Command from `snapback4/`, after
`bun install --frozen-lockfile`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
taskset -c 32-47 env TMPDIR=/dev/shm/sb4-intent-lane-t-tests \
  CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
  SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Final wasm: **1,834,177 bytes raw / 515,152 bytes gzip**, unchanged from round
11, using Rust 1.97.0 and wasm-bindgen 0.2.127 without wasm-opt. The unchanged
516,000-byte budget has 848 bytes of headroom. No runtime ceiling changed.

`ref-check --verbose` and `git diff --check` passed. All changed source/test
files remain below 1,500 lines (`local-through.ts`: 115; the two test files:
229 and 247). No open problem or requested work remains.

Implementation commit: `67117a9b9`, with the required coauthor trailer.
The final documentation commit appends the journal and this report. Nothing
was pushed or published.
