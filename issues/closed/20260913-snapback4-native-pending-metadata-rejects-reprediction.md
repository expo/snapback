# Snapback 4 native predictions reject their own pending metadata on repeated updates

**Status:** Resolved
**Systems:** snapback4-device, snapback4-core, native prediction
**Severity:** P1
**Author:** Codex
**Date:** 2026-09-13

## Problem

The native device's first optimistic update succeeds, but another update of
that pending row is refused with `E_INPUT`: the device added `pending: true`
to the stored row, and the core subsequently validates that metadata as an
undeclared application column. Replaying a queued profile update after an
offline restart therefore prevents Interview from opening its saved feed.

Observed in Interview's real Exact2 native module/SQLite test on 2026-09-13:

```text
E_INPUT: E_INPUT: people row contains undeclared field pending
```

The equivalent browser-replica persistence/replay tests pass. Interview is
deferring native profile/vote edits until this is fixed; adding `pending` to
the app's schema would make an engine detail part of user data and is not the
requested workaround.

## Reproduction

1. Open a native `snapback4_device::native::Device` with a compiled schema
   containing a `people` table without a `pending` column, and a mutation that
   updates the person's name/bio. Apply a confirmed person in a snapshot.
2. Enqueue and predict that profile update. It succeeds; the durable row now
   carries the device's `pending: true` metadata.
3. Close the device, reopen the same SQLite store while offline, and predict
   the same queued update to restore the local outbox overlay.
4. The update is refused with the error above instead of returning the saved
   profile and remaining usable. A second predicted update without closing
   follows the same merge/validation path and must be covered too.

Application witness: `~/projects/interview-wt-snapback4`, Interview revision
`a64c4ba`, `apple/src/replica_tests.rs`, test
`native_replica_renders_and_saves_offline_then_reopens_the_same_outbox`.
The witness signs in to a simulated transport, applies confirmed rows through
the real native module, edits the profile offline, creates a prompt offline,
and reopens the same native store. It uses no live credentials or user data.
Run from that Interview revision with its documented sibling checkouts:

```sh
EXACT_UPDATE_TRUST=development cargo test -p interview-apple native_replica_renders_and_saves_offline_then_reopens_the_same_outbox -- --nocapture
```

Additional diagnostic output is retained locally at
`/tmp/interview-native-reopen-diagnostic.log`. The diagnostic explicitly checks
the reopened app error; it reports the error above with an empty conversation
feed, although the saved profile is still in SQLite. The existing web witness
is `tests/replica.test.mjs`, run through `npm run test:backend` in Interview.

## Cause and observed source

In `snapback4/crates/snapback4-device/src/native.rs`, `Predicting::put` clones
the application row, inserts `pending: true`, and persists that augmented row.
Its `get`/`lookup` methods return the augmented row unchanged.

In `snapback4/crates/snapback4-core/src/engine/write.rs`, `update` clones the
old row and applies the patch; `replace` then calls `validate_row` on the
merged row. The application schema does not declare `pending`, so the native
device rejects metadata it introduced itself.

This was observed against the **working tree** at `~/projects/snapback-sb4`
(base HEAD `58251b46dce85b379bbf02f94b1ddad308b41a5d`, with pre-existing source
changes). It is not a claim that this exact regression was reproduced in the
published npm 0.1.15 native binary. Source SHA-256 values when filed:

- `snapback4-device/src/native.rs`: `a96a9383711935dda857747b034e3267525888ec3cf90cec0d33e72abb21777a`
- `snapback4-core/src/engine/write.rs`: `1f2b719dfd47344c9baecf0d3e9ea9327f316d8b45283b02c73d5820f9bc16cb`
- `snapback4-core/src/engine/validate.rs`: `57d5c18671701407cac18054bee85f6bc1b41da854b619468c9a2dafc6807eb6`

## Expected outcome and regression coverage

Treat native prediction metadata separately from declared application columns
when reading, merging, and validating a row. Keep strict rejection of arbitrary
undeclared user fields; do not fix this by generally allowing unknown columns.

Add native-device regression tests for repeated profile updates, repeated vote
updates/upserts with their aggregate changes, and close/reopen plus replay of
both while offline. Verify the final values, durable outbox, and pending card
state, then confirm that server acknowledgement replaces the optimistic image.
Run the same mutation sequences on the TypeScript replica and native device to
establish parity. Interview's saved feed must remain available on reopen.

This issue records the bug only; no upstream source fix or schema relaxation
is included.


## Resolution — 2026-09-13

The upstream correction was already included in `12c12a8e6` on main: native
`Predicting::get`, `lookup`, and `scan` remove only the device-owned top-level
`pending` field from values passed to the shared mutation interpreter. Queries
continue to read persisted pending cards. Core row validation still rejects
undeclared application fields, including a caller-supplied `pending`.

Interview links the older, modified `~/projects/snapback-sb4` source directly
through Exact2. The same three-path filter was applied narrowly in that local
checkout, preserving every pre-existing edit. This is a local source backport;
it does not claim a rebuilt or published Expo framework. The original source
is retained at `/tmp/sb4-pending-native-working-tree-before-20260913.rs`, and
`/tmp/sb4-pending-local-backport-20260913.json` records its ownership.

Regression coverage on main shares `snapback4-device/tests/fixtures/pending-metadata.q`
between `snapback4-device/tests/native.rs` and the actual TypeScript/native
client lifecycle tests. Both execute two profile updates, two vote upserts,
an indexed vote update, and a scanned vote update. Checks cover exact values,
maintained totals without double-counting, pending card state, persistent
outbox order and identity, offline reopen, and acknowledgement replacement.
The direct native test additionally re-predicts the saved queue explicitly and
checks strict undeclared-field rejection.

Verification:

- All 8 native device tests pass, including the new regression.
- Both new client lifecycle cases pass: actual TypeScript SQLite replica and
  native Rust device, using the same authored fixture and mutation sequence.
- The same direct prediction/replay/acknowledgement sequence passes against
  Interview's older local dependency with the narrow backport. The external
  witness is `/tmp/sb4-pending-local-witness-20260913`; its log is
  `/tmp/sb4-pending-interview-20260913-1.log`.
- Interview's real Exact2/native SQLite reopen test passes with the local
  backport (`/tmp/sb4-pending-interview-20260913-2.log`); Interview's existing
  profile/vote deferral stays enabled, so the direct witness above separately
  proves the formerly refused prediction path.
- Independent source review reports no material finding in the metadata
  filter, local backport and new regression controls.

Interview's application-level deferral of native profile/vote predictions is
separate from this upstream correction; this change does not remove it or
change Interview source.
