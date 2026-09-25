# Lane T round 11 — partial provenance and mask charges

Branch: `sb4-intent/t-read-through`, based on round-10 head `cfdad52c1`.
Reviews: `~/sb4-intent/reviews/t-r10.astra.md` (READY) and
`~/sb4-intent/reviews/t-r10.grok.md` (READY WITH CHANGES).
Governing design: LLP 3000.014 §5 and the user's round-11 clarification.

## Changes, file by file

- `packages/snapback4/src/local-through.ts`: identifies unique sources on
  each side separately. Only identities unique on both sides pair. Missing or
  duplicate identities no longer prevent other siblings from refreshing.
  Unpaired local elements survive only if their own mask contains retained
  history. Source-free object wrappers recurse through their field masks.
  Missing server provenance still preserves the local subtree.
- `crates/snapback4-core/src/engine/runner.rs`: charges construction and
  transport of the provenance mask only when that reply carries it: retained
  rows on a device, requested provenance on the server. Row stamping still
  pays its existing meter charges.
- `packages/snapback4/test/read-through-provenance.test.mjs`: adds four
  actual-device cases, two each on wasm and native. An identityless wrapper
  contains current `children/x` and retained `reactions/x`; both update from
  their own server sources. A parent array mixes identified A/C, a source-free
  sibling and a current D removed from the server answer; A/C refresh with
  their own history and D is not appended. Assertions inspect real masks.
- `packages/snapback4/test/read-through.test.mjs`: adds three ambiguity
  witnesses (duplicate local sources, duplicate server sources, both) with a
  unique sibling that must still refresh. Updates the anonymous array-wrapper
  expectation: server elements remain, and the unpaired retained wrapper is
  appended, incomplete. The missing-envelope compatibility assertion remains.
- `crates/snapback4-lang/tests/read_through_provenance.rs`: asserts exact
  tagged data-plus-mask output bytes on an opted-in server reply and adds a
  device page that fits exactly at its data-only ceiling. That page still
  carries internal provenance but has no retained rows and sends no mask.
- `../llp/3000.014-a-child-reads-through-its-parent.rfc.md`: records partial
  identity pairing and emitted-mask charging in §5, superseding the previous
  whole-subtree ambiguity fallback.
- `JOURNAL.md`: one dated append with qualification and scope.
- This report: examples, evidence, decisions and failure accounting.

## Existing forms exercised

No syntax or refusal code was added. The compiled fixtures exercise:

```quarry
query wrapped(parent: parents):
  return {items: mixedRows(parent)}
```

Here `mixedRows` composes a comment and reaction with the same projected `id`;
source-free object wrapping no longer blocks their independent updates.

```quarry
query partial():
  a = parents['A'] ! else MISSING
  c = parents['C'] ! else MISSING
  d = parents['D'] ! else MISSING
  first = {...(a {title, rows: rowsFor(.id)})}
  last = {...(c {title, rows: rowsFor(.id)})}
  ambiguous = {...a, ...c}
  middle = ambiguous {title: 'unidentified'}
  if d.visible:
    return [first, middle, last, {...(d {title})}]
  return [first, middle, last]
```

The two-base spread deliberately has no unique source. Its presence must not
prevent A and C from refreshing, or resurrect D after the server omits it.

```quarry
query page():
  docs where .owner = viewer first 10 by .id {body}
```

This page succeeds on a device at its exact 46-byte tagged-data ceiling,
although the schema enables delivered-history provenance tracking.

## Regression and mutation evidence

Before the fixes, all four new device cases failed on stale server data;
the output-ceiling regression failed with `E_BOUND` at 46 bytes. The first
fixture drafts also produced `E_QUARRY_SHAPE_JOIN` because they mixed plain
objects and row shapes; the final compiled fixture consistently uses spread
row objects. Those were test-authoring errors, not product failures.

After restoration of every mutation, focused qualification passed all 27
client cases and all three Rust provenance tests. Package build and typecheck
passed.

Deliberate mutations, each restored before qualification:

- Drop `&& hasRetainedRows(mask[index])`: both wasm and native partial-page
  tests fail because the current local D reappears beside the server answer.
- Charge `1` instead of the encoded mask size: the exact output assertion
  fails, actual 74 versus expected 218 (73 data + 145 mask).
- Treat repeated sources as unique: all three duplicate-source tests fail;
  ambiguity cannot redirect retained children to another projection.

Logs: `~/sb4-intent/lane-t-r11-{red-client,red-rust,focused-client,focused-rust,mutation-append,mutation-output,mutation-duplicates}.log`.

## Decisions and limits

No deviation from round 11. Per its clarification, anonymous or ambiguous
array elements are unpaired, and retained local elements survive beside the
server elements; identified siblings still update. This deliberately changes
round 10's whole-array fallback test. A completely missing server envelope
still keeps the local answer, marked incomplete. Duplicate identities cannot
establish which projection to merge; they remain unpaired.

No clock site, public Read contract, persisted row format, rule, server
physical-child protection or runtime ceiling changed. No new guide syntax,
refusal code, push or publication. No requested fix is deferred.

## Full qualification

Required full run, exit 0, exact summary:

```text
== 0 failure(s) in 1161 s
```

Rust target runner: **3,048 passed, 16 ignored, zero failed**. The docs budget
also rechecks one guide case separately. Client: **1,608 passed, 10 skipped,
zero failed (1,618 total)**. Every blocking script phase passed on the first
full run. No failure was waived as baseline or environmental; the baseline
log's tail was read before testing. Its old Cargo failure is not present here.
The only red runs in this round were the deliberate pre-fix/mutation probes
and the corrected test-fixture drafts described above (ours).

Full log: `~/sb4-intent/lane-t-r11-test.log`. Command, from `snapback4/` after
`bun install --frozen-lockfile`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
taskset -c 32-47 env TMPDIR=/dev/shm/sb4-intent-lane-t-tests \
  CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 \
  SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Final wasm: **1,834,177 bytes raw / 515,152 bytes gzip**, Rust 1.97.0 and
wasm-bindgen 0.2.127 without wasm-opt. The 516,000-byte budget is unchanged,
with 848 bytes of headroom. Compared with round 10's recorded artifact, that
is +8 raw / +69 gzip bytes; this is a whole-artifact comparison, not separately
measured component attribution or a freshly rebuilt control.

`ref-check --verbose` and `git diff --check` passed. All changed source files
remain below 1,500 lines; the largest is `runner.rs` at 1,082 lines. No open
problem or requested work remains.

Implementation commits: `97b181fec` (mask accounting), `ea2b2df7c` (partial
provenance merge and regressions). Both have the required coauthor trailer.
The final documentation commit appends the journal and this report. Nothing
was pushed or published.
