# GQ round 0 — guide Start here

Date: 2026-10-01. Branch: `sb4-intent/gq-guide-start-here`.
Starting revision: `096a1b78ef9ebceedf936b2293e253e0870c9e03`.

Eight cards now open with a common pattern, one checked example and two or
three named mistakes with repairs, in at most 15 physical lines. `guide start`
and `guide index` print those exact openings in the requested order. The listing
advertises the path. The CLI output is 125 physical lines (124 content lines
plus its final blank line), including titles and separation; the eight blocks
alone total 112. See [the rendered page](guide-start.txt).

The reference remains on each card. No parser, binder, data model, rule,
sync, query, mutation, prediction or SDK implementation changes. Guide rendering
keeps diagnostic detail selection below `## Reference`, so the short mistake
lists do not replace the fuller `why CODE` definitions. Registered codes,
definition/recovery facts, all historical Quarry blocks and all 133 relocated
facts remain covered by the existing tests. The client preserves read states,
write custody, receipts, one-view media, inspection and native-witness guidance.

## Reading measurements

The task attribution comes from the calibration #27 builder's actual
`run-log.md` ([retained lookup lines](cal27-lookups.txt)):

- M1: language, client, personas (line 17).
- M2: feeds and assets (line 25).
- M3: receipts, rules, ephemeral, sequences (line 37); self-equality and
  sync/order corrections at line 38.
- M4/M5: rules for child reactions (line 51), search (line 54), expiry and
  sequence/receipt gaps (line 63), server-only expiring receipt repair (line 69).
- Prediction was explicitly consulted at M6 (line 77), maintains at M8
  (line 81), and sync at M8 (line 108). These support earlier application
  concepts but are not invented M1–M5 lookups.

The mirror contains the log, diary and application source, but not the original
`evidence/guide-*.txt` files. The report therefore reconstructs card output using
**the published `snapback4-linux-x64@0.4.9` binary**, not today's source. Its
npm tarball SHA-1 is `3dc0e8eae37a2b3284b15403b6a7de0184790c48`;
version output is `snapback4 0.4.9`. The retained [published card outputs](cal27-published/)
match the cited large-card counts: language 803, maintains 880, sync 506,
search 401, feeds 402, rules 375. Seventeen named lookup files recoverable from
that log total 5,783 lines, including replay's alias of personas. This does **not**
independently verify the commission's 19-card/5,907-line total, or how much of
each output the builder actually read.

[MEASUREMENTS.md](MEASUREMENTS.md) contains both required tables; raw endpoints,
hashes and numbers are in [measurement.json](measurement.json). Reproduce with
`python3 snapback4/reports/20260930-gq-guide-start-here/measure.py` after building
the CLI. It reads the original commit, the retained 0.4.9 text and the current
CLI; no undocumented memory of the old card is used.

The first table counts physical lines from the card's top through its first
complete example fence (the first **paged-read** example for client), compared
with the entire new Start-here block including mistakes. The sum is 358 lines
on 0.4.9, 354 on this branch before editing, and 112 for the new openings.
This is an orientation-depth comparison, **not an equivalent standalone-code
or full-task effort measurement**. The short prediction example assumes the
default starter; maintains, search and feeds identify the schema in their
complete reference recipe. The client uses the same typed inbox query as the
former paged example. No claim is made that all these independent examples
can be concatenated into a single program.

The second table preserves the actual task's full recipe endpoint. It prevents
crediting a 15-line owner-table overview for completing group authorization,
Following, receipts or all three search scopes. Several reference endpoints
move later because of the added orientation. Receipts are untouched by GQ:
the reduction from 0.4.9 already existed on this branch. M4 media/expiry and M5
receipt-gap work still require their unchanged assets, expire and sequences
cards. There is no new builder run, timing result or data_modeling score claim.

## Budgets and snippet custody

Whole-card ceilings use the rendered card before this change, including all
`include_str` leaves. Each stays fixed; client falls from 114 to 106 lines.
The client retains its 1,200-word ceiling; the older aggregate word-reduction
and exact historical Quarry-block tests pass unchanged.

Space comes from replacing repeated feature introductions, keeping placement
advice once at the top of language, moving the duplicate client paging example
into its opening, and joining existing wrapped prose without deleting its
facts. The redundant per-row member-count example is removed; its `useQuery`
pattern still appears in the composer and the 1,000-row cost explanation stays.
No documented behavior or refusal recovery contract is removed.

Default-starter-derived owner tables compile standalone; prediction's mutation
is checked against the actual default template. Three contextual excerpts must
appear verbatim in a complete reference block, which the existing compiler and
note checks execute. Global's existing `N_SPARSE_FILTER` exception remains tied
to the full exact recipe and its one note. The client opening is checked by the
existing TypeScript example suite. `guide start` uses the card text itself;
there is no second authored snippet or second diagnostic registry.

## Verification and failures

Baseline whole guide: **107 passed, zero failures**. Final whole guide:
**109 passed, zero failures**. This includes the Snapback 4 emitted-diagnostic
registry, definition/recovery census, all historical Quarry blocks and all 133
moved facts. The two added tests enforce opening length, registered mistakes,
identical ordered aggregation and unchanged whole-card line ceilings.

Ran `snapback4/scripts/test.sh` exactly once, with all 2,329 captured source
inputs held unchanged throughout the run. Exit 1; exact summary:

```text
== 1 failure(s) in 1441 s
```

The failed stage was `cargo test`: **16 cases, all ours**, in 13 scheduled
Rust executions. New contextual examples exposed assumptions that every
fragment uses the language schema, or that the full reference remains the
first/second block. Discovery tests also expected the original listing prefix.
All are fixed: the test corpora share explicit compilation context, runtime
witnesses select their unchanged named programs, and discovery preserves its
original prefix. The read-authorization census has only shifted block labels
and ten repeated existing template entries, with no new private-write behavior.

Final affected verification passed **411 tests**, with four pre-existing ignored
aggregate tests and zero failures. The whole-guide result is included once in
that total; its final warning-free rerun also passed 109/109.

| Final affected scope | Passed | Evidence |
| --- | ---: | --- |
| Whole guide | 109 | [guide-verified-final.log](guide-verified-final.log) |
| Language aggregate copies / effect reads / residency / server opt-in | 64 / 8 / 41 / 7 | [guide-and-affected-final.log](guide-and-affected-final.log) |
| Core lane-source corpus | 10 | [core-affected-final.log](core-affected-final.log) |
| Device guide examples / effect reads / read-authorization census | 2 / 4 / 81 | [guide](device-guide-final.log), [effects](device-presence-final.log), [census](device-census-final.log) |
| Simulation search-directory witness | 1 | [sim-search-final.log](sim-search-final.log) |
| CLI check, guide listing and aliases | 84 | [cli-check-final.log](cli-check-final.log) |

The full run passed all other stages: wasm (1,994,357 raw / 598,401 gzip bytes,
unchanged budget), documentation budgets, release guard, package build/typecheck,
application checks, nine fixture-wrapper tests, **5,726 client tests** (ten
existing skips, zero failures/cancellations), and **79 client model tests**.
The client tests include the guide's TypeScript examples. The single full-suite
log is retained as a failed run; it was not rerun after the targeted repairs.

`node scripts/generate-diagnostics-registry.mjs --check` exits 1 with **baseline**
stale Snapback 1 projections. `node scripts/check-inventories.mjs` exits 1 with
**baseline** script inventory, authoring-profile, size-budget and registry drift,
and **environmental** missing ignored generated demo files. No GQ source is in
the root registry/manifest's input set, and those authorities are unchanged from
the starting commit. No indexed source moved, so these unrelated projections
were not regenerated. The Snapback 4 registry checks pass in the guide suite.

Every failure from every run is named and attributed in
[FAILURES.md](FAILURES.md), including the full-suite failures and exact root
check findings. All logs and exit statuses are retained. `./ref-check --verbose`
and source/documentation whitespace checks pass (raw terminal transcripts keep
their original whitespace). No failing assertion, historical example hash,
moved-fact inventory or budget was relaxed to obtain the final affected passes.

## Governing context and audit

Read-only `llp-orient` scoped the guide before editing. Relevant constraints:
[LLP 3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing) and Snapback 4's
NOT-DOING fence; [LLP 3000.007 §20.19](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#2019-wave-10-one-way-in-and-a-diagnostic-that-carries-its-own-explanation)
for one orientation and tested references; [LLP 3000.011.000.000 §2–3](../../../llp/3000.011.000.000-contextual-compiler-guidance.rfc.md#2-proposed-behavior)
for concise, verified advice and no silent policy changes; existing sync
annotations still refer to LLP 3000.021 §3.1. LLP 3000 and 3000.007 remain in
`llp/current`; the implemented guidance RFC is archived. No new LLP is created.

The card structure is recorded in the guidance RFC's new §8, with the measurement
limits. The journal receives one append-only entry. No subagents, pushes,
publication, budget increases, new product diagnostics or additional gate scripts.
