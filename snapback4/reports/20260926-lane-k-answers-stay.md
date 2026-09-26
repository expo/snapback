# Lane K: answers stay on screen

2026-09-26. Branch `sb4-intent/k-answers-stay`, base `99153132b`.
Scope: supplied LLP 3000.019 §3.3, parts 1–3. No push or publication.

## Built

- `packages/snapback4/src/react.tsx`: `usePage` returns the ready prefix while
  a subsequent page loads. Its read metadata describes that prefix; `hasMore`
  stays false while the pending page owns the continuation. A first-page
  reset still clears the prefix and closes the suffix; a refusal still
  propagates. Invalid non-array page data keeps the existing loading guard.
- `packages/snapback4/test/react.test.mjs`: changed the old assertion that
  a pending suffix makes the combined read loading. Added a Chromium case
  covering two loaded pages while a third loads, preserved input identity and
  draft, freshness/completeness/cut metadata, a later refusal, a first-page
  reset, a late obsolete reply, and an empty ready prefix.
- `packages/snapback4/README.md`: documents the pagination behavior in the
  existing hooks paragraph, without adding lines or Quarry syntax.
- `packages/snapback4/test/answer-withdrawal.test.mjs`: seven executable
  disclosure counterexamples, described below.
- `JOURNAL.md`: one dated entry for the implementation, measurements, and
  stopped work.

The existing form now keeps the editor mounted while loading more:

```tsx
const page = usePage(api.recent, {});
if ("loading" in page.read) return <Spinner />;
return <><Editor /><Rows rows={page.items} />
  <button disabled={!page.hasMore} onClick={page.loadMore}>More</button></>;
```

No client contract, query language, authorization rule, interpreter, meter,
wasm source, or package version changed. No diagnostics were added.

## Stopped parts 1–2: revocation is also an ordinary commit

The design says to retain on `apply`, `admit`, and `settle` under the same
authority, and also requires immediate withdrawal on authority changes.
These operation names do not distinguish the two cases. The supplied
acceptance requirement that a watch never publishes loading across those
operations cannot hold without an authority-change exception implemented at
the commit boundary. The client currently gets no separate authority-change
signal there. Adding a protocol or deriving an authority classifier would
require deciding that missing part of the design; this lane stops it per the
brief rather than weakening the existing withdrawal rule.

This also preserves the existing `page-authority.test.mjs` regressions for
applied revocation (including fallible work after commit), predicted membership
removal, and predictions that expire either a secret or its authorizing member.
Those are disclosure resets, not merely old spinner expectations to update.

Concrete schema and counterexample, run against both real devices:

1. `secrets.read <- exists members[.room, viewer]`, with `sync to
   members[.room]` and the default until-revoked retention. Alice and Bob are
   members; Bob observes a secret with body `private answer`.
2. Alice removes Bob's membership. The server emits an ordinary sync page
   containing the secret table's `scope` tombstone. The device commits it
   through `apply`. Neither store identity, credentials nor viewer changes;
   no `clear_rows`, `adopt`, resetting `observe_store`, or `settle_exit` runs.
3. Hold the replacement device query. The commit must immediately withdraw
   Bob's previous answer. Keeping it leaves unauthorized data in the snapshot
   for the entire held read. Once released, the real query returns null.
4. Bob's predicted `leave()` has the same problem at `admit`: its footprint
   includes `members/bob`; the old secret answer must disappear before the
   replacement query. A credential comparison does not detect this change.

The online counterexample uses the same server and schema. After Alice's
revocation, hold Bob's refetch triggered by `/changes`: the notification must
withdraw the old answer before the server's new answer returns. The existing
online `refresh` does not enable `retain`, contrary to the design's description
of that path.

Two further cases close Bob's watch before the remote revocation, let its
`apply` commit, and remount with the same operation, arguments, viewer and
store identity. The new watch must start loading, not with the pre-revocation
answer. Thus the proposed 30-second cache depends on the same missing
invalidation decision. It was not implemented separately with an invented
reset policy.

Reproduce the guard cases after building the package:

```sh
node --test packages/snapback4/test/answer-withdrawal.test.mjs
```

All seven pass with the existing withdrawal behavior. A negative experiment
changed only generated `dist/local-reads.js` to keep a data snapshot in
`LocalReads.clear` (still advancing its revision), and enabled `retain: true`
on the existing online watch fetch. Running the five `apply|admit|online:`
cases failed **5/5**: the actual snapshot still contained `private answer`
with `fresh: false`, instead of loading. Generated files were then restored
by `bun run build`; no unsafe retention change is committed. The two remount
cases establish the required invalidation boundary, not an implemented cache.

This stops the universal retention change and the cache, not the goal of
keeping answers for commits known to preserve authority. The supervisor
needs to specify how those commits are distinguished from withdrawals on
both clients. No implementation of `settle` retention or 30-second expiry was
attempted. Existing publication fences, server-answer store-cut ordering,
expiry behavior, and resets are untouched. Part 4 belongs to another lane.

## Verification

- `bun install --frozen-lockfile`, package build: passed.
- Targeted Chromium harness and disclosure cases: 33 passed, 0 failed,
  0 skipped, including the harness's parent test.
- Whole guide suite: 85 passed, 0 failed, 0 ignored.
- Wasm: 2,021,689 B raw; 581,094 B gzip; budget 582,094 B. This matches
  the recorded 0.4.3 baseline, so the delta is 0 B; budget unchanged.
- Required `scripts/test.sh`: **`== 0 failure(s) in 1352 s`**, exit 0.
  No failures to classify as introduced, baseline, or environmental. The
  main client batch passed 2,131 tests with 10 existing skips; the final
  model batch passed 78 with no skips. All seven new disclosure cases and
  the Chromium pagination case passed in this run. This was a cold test
  build, with `CARGO_BUILD_JOBS=8`, `CARGO_PROFILE_DEV_DEBUG=0`, and
  `CARGO_PROFILE_TEST_DEBUG=0`; the script was run once, unmodified.
