# MS — conversation-ordered matching search

2026-10-04. Base: `abafa9af9cd58e30a3b0dc6461cd4ab339c3cb83` (`origin/main`
at worktree creation). Branch: `sb4-intent/ms-matching-ordered-search`.
All execution is local to the assigned eb1000 workspace (OS hostname
`expose-builder-pixel`). No other host, push or publication.

## Finding and reproduction

This is a misleading diagnostic for an intentional physical-index restriction,
with a missing ordinal-search recipe. It is **not** an inability to order word
matches by conversation position. The existing field-order planner already
compiles and executes that intent.

The input is `~/sb4-intent/cal30-items/grok/`: `diary.md` M5 records the
failed named-index form; `run-log.md` records the build; the saved `schema.q`
already contains the workaround. [Input hashes](./builder-evidence.json)
identify the untouched evidence. Its `searchChat` at line 338 returns:

```quarry
query searchChat(conversation: conversations, q: text <=100, c: cursor ?):
  return messages[conversation = conversation] matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].displayName }
```

Build current main with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build --locked -p snapback4` from `snapback4/`. Copy the builder's schema
into `target/ms-repro/named/snapback/schema.q`; change only `by .at` in
`searchChat` to `by byConversationOrdinal`. Run the absolute built CLI's
`check --json` from that copied application directory.

The [exact baseline diagnostic](./before-named.json), exit 1, is:

```text
schema.q:339:10 — E_QUARRY_UNKNOWN
messages.byConversationOrdinal has its words after 0 columns; matching takes exactly those as keys
rewrite: messages[] matching q first 50 by byConversationOrdinal
guide: language
```

The index has no words component. That rewrite repeats the incompatible index,
drops the conversation and cursor, and changes the direction and page size.
Both the [saved `.at` form](./before-saved.json) and the same full schema with
[only `.ordinal` instead](./before-ordinal.json) compile on unmodified main
(exit 0). The builder's ordinals are integers managed by its receipt declaration;
they are not authored `sequence by` columns. Both forms are covered below.

## Governing context and decision

The scoped `llp-orient` pack covers the search binder, repair verifier, search
card and shared search execution; it does not change a runtime protocol.

- [LLP 3000 §1/§4](../../../llp/3000-snapback4.explainer.md) and
  [LLP 2000.000 §6/§7](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md):
  one interpreter, runtime metering and acquired partitions. Both are in
  `llp/current/`; Snapback 1–3 gates and runtime bootstraps do not apply.
- [LLP 3000.007 §18.1](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#181-search-across-the-viewers-groups-is-a-merge-of-matching-lanes)
  and §20.24.1: words merge as lanes ordered by the index suffix; uniform
  discovery and drain remain metered, and device coverage remains conservative.
- [LLP 3000.013 §2.1/§2.3](../../../llp/3000.013-quarry-states-intent.rfc.md#2-reads-state-intent):
  `search` declares text fields; pins and field ordering synthesize the search
  index. This is the current planning contract complementing LLP 3000.007.
  Both documents are in `llp/current/`, not `foundation/`.

The [planner](../../crates/snapback4-lang/src/bind/intent.rs) returns early for
an explicit index. Otherwise it inserts words after the equality pins and
appends the order and `id`. The
[binder](../../crates/snapback4-lang/src/bind/program.rs) selects a search
candidate only when `index.searches_after(keys.len())`; the old fallback used
zero as the words position even for a plain index. The shared
[word scan](../../crates/snapback4-core/src/engine/read.rs) already merges
search candidates in suffix order. Combining two physical indexes is unnecessary.

The fix retains that intentional restriction, corrects the explanation, and
supplies a context-compiled rewrite. The unique constraint stays intact.
No planning, schema, IR, cursor, meter, authorization or coverage rule changes.
LLP 3000.007 §18.1 gains a clarification and pointer to this evidence.
No unresolved design handoff is required.

## Delivered behavior

The [new diagnostic](./after-named.json) points to `guide search`, explains that
`byConversationOrdinal` is a plain index, and prints:

```quarry
messages where .conversation = conversation matching q last 20 by .ordinal after c
```

Pasting that expression into the full builder schema, retaining both projections,
[passes `check --json`](./after-rewrite.json), exit 0. The planner builds
`(conversation, words(text), ordinal, id)` without changing the unique index.

[Repair verification](../../crates/snapback4-lang/src/repair.rs) checks the
replacement in the actual declaration and callers. Named and positional scope
operands, predicates, search expressions, direction, page size and cursor are
preserved. A repair that fails compilation or admission is withheld. A genuine
words index with the wrong scope retains its distinct diagnostic.

`guide search` now has “Search one conversation, newest first, paged,” with a
compiled sequence schema, `.ordinal` ordering, cursor reset guidance and the
acquired-history limit. Existing integer/receipt allocators need no migration.
The duplicate directory schema was removed; the complete directory form remains
in the membership example. The card is 401 lines, under its unchanged 405 cap.

## Verification

All Cargo commands run from `snapback4/` with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`; Bun dependencies were
installed with `bun install --frozen-lockfile`. Node is 24.13.1 and Bun 1.3.14.

- `cargo test --locked --no-fail-fast -p snapback4-lang --test matching_order
  --test guide -p snapback4-device --test matching_order`: 118 passed.
- Final `cargo test --locked -p snapback4-device --test matching_order`:
  2 passed, executing twelve combinations of memory/SQLite, integer/sequence
  ordinals, and no window/500-row window/3-row window. The tests execute the
  printed repair, acquire and close the store, reopen without a backend, and
  page offline. Timestamp and ID order oppose ordinal order. Single/multi-term
  prefixes, duplicate-word hits, empty needles, no matches, hidden conversations,
  equal cross-host cursors and missing older matches are checked.
- Both existing directory guide witnesses pass after selecting the complete
  block containing `table profiles:` **and** `query people(`. All original
  expected rows, page sizes, continuations and completeness assertions remain.
- `./ref-check --verbose`: passes after the final report and journal update,
  with zero errors or unchecked references. `git diff --check` passes.

The new coverage witness distinguishes a full acquired partition from a sync
window. Even when a 500-row window holds all seven fixture messages, word-search
coverage stays conservative; its empty-term browse branch can prove coverage
through the ordinary ordinal index. A 3-row window cannot certify exhaustion
of missing older matches. This records existing behavior, not a new promise
of local completeness.

`cargo test --locked --no-fail-fast -p snapback4-lang --tests` completed with
**1,465 passed, zero failed, 11 existing ignores across 106 targets**. This
includes the affected planner, search-guidance, repair and lowering checks.
The full suite's Rust stage passed **4,963 tests and 18 doctests**, with
33 existing ignores. The pooled client stage passed **6,187 tests across
311 files**, with 11 existing skips and no failures or cancellations. All
nine fixture wrappers and all **79 serial client-model tests** passed.
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`
finished with **`== 0 failure(s) in 1433 s`**, exit **0**, with no interventions
in the final run. Every build/typecheck, the release guard, docs budget and
wasm budget passed. The full run includes the affected server and device search
suites, word-expansion/cut/disclosure cases, and the ordinary-search browser
oracle. This final run supersedes the interrupted attempt, without counting
that attempt as green.

[Verification record](./verification.json) lists raw local logs, their hashes,
commands and exit statuses. The final full log is `/tmp/ms-full-suite-final.log`;
its stage summaries are retained in [verification.txt](./verification.txt).

Development failures are retained in the local logs: an initial test compile
used a nonexistent `Index::words` helper; the first guide draft lacked the
reference-typed sequence parent and exceeded the unchanged card limit. These
were corrected. Coverage assertions initially overclaimed window completeness,
then failed to distinguish browse from word coverage; the final matrix above
pins the actual outcomes. One Cargo invocation from the repository root failed
before compiling because that unrelated workspace's Ibex submodule is absent;
all subsequent Cargo work stayed inside the Snapback 4 fence.

The first broader search run passed 106 tests and failed two directory witnesses.
Removing a duplicate schema made their “first block with profiles” selector
choose a decoration-only schema lacking `displayName`, `handle` and `people`.
The first full run was stopped through its owned execution session after the
same device witness failed; its exit 130 is not a passing suite. The selectors
now identify the directory by its query as well as its table. No harness case,
assertion, timeout, workload or runtime policy was weakened.

## Wasm

[Measured artifact](./wasm.json), built by the canonical suite's
`scripts/build-wasm.sh`: **2,116,457 B raw / 639,750 B gzip**. SHA-256:
`55cf1691ef6d12b817360f9c002890112122163d696a17eddcd7444f88fd18c1`.
Rust 1.97.0, wasm-bindgen 0.2.127, locked Binaryen 132.0.0.
The unchanged `metrics/wasm-budget.json` cap is **639,887 B**, leaving **137 B**:
the recorded **130 B macOS allowance** plus 7 B. No Mac measurement is claimed.
This matches the existing NL round-10 artifact recorded in JOURNAL; the lane
changes no device code. No ceiling or package version changes.
