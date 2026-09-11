# Snapback 2: enriched capped-page cursor and partial-site parity

Status: Open (narrowed 2026-09-06: the Rust/TypeScript cursor disagreement is resolved — lane L10 made `ClientStore::reexecute` clear `next` on any Partial local replay, matching the TypeScript store, and the L8b two-page test now asserts that; what remains is the uncovered-point site-label mismatch below). Date: 2026-09-05. Scope: core `ClientStore` / TypeScript client coverage and cursor custody. Found during Clique F5-A3 / L8b fix round 1.

The authoritative engine pages the enriched non-uniform share-rule query twice correctly. Both pages are `capped`; page one returns `d1` with owner `Visible`, page two returns `d2` with owner `null`. Decoding their cursors gives only `[1, d1]` and `[2, d2]`, even with an unreadable row before page one. Rust receipt replay preserves those results and cursors with `LocalState::Partial`. The TypeScript client preserves the same results and `capped` query state but clears both cursors to `null`.

This is generic client cursor custody, beyond L8b's certificate shaping rule: `packages/evaluator/src/store.ts:127` clears `execution.next` on *any* uncovered site, while `crates/snapback2-core/src/client.rs:140` marks `Partial` and returns the engine's execution unchanged. It also affects bare pages; it is not the nullable guard or a certificate page-state loss. LLP 1011 §B1 says partial deliveries carry no cursor, while LLP 1001 §3 requires a nonempty authoritative capped page to carry one. Resolve the local coverage/read-state distinction across both runtimes without weakening incomplete-coverage handling. No cursor or twin implementation is changed by L8b.

The same journey reproduces the partial-site naming mismatch: the raw-IR test uses the authored site `profiles.owner`, which TypeScript reports; Rust synthesizes `profiles.byId` for the uncovered key (`client.rs:137`). The existing corpus uses `profiles.byId` and masks that disagreement. Do not rename the test site to hide it.

## Exact reproduction

From `snapback2/` (real Node first on PATH):

```sh
PATH=/opt/homebrew/bin:$PATH NEXTEST_TEST_THREADS=8 cargo nextest run --config-file ../.config/nextest.toml --profile local-proof -p snapback2-core --test completeness -E 'test(enriched_capped_page_cursors_follow_only_returned_rows)' --no-capture > /tmp/enriched-cursor.log 2>&1
bun -e '
import { ClientStore } from "./packages/evaluator/src/evaluator";
import { queryState } from "./packages/evaluator/src/runner";
const lines = (await Bun.file("/tmp/enriched-cursor.log").text()).split("\n").filter(x => x.startsWith("CURSOR_REPLAY "));
if (lines.length !== 2) throw new Error("expected two page packets");
for (const line of lines) {
  const x = JSON.parse(line.slice(14));
  const y = new ClientStore(x.schema, x.receipt).reexecute(x.program, x.context, x.certificate);
  console.log(JSON.stringify({after:x.context.args.c,rust:{state:"capped",result:x.result,next:x.next,localState:x.localState},twin:{state:queryState(x.certificate,y.execution.trace),result:y.execution.result,next:y.execution.next,localState:y.state,partialSites:y.partialSites}}));
}'
```

The permanent Rust test emits the complete, actually-certified replay packets when output capture is disabled; no generated fixtures or new script are needed. Page two receives the authoritative page-one `next`. The test checks both authoritative and Rust-local results, states, and decoded cursor positions. The TypeScript mismatch is intentionally not frozen as passing conformance.

Observed output, verbatim:

```jsonl
{"after":"Null","rust":{"state":"capped","result":{"Array":[{"Row":{"id":{"Id":"d1"},"owner":{"Row":{"name":{"String":"Visible"}}}}}]},"next":"WzEsImRvY3MiLCJieVNjb3BlIiwiQXNjIixbeyJuYW1lIjoib3JkZXIiLCJraW5kIjoiSW50In0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siSW50IjoxfSx7IklkIjoiZDEifV1d","localState":"Partial([\"docs.page\"])"},"twin":{"state":"capped","result":{"Array":[{"Row":{"id":{"Id":"d1"},"owner":{"Row":{"name":{"String":"Visible"}}}}}]},"next":null,"localState":"partial","partialSites":["docs.page"]}}
{"after":{"String":"WzEsImRvY3MiLCJieVNjb3BlIiwiQXNjIixbeyJuYW1lIjoib3JkZXIiLCJraW5kIjoiSW50In0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siSW50IjoxfSx7IklkIjoiZDEifV1d"},"rust":{"state":"capped","result":{"Array":[{"Row":{"id":{"Id":"d2"},"owner":"Null"}}]},"next":"WzEsImRvY3MiLCJieVNjb3BlIiwiQXNjIixbeyJuYW1lIjoib3JkZXIiLCJraW5kIjoiSW50In0seyJuYW1lIjoiaWQiLCJraW5kIjoiSWQifV0sW3siSW50IjoyfSx7IklkIjoiZDIifV1d","localState":"Partial([\"docs.page\", \"profiles.byId\"])"},"twin":{"state":"capped","result":{"Array":[{"Row":{"id":{"Id":"d2"},"owner":"Null"}}]},"next":null,"localState":"partial","partialSites":["docs.page","profiles.owner"]}}
```

## Disposition — 2026-09-11

**Priority:** P2. **State:** keep open at the narrowed site-label boundary.
Current source and the retained command still identify authored
`profiles.owner` versus synthesized `profiles.byId`; this pass did not claim a
fresh Rust→TypeScript JSONL execution. Cursor clearing is resolved and must not
be reopened. Closure is a fresh existing-command run plus permanent
byte-identical corpus assertions keeping the authored site visible on both
pages.

## Remaining resolution criteria

Agree on partial local cursor semantics across Rust and TypeScript, preserve the authoritative two-page journey and hidden-position exclusion, align uncovered-point site reporting, then freeze both page receipts in the existing corpus and assert identical replay. Keep `profiles.owner` in a test so site-name parity cannot be hidden by using `profiles.byId` everywhere. L8b leaves the corpus-size union to integration as requested.

## Resolution — 2026-09-11

**Status:** Closed. Rust `ClientStore::reexecute` now maps an uncovered physical
absence back through every matching absent `PointTrace`, preserving authored
read-site identities such as `profiles.owner`; only synthetic evidence without
an authored point falls back to `table.index`.

The authoritative hidden-before journey still returns the two one-row capped
pages with cursors anchored at `d1` and `d2`, while both local runtimes clear
those cursors. A fresh run of the ticket's Rust-to-TypeScript JSONL command
reported identical results and partial sites on both pages:
`["docs.page"]`, then `["docs.page","profiles.owner"]`.

The existing `conditional-enriched-hidden-page-{1,2}` corpus cases now carry
that same one-row pagination shape, an unreadable row before page one, and the
authored `profiles.owner` site. Permanent evaluator assertions require the
Rust-generated canonical result bytes, ordered partial sites, and null local
cursor to match on both pages. The general corpus comparison also covers their
range-stop, digest, state, and result fields.
