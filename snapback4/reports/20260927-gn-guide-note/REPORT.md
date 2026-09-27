# Lane GN — 0.4.5 guide, history and held-read advice

Branch: `sb4-intent/gn-guide-note`, base `dde688548`. No push or publication.
Design: LLP 3000.021 §§3.1, 3.4, 3.5; runtime routing, authorization and meters are unchanged.

## Implementation decisions and scope

- `N_HELD_UNKNOWN` uses lowered `ir::read_sites`, after helper/shape expansion,
  and effective table/view `sync`. It names the source and site and says
  “move the read to its own query, or drop `held`”. It is advice, including
  for a potentially untaken branch; it does not refuse a previously valid query.
- The app, sync and receipts cards show bare ordinary history without a
  membership `require`. App and receipts retain the conversation and its
  messages and pin the parent separately. Profiles, quotes, reactions and
  receipt reads render beside history. Held all-chat search remains device-only.
- The new acceptance program is a **messaging excerpt** of the permitted Grok
  comparative program, not a copy of its unrelated feed, typing, media mutations
  and digest program. It keeps the messaging rules and write bodies, including
  the original retained-members policy. The comparative packet was not changed.
  History and receipt pages share the horizon's named unique ordinal index;
  progress uses the current descending interval recipe, and reactions have a cursor.
- The empty-needle directory branch generated for a held word search no longer
  gets `N_SYNC_ORDER`. An ordinary mismatched held page still does. This was
  needed for the requested note-free held examples; no IR or execution changed.
- The search card now has a 200-row acquisition horizon, removing its old
  `N_NO_HORIZON` exception from the whole-guide test. Existing search witnesses
  explicitly remove that horizon when testing full holdings, retaining their
  original assertions and separate ten-row horizon cases.
- The README stays at its unchanged 300-line limit. Duplicate notes/jobs and
  feed examples were replaced by their existing tested cards to make room for
  IDs, ordinary history, parent/message retention, held search, the receipt link,
  product caps, and the Following name collision.
- The comparative fixture lives outside the frozen compatibility fixture set,
  under `crates/snapback4-lang/tests/history/comparative.q`. The compatibility
  golden bytes remain unchanged. The authoring census drops only the three
  lines belonging to the removed duplicate README `addNote` example.

## File-by-file changes

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/bind/held.rs` | New lowered may-read note pass. |
| `crates/snapback4-lang/src/bind/mod.rs` | Invoke the advisory pass after binding. |
| `crates/snapback4-lang/src/bind/residency/horizons/sync_order.rs` | Exclude the generated held-word directory branch from order advice. |
| `crates/snapback4-lang/src/diag.rs` | Route the new note to the sync card. |
| `crates/snapback4-lang/src/guide/codes.rs` | Register the note and its short explanation. |
| `crates/snapback4-lang/src/guide/why.rs` | Select the dedicated why text. |
| `crates/snapback4-lang/src/guide/why/N_HELD_UNKNOWN.md` | Explain the note, boundary and rewrite. |
| `crates/snapback4-lang/src/guide/app.rs` | Retained parent, bare thread and separate author/quote/reaction queries. |
| `crates/snapback4-lang/src/guide/receipts.rs` | Retained parent/messages, bare history, separate receipt/decorations and screen/inbox queries. |
| `crates/snapback4-lang/src/guide/sync.rs` | Ordinary horizon-index history, parent query, held search and note guidance. |
| `crates/snapback4-lang/src/guide/search_all.md` | Bound the example acquisition so the example compiles silently. |
| `crates/snapback4-lang/tests/guide.rs` | Move receipt assertions, remove the note exception, recognize deliberately unsynced held advice and allow the required receipt link. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pin the new note definition. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pin the concrete recovery and word/horizon boundary. |
| `crates/snapback4-lang/tests/held_unknown.rs` | Seven focused compiler regressions. |
| `crates/snapback4-lang/tests/history/comparative.q` | Adapted comparative messaging program shared by Rust and JS tests. |
| `crates/snapback4-device/tests/readauth/census.txt` | Remove three entries for the deleted duplicate README mutation. |
| `crates/snapback4-sim/tests/search_global/fixture.rs` | Preserve full-history controls separately from the bounded guide example. |
| `packages/snapback4/README.md` | First-account IDs, retention/history/search, receipt link, caps and Following naming within 300 lines. |
| `packages/snapback4/test/ordinary-history.test.mjs` | Eight real-server local/HTTP acceptance tests. |
| `../llp/3000.021-what-the-comparative-builder-still-wrote.rfc.md` | Implementation notes under P12, P15 and P16, with revision metadata. |
| `JOURNAL.md` | One dated append-only implementation and qualification entry. |
| `reports/20260927-gn-guide-note/REPORT.md` | This report, including every full-suite failure and reproduction scopes. |

## Forms exercised

```quarry
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query messageReceipts(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .ordinal after c { id, receipt: receipt(.) }
query quotedMessage(message: messages):
  return messages[messages[message].quote]
query profileFor(owner: principal):
  return profiles[principal = owner]
query myReaction(message: messages):
  return reactions[message = message, principal = viewer]
query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at
```

These snippets use their respective card/fixture schemas. The fixture names
its parent-only query `conversationById`; the cards name it `conversationScreen`.
Both conversation and messages declare `retain delivered-history`.

```ts
const intent = { id: mintId(), args: { handle: "alice" } };
await client.mutate(api.saveProfile, intent.args, { id: intent.id });
const queued = await client.pendingWrites();
```

## New tests

`crates/snapback4-lang/tests/held_unknown.rs` adds seven tests:

1. The comparative excerpt compiles with no diagnostic or note and history
   reads only messages while search stays held.
2. The original decorated held-history shape diagnoses the unsynced reaction
   at its source location and supplies the exact rewrite.
3. Explicit and omitted sync, helpers, named shapes, branches, nested point
   keys and `exists` (projection and predicate) all participate in the may-read walk.
4. Unsynced aggregate views and ephemeral sources are noted; inherited synced
   views are silent. The existing ephemeral held-query refusal remains.
5. Horizons, words and ordinary remote reads do not produce this held note.
6. Held word search avoids generated directory-order advice while an unrelated
   mismatched held page still receives it.
7. Every guide held example is silent for the new note.

`packages/snapback4/test/ordinary-history.test.mjs` adds eight tests across wasm
and the native process device, all on a real HTTP backend:

- Two comparative tests: another member sends a DM before acquisition and
  ordinary fallback displays it; `createClient` calls bare history; quote,
  profile, receipt and reaction assertions use their own queries; held search
  still refuses on HTTP; an offline send with no predicted row is listed by
  `pendingWrites`, persists across reopen and settles once on reconnect.
- Six retention tests: each of the app card, receipts card and comparative
  excerpt keeps its parent and history after leave/removal, watch remount and
  device reopen both offline and online. The two actual guide programs drop
  their inbox membership, and the online-only client gets no retained rows.

Existing receipt progression, gap, recipient and meter assertions now query
`messageReceipts`. The whole guide now has no intentional note exception.

## Full-suite failures and attribution

Every Rust failure below is **introduced by this lane's test inputs**, and
subsequently corrected without changing runtime behavior. The search failures
used a newly horizoned guide source while asserting full coverage; the census
expected a removed duplicate README mutation; the compatibility census swept
up a new fixture that did not belong to its pre-ephemeral frozen set.

- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::w13e_dense_100`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::w13e_dense_100`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_100`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::w13e_grouped_cut_continues_through_9000_memberships`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_flattened_drain_cut_continues_after_32_emissions`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::w13e_dense_500`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_hidden_worlds_have_identical_pages_and_dev_meters`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::uniform_word_grouped_matching_membership_is_last_rule_visible_on_cut_page`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::w13e_dense_500`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_100`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::w13e_grouped_cut_continues_through_9000_memberships`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_flattened_drain_cut_continues_after_32_emissions`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_further_terms_and_duplicate_words_preserve_one_ordered_walk`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_hidden_worlds_have_identical_pages_and_dev_meters`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w14a_uniform_words_past_32_keep_later_scopes_and_nonuniform_stays_capped`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_500`
- **Ours, corrected:** `snapback4-device::device::search_global::w7r1b_search_cursor_memory`
- **Ours, corrected:** `snapback4-device::device::search_global::w7r1b_search_cursor_sqlite`
- **Ours, corrected:** `snapback4-device::device::search_global::w7d_every_chat_word_search_measures_full_and_horizon_holdings_on_both_stores`
- **Ours, corrected:** `snapback4-device::device::search_global::w7d_global_word_scope_can_cut_when_each_chat_scope_fits`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::w13e_dense_1000`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::memory::cases::w13e_newest_measures_complete_page_and_opening_envelope`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_500`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_clique_every_row_hits_in_1000_lanes`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::w13e_dense_1000`
- **Ours, corrected:** `snapback4-device::device::search_global::forms::sqlite::cases::w13e_newest_measures_complete_page_and_opening_envelope`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::memory::cases::w13f_dense_1000`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_clique_every_row_hits_in_1000_lanes`
- **Ours, corrected:** `snapback4-device::device::search_global::lazy::sqlite::cases::w13f_dense_1000`
- **Ours, corrected:** `snapback4-lang::ephemeral_compat`
- **Ours, corrected:** `snapback4-device::readauth`

Reproduce the affected scopes from `snapback4/`:

```sh
cargo test -p snapback4-lang --test ephemeral_compat --test held_unknown --test guide
cargo test -p snapback4-device --test readauth census::authoring_census
cargo test -p snapback4-device --test device search_global:: -- --test-threads=4
cargo test -p snapback4-sim --test clique search_global:: -- --test-threads=4
node --test packages/snapback4/test/ordinary-history.test.mjs
```

## Limits and inherited behavior

The comparative's original `members` table retains delivered history too.
After Alice removes Bob, Bob's device can still return its retained membership
in `inbox`. Reproduce with the comparative retention test's seeded group:
call `removeMember({conversation: "chat", principal: "dev:bob"})` as Alice,
sync Bob, then call Bob's `inbox`. This fixture preserves that policy. The guide
programs use until-revoked memberships and do drop the inbox row; the assertions
pin that difference. Retention never grants server authority.

No Expo UI, Apple simulator or whole comparative rerun is claimed. The native
witness here is the Linux process device and the web witness is the real wasm
device with persistent memory storage. The supervisor owns integration and
blind reviews. No delivery reporter, packaging, runtime or client routing changes.

## Qualification

Ran `scripts/test.sh` once, exit 1. Exact summary:

```text
== 1 failure(s) in 1375 s
   cargo test
```

The only failing check was `cargo test` (903 s), with the 34 **ours, corrected**
Rust failures enumerated above: 32 search cases, the authoring census, and the
frozen fixture-set compatibility check. No baseline or environmental failure
was observed. Rust reported 3,758 passed / 34 failed / 24 ignored in that run.
The original red run is preserved; it is not claimed as a green full suite.

After the test-input corrections, the complete affected scopes passed:

| Check | Result |
|---|---|
| Whole guide | 86 passed |
| New held note regressions | 7 passed |
| Frozen compatibility | 1 passed |
| Authoring census | 1 passed |
| Device search, memory and SQLite | 50 passed |
| Server search | 17 passed |
| New local-client acceptance | 8 passed, focused and in the full suite |

The full suite's other checks passed, including client main (2,474 passed,
10 intentional skips), all seven client shards (56 passed), all 78 seeded
client models, 9 fixture-wrapper tests, both app typechecks, package build and
typecheck, documentation budget, release guard and wasm budget. The full suite
was not repeated after the corrections; affected tests were rerun as listed.

Wasm: **1,980,253 B raw / 571,841 B gzip**, **0 B delta**, unchanged
572,841 B gzip budget. SHA-256 matches the committed integration baseline:
`61e9f947f9c3c40b3323a6fedd70f079b051d7d15b654be176ab6e81099eb51c`.
README: 300/300 lines. No changed source file exceeds 1,500 lines.
Reference audit: 515 LLP documents, 9,566 references, zero errors or unchecked.

Toolchain: Node 24.13.1, Bun 1.3.14, Rust 1.97.0; full run uses eight Cargo jobs,
no dev/test debug info, and file limit 65,536. Frozen Bun install passed before
JS testing. Implementation commits: `63c48dddf`, `b72a28dc7`; the final
report/journal commit records this qualification.

Logs remain in the lane's ignored `target/lane-gn/qualification/` directory,
including [the original full run](../../target/lane-gn/qualification/full.log).
No introduced failure remains unresolved in the affected checks. The original
comparative inbox-retention policy described above remains deliberately intact.

## Round 1 — 2026-09-27

Read the binding lane prompt, round-0 report and journal entry, and both complete
READY WITH CHANGES reviews. First ran `git fetch origin && git merge origin/main`:
already up to date at `ac7d82185`; no conflict or discarded side. Fixed only the
four requested findings and the tests/documentation proving those fixes.

### File-by-file changes

Paths below are relative to `snapback4/`.

| File | Round-1 change |
| --- | --- |
| `packages/snapback4/README.md` | Import `mintId` from `snapback4/client`; use the feeds card's `query home`. |
| `crates/snapback4-lang/src/bind/held.rs` | Also note an unsynced read-through parent (including an inherited view parent) and source-located `connected[...]` occurrences from the binder's expanded sources. |
| `crates/snapback4-lang/src/guide/codes.rs` | Describe both added note cases in the existing code entry. |
| `crates/snapback4-lang/src/guide/sync.rs` | Describe the added note cases in the sync card. |
| `crates/snapback4-lang/src/guide/why/N_HELD_UNKNOWN.md` | Explain unavailable parents and server presence with the same recovery. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pin that expanded definition. |
| `crates/snapback4-lang/tests/held_unknown.rs` | Add parent/presence cases and silence controls; require bare scan returns for the comparative and all three guide histories. |
| `crates/snapback4-lang/tests/history/comparative.q` | Preserve the bare history; copy the original comparative's `sendImage`, `editMessage` and `deleteMessage` bodies so the original history assertions can run. |
| `packages/snapback4/test/first-account.test.mjs` | Execute README package imports using actual public exports and the kept-ID snippet; pin the Following reader against its card. |
| `packages/snapback4/test/ordinary-history.test.mjs` | Assert all 17 stored columns on HTTP and acquired local history, original edit/quote/reaction/view-once behavior, and actual React rendering of bare history plus unpredicted queued sends. |
| `packages/snapback4/test/fixtures/ordinary-history.mjs` | Focused adaptation of the comparative bubble: stored rows render independently of four decoration snapshots; pending sends come from `pendingWrites`. |
| `JOURNAL.md` | One dated round-1 entry appended. |
| `reports/20260927-gn-guide-note/REPORT.md` | This round-1 section appended; round 0 remains intact. |

### Forms and assertions exercised

- `import { mintId } from "snapback4/client"` resolves and the README's kept-intent
  snippet executes with an accepted minted ID. The Node test executes all six
  README imports from `snapback4/*` and React through their public exports.
  A separate Expo/Metro web bundle evaluates every first-account import in
  headless Chromium: 23 bindings, zero runtime errors, including React Native
  web, SecureStore, snapback4-expo, `./src/client` and the real generated API.
  That probe uses this lane's Expo 57.0.22 and the permitted comparative lane's
  already-installed react-native-web 0.21.3; no dependency or lockfile changed.
- `query heldFile(id: files) held: return files[id]` on a synced child of an
  unsynced `folders` parent compiles with `N_HELD_UNKNOWN` at the read.
  Point, `exists` and page reads cover omitted sync and explicit online-only
  parents. Synced and horizoned parents stay silent.
- `query q(p: principal) held: return connected[p]` compiles with the same
  note, as do `exists`, helper, shape and branch variants. Ordinary equivalents
  stay silent. Existing word/horizon and all guide-held silence checks pass.
- `query history(conversation: conversations, c: cursor ?): return messages
  where .conversation = conversation last 20 by .ordinal after c` still
  returns the stored rows. The compiler assertion now requires a bare scan
  return, not merely reads whose table is messages. This is an acceptance
  invariant, not a new language prohibition on valid projected queries.
- The HTTP and local acceptance checks pin `id`, `conversation`, `sender`,
  `ordinal`, `recipients`, `kind`, `text`, `caption`, `photo`, `photoOnce`,
  `clip`, `quote`, `tombstone`, `editedAt`, `at`, and `expiresAt`.
  Original m3-a10 moves its excerpt to `quotedMessage`; m3-a11 keeps the quote
  ID; m4-a06/a07 replace/remove reactions through the separate query; m4-a09
  keeps `editedAt`; m5-a04/a05 open the history's `photoOnce` asset once and
  refuse the second open. Delete keeps a tombstone. Media/edit/quote rendering
  is asserted too.
- The focused React render uses real HTTP history and real `pendingWrites`
  from the nonpredicting offline send on both device tiers. Each separate
  profile/quote/receipt/reaction snapshot is forced loading and then refused;
  both message bubbles, the quote jump and the queued send remain. Ready
  decorations appear beside them. This is a focused static React render,
  not a claim that the complete Expo comparative UI was rerun.
- `query home` is present on the feeds card; the README regression reads its
  actual name rather than duplicating a fixed expected string.

### Mutation evidence

Each source mutation was applied, its test command run, and the source restored
before the final positive checks and full suite. Logs are in
`target/lane-gn-round1/`.

| Mutation | Observed failure |
| --- | --- |
| Restore `mintId`'s root `snapback4` import | Node export test exits 1 with `ERR_PACKAGE_PATH_NOT_EXPORTED`. |
| Remove the read-through parent from the note walk | Parent compiler regression exits 101: missing note. |
| Disable the presence source match | Presence compiler regression exits 101: missing note. |
| Append `{ id, text, quote }` to comparative history | Compiler assertion exits 101; client file exits 1 (6 failed results, including the stored-field and rendering assertions on both tiers). |
| Add Grok's `require exists participants[c, viewer] else NOT_MEMBER` to the sync-card history | Guide-history compiler assertion exits 101. |
| Restore `query homeFeed` in the README | Following-name test exits 1. |
| Gate the rendering fixture on loading/refused decorations | Rendering tests fail on both tiers; client exits 1. |

Commands used for the named review mutants:

```sh
cargo test -p snapback4-lang --test held_unknown comparative_bare_history
node --test packages/snapback4/test/ordinary-history.test.mjs
cargo test -p snapback4-lang --test held_unknown guide_histories
```

### Qualification

Frozen Bun install and package build passed. Restored affected checks:

- `cargo test -p snapback4-lang --test held_unknown --test guide --test ephemeral_compat`:
  10 compiler tests, all 86 guide tests, and 1 frozen compatibility test passed.
- `node --test packages/snapback4/test/ordinary-history.test.mjs packages/snapback4/test/first-account.test.mjs`:
  16 passed, 0 failed, 0 skipped. The ordinary-history file contributes 12
  results (10 top-level tests and two focused rendering subtests); first-account
  contributes 4.
- Expo web import probe: all 23 bindings evaluated; no browser runtime error.
- `./ref-check --verbose`: 515 LLP docs, 9,567 references, 0 errors, 0 unchecked.
- README remains 300/300 lines; all changed source files remain below 1,500.

Ran `scripts/test.sh` exactly once at the end, after restoring every mutant and
rerunning the affected checks. Exit **0**; exact summary:

```text
== 0 failure(s) in 997 s
```

Every stage passed: cargo build, wasm build, documentation budget, release guard,
package typecheck/build, chat check, Rust tests/doctests (535 s), both app
typechecks, nine fixture-wrapper tests, client main (2,480 passed; 10 intentional
skips), seven client shards (56 passed), and all 78 seeded client models. The
new GN checks also passed within this full run. **No introduced, baseline or
environmental test failure** occurred in the final run. The round-0 red run
above remains the unmodified historical record.

Wasm rebuilt at **1,980,253 B raw / 571,841 B gzip**, **0 / 0 B delta** from
round 0, under the unchanged **572,841 B** budget (1,000 B headroom). SHA-256:
`61e9f947f9c3c40b3323a6fedd70f079b051d7d15b654be176ab6e81099eb51c`.
Node 24.13.1, Bun 1.3.14, Rust 1.97.0; eight Cargo jobs, dev/test debug off,
file limit 65,536, and the suite's ordinary test concurrency.

No deviation from the round-1 brief and no unresolved round-1 finding. The
comparative's inherited retained-members policy and its reproduction remain
recorded in the round-0 limits above. No production client, engine, routing,
authorization, disclosure, durability, meter, package version, search fixture,
frozen fixture or budget change. The added image/edit/delete writes are copies
inside the acceptance fixture, not new engine behavior. No full comparative
rerun or Apple/native UI claim; the browser import witness is Expo web. No push
or publication. The commit carries the requested GPT-6 Astra co-author trailer.

Full run: `target/lane-gn-round1/full.log`. Restored checks:
`affected-rust.log`, `affected-client.log`, `ref-check.log`. Mutations:
`root-import-client.log`, `through-parent-compiler.log`,
`presence-compiler.log`, `history-projection-compiler.log`,
`history-projection-client.log`, `sync-membership-compiler.log`,
`following-name-client.log`, `decoration-gates-history-client.log`.
All are under `target/lane-gn-round1/`, alongside `imports-build.log` and
`imports-browser.log` and the exact scratch browser probe.
