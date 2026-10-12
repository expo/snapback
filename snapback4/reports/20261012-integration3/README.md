# Integration 3 — sb4-ws-union into sb4-loop

Completed in `/home/ccheever/projects/snapback-sb4loop`, branch `sb4-loop`.
Started clean at `2dfb1e43d0`; no unfinished predecessor commits. No push,
publication, other-worktree edits, or full `scripts/test.sh`.

| Item | Change / commits | Qualification | Deferrals |
|---|---|---|---|
| No-ff merge | `f5a482a4a9`, parents `2dfb1e43d0` and UNION `2ceec324ad`. Preserve OPS, LANG2, merged pages, referential actions, W8C persona journals, both journal histories and LLP records. | Setup CLI/wasm/client builds, all requested Rust/client checks; version stays 0.4.23. | Union content/membership/ancestors remain non-expiring and horizon-free; windows and expiry are deliberately refused. |
| Union action reservations | `02c1ad67e5`: price retained row events by maximum schema arm count, including coincident recipients; set-null checks every serialized arm/horizon. | New four-arm price, recomputed projection parity, parent delete-heap scaling and later-arm eligibility regressions pass. Sol READY; Muse READY WITH CHANGES, recommendations addressed. | Optional union principal references are ineligible, so the defensive set-null regression uses a hand-built schema rather than a meaningless compiler failure before eligibility. |
| Cascade retirement | `02c1ad67e5`: both device stores retire union rows and cascaded membership scopes; preserve surviving board rows; disclose no private child/member id or scope to a stranger. Split the long union test into modules below 1,500 lines. | Whole union suite: 29 passed, 2 declared ignores. Exhaustive two-write worlds, page sizes 1/1,000 and real memory/SQLite stores. All 22 reference-action tests pass. | None. |
| Single-audience scopes | `61c72303f2`: restore existing single-column/read-through and public departure scopes alongside union group scopes; retain key-width and malformed-schema checks. | Both-store retention/hardening regressions pass. All six initially failing device targets rerun in full: 609 passed. | None. |
| Expired predecessor revocation | `851e15425f`: catch-up keeps predecessor-only joins in the current epoch and preserves their recorded expiry when no current row or later transition survives. Remove the refusal fixture's window to isolate delivered-history. | All 30 review regressions pass; strengthened test proves actual stored-row removal on both stores at limits 1/1,000 and rejects transient ids/rebound scopes. Eight core row/renewal tests pass. Updated union/epoch, review-correction and security suites pass. Fresh Sol and Muse both READY. | None. |
| Persona journal / merged pages | Preserved through the merge; synced unions use their per-arm device scans while online merged pages keep their planning. Persona custody stays with W8C. | All regular client files and both full-count models qualified, including persona/browser journal and branch-completeness coverage. | None. |
| Lean example count | Actual `(cd snapback4/lean && ./check.sh)`. | **53/53 examples**, 54 audited theorems using standard axioms only, 7 oracle fixtures. | Existing Lean OPEN C2/W4 differences only. |
| Censuses | Regenerate readauth from emitted sorted `CENSUS_ITEM` records; regenerate delivery-await via `awaitBoundary()`. | Both byte-identical. Readauth: 718 entries, 409 mutation occurrences, 89 private write sites. Codec census passes with the complete client suite; no exceptions added. | None. |
| Guide budgets | Union recipes replace obsolete audience workarounds; describe full replicas, not unsupported windows. Both cards retain their examples. | README 319/320 lines; recipes 358 source / 359 printed lines within 400; sharing overview 95/150 printed lines (658 with `--full`). All 119 guide tests and `node scripts/docs-budget.mjs` pass. | None. |
| Wasm budget | `f5a482a4a9` provisional, superseded by `61c72303f2`: final **2,245,239 B raw / 679,647 B gzip**, cap **680,147 B**, exactly measurement + 500 B. +3,357 B gzip versus Integration 2. Reasons recorded in budget, commits and append-only journal. | Locked Binaryen 132.0.0 builds repeat the final measurement; strict budget check passes. Latest client and CLI builds and client typecheck pass. | No Mac measurement, per-feature attribution, or interpreter resource ceiling change. |
| Rust full integration | Exact requested five-crate `cargo test ... --no-fail-fast`. | 359 initial targets: 5,622 passed, 22 failed, 40 declared ignores, exit 101. All seven failed targets have passing complete reruns (639 tests); four newly added tests pass. **Qualified aggregate: 5,648 passed, zero failed, 40 declared ignores.** The initial command is not called green. | None in affected product tests. |
| All client tests | All 366 regular files, then the two full-count model files in a serial slot. | Initial regular run: 7,131 passed, 19 failed, 56 skips. Complete corrective reruns qualify **7,150 regular passes**; models add **81 passes**, including 5,000 session sequences per tier and 3,000 online sequences. Total **7,231 passed, zero failed, 56 declared skips**. After the final server repair, acquisition/horizon/expiry files also rerun green: 143 tests. | One load-sensitive export maintenance timeout passed a single unchanged full-file rerun; see below. |
| Difftest `run` | Final rebuilt source, seed 0, 20,000 cases, 8 workers. | 20,000 compiled, **1,009,341 executions**, zero disagreements, generator errors or unexpected refusals; 86.05 s, exit 0. | None. |
| Difftest `run-devices` | Final rebuilt source, seeds 0–999, 8 workers. | 1,000 compiled, 27,902 executions; 26 disagreements in the same **16 inherited signatures**, no new signatures; 27.54 s, exit 1. | Existing 2026-10-08 unswept-expiry meter and unproved-prediction refusal tickets. Every signature was checked against those ticket records. |
| Difftest `run-lean` | Final rebuilt source, seed 0, 20,000 cases, 8 workers. | 15,245 agree, 4,557 unsupported, 198 disagreements in exactly the same **four inherited C2/W4 signatures**; no new signatures, generator errors or unexpected refusals; 23.09 s, exit 1. | Existing OPEN C2/W4 only. |
| References / delivery | `./ref-check`, local commits under Charlie Cheever's requested identity. | Zero reference/metadata errors or unchecked refs; source diff checks pass. Evidence is committed in a separate qualification commit. | No push or publication. |

The initial export-background test failed after 99.42 s on the coalesced
maintenance queue wait under load. Its single unchanged complete-file rerun
passes (70 passed, 34 declared skips). Per the commission, this is a
load-sensitive timeout and not an outstanding failure.

Two harness interruptions are recorded separately: the first client runner
invocation passed a directory and ran no real client test, then was corrected
to the explicit file list; the one-shot race file overlapped replacement of
the wasm artifact (ENOENT), and its stable-artifact complete rerun passes.
Neither is described as a product timeout or a waived test.

Inherited difftest findings remain explicit rather than being reported as
passing. Their tickets are `issues/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md`
and `issues/20261008-snapback4-device-refusal-after-an-unproved-prediction-differs-from-the-server.md`;
Lean's four signatures remain within OPEN C2/W4. No implementation work is
deferred from this integration.

Evidence: `snapback4/reports/20261012-integration3/quality-summary.json`,
complete compressed logs, final campaign reports and minimized cases.
Verbatim independent reviews/provenance are in `llp/reviews/3000.039-integration3-union-events.*`
and `llp/reviews/3000.036.000.000-integration3-expired-revocation.*`.
