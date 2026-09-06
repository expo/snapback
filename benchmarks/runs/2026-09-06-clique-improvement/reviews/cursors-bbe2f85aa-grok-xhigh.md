I'll start with the review skill and the snapshot's change.patch, then read the source, tests, and LLPs that actually govern the cursors commit.The snapshot is read-only; I’ll load the grok brief, the patch, and the governing LLPs next, and skip the other reviewer artifacts.I’ll map the patch and the LLP cursor/page-provenance sections, then read the final compiler, engine, and twin code those claims rest on.The load-bearing files are the certifier page map, engine/twin cursor validation, and the compiler provenance removal — I’ll read those next and extract the corresponding diffs.I’ll pull the key hunks out of the patch and read the remaining engine, twin, and certifier edges those hunks actually change.I have enough of the certifier, engine, and twin paths to judge the requested invariants. Checking one last merge/scan interleaving hole, then I’ll give READY or CHANGES_REQUIRED.**READY**

I reviewed the final code in this snapshot (commit `bbe2f85aa` vs `3ea1ef946`), including `change.patch`, LLP 1001 §3, LLP 1011 §B1, the certifier in `certificate/page.rs`, engine scan/merge/mint, the twin runner, compiler provenance removal, and the conditional/auxiliary corpus programs. I did not run tests, did not touch the tree, and did not read other reviewer files. Compiler400 / evaluator216 / package380 and the partial Rust story are taken only as the prompt’s report.

The certifier now owns return-path page maps; the compiler no longer declares `result_page_site`. Engine and twin mint from the executed return path, validate opaque tokens on the selected scan/merge before that page or its lane discovery opens, and ignore unselected arms.

## What the final code does

**Certified return-path provenance.** `result_pages()` walks IR, records `Origin::Page` only for `opaque_cursor` scans/merges, and keys the certificate by the same `{index}/then/` `{index}/else/` strings the engine and twin stamp on `Return` (`certificate/page.rs:83–108`, `runner.rs:176–184,339–342`, `evaluator/src/runner.ts:113–185`). Nested objects, empty arrays, and consumed non-page returns do not get a map entry, so `next` stays null.

**Alias and one-to-one shape flow.** Bindings copy origin; `Push` kills it. A loop transports a page only if the collector starts empty, there is exactly one top-level `Push`, and there is no `Break`/`Continue`/`Return` (`page.rs:52–78,129–158`). That matches `return alias { body }` and the enriched collector that does a nullable point read, then one outer `Push` (`completeness.rs:711–756`). Filter-style `Push` inside `If` does not qualify.

**Auxiliary isolation.** Mint uses `result_pages[path]`, not the last range/merge in the trace (`execution_record.rs:44–50`, `runner.ts:1111–1116`). The auxiliary corpus program inserts `feed.auxiliary` (take 1) before the shape loop and keeps the then-return at `1/then/5` pointing at `feed.global`, not the auxiliary site (`conditional-auxiliary-page-is-not-result.json`).

**Branch-scoped checks before data reads.** Canonical decode still happens in `validate_inputs` / `validateInputs`. Scope checks moved onto the executed scan: `validate_scan_cursor` is the first action in `evaluate_scan` (`scan.rs:18–60`) and, for merge, runs on every static lane **before** `scan_tracked(source)` (`merge.rs:34–42`). Twin matches (`runner.ts:514–515,582–586`). Unselected arms never run, so they never constrain the token.

**Absent page paths.** `return []` is `Origin::Empty`, so that path is missing from `result_pages`. `next_cursor` / `mintNext` then return null even if `c` is a well-formed token from another arm.

**Loops.** Loops are not return-path carriers. Only a proved collector can take a page out. Runtime may still set `result_page_return` to `{for}/body/...`; that key is absent from the map, so minting stays off.

**Compatible reuse / incompatible refusal.** Tokens are table/index/order/suffix, not site (`cursor.rs:93–108`). Same index and suffix can be reused across operations. Range `byAt` vs merge `byAuthorAt` fails `decode_cursor_for` as `E_INPUT` on the selected arm, including empty merge discovery, because lane scans are checked before source rows are opened.

**Unexecuted merge.** `query_state` / `queryCapped` treat a missing merge trace as *not* an over-long union (`execution_record.rs:19–24`, `runner.ts:1138–1141`). That is the “unexecuted merge is not an unfinished union” rule.

**Engine/twin mint.** Non-merge: last returned row of the certified site. Merge: `last_returned_suffix` only if that merge is a certified result page. Local `Partial` clears `next` in `ClientStore.reexecute` (`store.ts:126–127`), not in raw `Runner.execute` (tested as intentional).

**Compiler metadata removal.** `attachResultPageSite` is gone; forging `program.result_page_site` is ignored (`merge.rs:645–652`). Provenance is certifier-derived.

## Optional coverage (not CHANGES_REQUIRED)

- **Returns inside a `for` body** are not entered by `origins` (`page.rs:129–158`). Runtime would stamp `{n}/body/{i}`; mint is null. Conservative miss, not a wrong cursor. Quarry shape loops do not return inside the loop.
- **Join-after-`if` with two different page sites** drops the binding (`page.rs:119–123`). Quarry’s conditional feed returns *inside* each arm (`1/then/4` and `1/else/4`), which is the supported form.
- **Query-level `Capped` still follows any `Limit` range**, including an auxiliary. An exhausted result page plus a tiny auxiliary scan can still mint `next` pointing after the last result row (page two empty). That is the old query-state rule; this change stops the auxiliary from *being* the mint site. A tighter rule would gate mint on the result site’s own stop reason.
- **Same-site clone of a page as auxiliary** is refused (`repeated_page_site_cannot_select_an_auxiliary_scan_or_merge`, unique-root check at `page.rs:308–309`). Distinct sites, which lowering emits, are the working case.
- **Dedicated two-operation share test** is implied by `decode_cursor_for`, not a separate corpus case.
- **No single consolidated green Rust run** in this snapshot; I did not fabricate one.

I did not find a wrong-cursor, wrong-scope-accept, or engine/twin mint disagreement in the executed return-path, alias/shape, auxiliary, absent-path, loop-collector, or before-discovery validation code.
