# Integration 23 — 0.4.38 landed; 0.4.39 qualification in progress

Worktree `snapback-sb4loop`, branch `sb4-loop`. No publication worktree or
`target/publication/` is used. This report is lane-local; subsequent merges keep
this integration's report. Final results replace this progress record.

## Landed 0.4.38

Main integration merges: `7b051e5f3f`, `c3f23ff2c2`; standalone PG lock alignment
`2281138019`. Pushed `sb4-loop:main` through `2281138019`, without force.
Both journal histories were retained. Full five-crate Linux run: 452 result
scopes, 7,348 passes, 266 declared ignores, zero failures. Incoming affected
checks: core 653 passes; full CLI repeat 520 passes/9 ignores after the known
stopping-admission flake passed alone; maintained-column Postgres 364 Rust
passes and the unchanged public S1 recount. Affected clients 78/78. Root guide,
inventories, references and docs budget passed. See `step0-summary.json`.

## 0.4.39 implementation

ROLL `cd20d7ebc9` merged as `2fa38c3b21`. Version-only bump `8550d12b65` follows
`bd2ca8da8b`'s ten-file pattern. One coherent guide changes entry explains
registered rollback views, acknowledged hiding and release-store upgrades.
Main's subsequent PG2 measurement/audit work merged as `4df0fc0ce1`, retaining
both journal histories; no engine or client implementation changed in that merge.

Integration fixes preserve current independent intent using the complete authored
current closure, including literal/module/executable-only repairs, with closed
predecessor field/operation/input compatibility. Explicit authored argument
aliases preserve old wire names; independent positions cannot collapse. Typed
identity renames reject captures, scalar reinterpretation and invalid source
spans. Unsupported worker/native bundles and incompatible old contracts require
author-authored compatible guarded source. No policy or conversion is inferred.

Initial audit and eight actual refinement rounds are retained verbatim in
`llp/reviews/3000.000.000-roll-intent-*` with common pinned input hashes and
provenance. Fresh Muse and Codex both returned READY on revision 8. These are
design reviews, not publication qualification. The 18 language bridge cases
pass, as do the eight CLI bridge cases before the alias-only extension.

Incoming request-count checks exposed an unconditional extraction SQL query on
asset-free writes; the integration skips that impossible-child probe without
changing expected counts (522 CLI unit passes, eight extraction/lifetime cases).
Raw schema fixture edits in residency, readauth, timeline adoption and recorded
attribution now rebuild derived receipt/reservation facts. No assertions or
production validation were relaxed. Guide examples retain legacy fields and
explain default versus exact rollback; the card is within its 280-line budget.

## Evidence already completed

Wasm: 2,406,499 B raw / 734,925 B gzip / 553,444 B Brotli. Budget 735,425 B,
exactly measurement +500 B; +37 B gzip versus qualified 0.4.38 for ROLL reference
and lifetime support plus the version stamp. Family and absence audits pass.

Differential campaigns after the native extraction fix: engine 20,000 cases /
1,222,111 executions, devices seeds 0–999 /27,922 executions, Lean 20,000 cases /
56,917 executions. No new mismatch signatures. All 130 Lean mismatches reproduce
on the fresh 0.4.38 base with the same four signature counts (3/35/67/25).

Schema survey: all 450 projects /900 human+JSON variants, zero false refusals.
SEC7 gates 15 projects with 36 retained-role-grant findings; every finding was
individually acknowledged on disposable copies, leaving zero pending findings.
The original app directories were not changed.

Published 0.4.37 store copies: 34/50 histories automatically upgrade to release
format 9 and complete four backward/forward switches with zero hidden v1 rows.
Sixteen conservatively require authored compatible source (missing old fields,
operations/input compatibility or unsupported/capturing identity mappings).
Preview and real refusal preserve their version/release/generation exactly.
This is not a claim that all 50 stores automatically upgraded. Final replay with
the alias extension is pending.

The 50 existing acceptance scripts passed against the fresh .39 client and
production binary, with their script bytes/assertions unchanged. Three copied
support helpers (007/026/029) explicitly select documented session expiry on
clock jumps; their old implicit-expiry assumptions also fail against qualified
0.4.38. Final repeat after the alias extension is pending.

## Outstanding qualification

Full five-crate rerun after the last fixture/alias fix; full 430-file client pool
and clean-tree assertion; fresh packed Ubuntu/Alpine consumer qualification using
a private npm cache; Mac affected targets and platform-sensitive clients; Exact
synced and online fresh apps; final root checks/censuses, evidence and push.
Earlier diagnostic client pools are not green qualification. One retry's copied
binary lacked its matching helper package; the final frozen layout includes it.
Decorated-search and export-retention contention timeouts must pass alone and in
the full repeat. An earlier packed attempt stopped on a shared npm-cache ENOENT.
Exact's fresh clone needed its lockfile regenerated for the three local .39 path
dependencies before its locked build; no Exact product code was changed.
