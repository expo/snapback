# RX round 2 — compaction beyond live blockers and hygienic receipt mappings

Date: 2026-09-30. Branch: `sb4-intent/rx-declarative-receipts`.
Round one: `be75e9b25d`. Merged `origin/main`
`9d03e946232b4017564f3e7c6aa87bd424ce8d58` first in
`85dc73c0e7af70a97babeb1dabeb8fb19c2b50df`. The only conflict was the
append-only journal; both histories were retained. Nothing pushed or published.
Read both previous prompts/reports and both review pairs in full.

## Changes

1. **Compaction continues after a live blocker.** The compiler's ordinary Quarry
   fold sorts the new interval among at most 64 held intervals. It advances the
   prefix or current run through covered/absent positions, then starts from the
   next held interval when a live blocker ends that component. One shared
   1,024-position probe allowance covers the entire call. Maintenance persists
   partial run endpoints, as well as prefix progress, and returns `true` for
   either. The SDK's existing maintenance retry consumes this boolean without
   an SDK change. Stored starts retain their ids; changed endpoints update,
   absorbed runs delete, and only the input can introduce a new start. The
   64-run check applies to the normalized result. All reads, list/expression
   work, updates, deletes, inserts and effects use the ordinary interpreter and
   its unchanged meters. No native receipt algorithm or new state is added.
2. **Generated identifiers are fresh.** Internal locals avoid public arguments
   and authored/generated globals. The public scope spelling is preserved when
   usable as an expression; otherwise a fresh `receiptScope` is used. Public
   range/cursor names retain `from`, `through`, `c` when available and gain a
   numeric suffix on collision. The compiled binding/generated API expose the
   actual names. A scope named `principal`, `fromOrdinal`, or `throughOrdinal`
   uses `receiptScope` inside the runs table, recorded in the existing descriptor.
   Unsupported generated declarations and an `id` watermark refuse at the
   author's receipts clause with `E_RECEIPTS_CLAUSE`.
3. **All six public names enter the semantic fingerprint.** Projection, delivery,
   seen, member query, progress query, and compact are module-qualified hash
   inputs. Each has an independent rename test. The existing v2 template digest
   also changes with this repair, fencing earlier SDK debt for recollection.
4. **Compact requires its family's fingerprint.** Omission and mismatch both
   refuse `E_DELIVERY_BINDING` in schema admission and engine execution. Manual
   delivery's optional fingerprint behavior and recorded-id replay precedence
   remain. Existing direct maintenance tests now supply the fingerprint.
5. **Both scratch witnesses are in-tree.** The precise live-blocker/seen/deleted
   hole label trace and partial-acquisition leave regression now run in the
   receipt suite. The leave case runs on memory and SQLite devices, checking
   the queued, unpredicted write, intact member and retained run after all pages.

Automatic ordinal allocation, send-time recipient counts and join floors remain
for the next round. The known conservative conjunction proof and positional
operation mapping syntax are unchanged. Raw-IR admission, arbitrary migration,
and large-backlog latency qualification remain outside this prototype.

## Behavioral and causal evidence

- The 1–131 reproduction passes with wholly deleted gaps and mixed expired/
  deleted gaps. With position 1 live, compact retains prefix 0 and merges the
  runs to `[2,130]`; reporting 131 produces `[2,131]`. Reporting 131 directly
  also succeeds before the cap is enforced. Position 1 remains `sent`, position
  131 is `delivered`, and subsequently reporting 1 yields prefix 131 and no runs.
  Repeating the covered report produces no events.
- A write ceiling of ten forces failure after some normalization writes and
  rolls back the run image and prefix. The unchanged default permits it.
  An application update of runs still refuses `E_RECEIPTS_OWNED` despite the
  generated operation's new endpoint updates; an outsider cannot compact.
- A 9,000-position expired hole after a live blocker, with 64 runs, persists
  endpoint progress through maintenance and eventually records the owed report.
  Prefix remains zero. The first maintenance call extends `[2,2]` to `[2,1025]`:
  one live-blocker probe plus 1,023 absent probes, within the same 1,024 budget.
  Long-gap maintenance uses 1,091 examined rows, 1,029 rule probes, 61,009 steps,
  272,739 heap bytes and one written row. The short mixed/deleted reproduction
  uses at most 134 examined rows, 189 index entries and 64 written rows. All
  measured dimensions are below their unchanged default ceilings.
- The generated mapping test runs **510 cases**: ten field roles × 51 names.
  It covers scope, membership identity, message coordinates, accounting and
  watermarks; lower/upper case, leading/interior underscores, digit suffixes,
  contextual words, both Quarry hyphenated words, all reported collisions,
  internal-prefix collisions and the runs storage names. All six public
  operations are exercised, including actual sent/read labels and run storage.
  `insert`, `update`, `delete`, and `after` are not legal ordinary column
  declarations in Quarry and are excluded from that success generator; `id`
  as a generated watermark has a separate clause-diagnostic regression.
- The original differential schedules, saturation, service removal, device
  adoption/replay, and 49-recipient guide assertions are retained. Exact physical
  state equivalence remains scoped to contiguous live histories; expired/deleted
  histories compare live coverage, with targeted exact prefix/run assertions.

The final harness was executed against the unchanged three round-one product
files in this same lane, with byte-for-byte restoration afterward. Source hashes,
commands, exits and restoration are in `round1-controls.json`; full outputs are
`round1-final-round2-controls.log.gz` and `round1-final-names-controls.log.gz`.
The first set is **3 passed / 5 failed**: compaction merge, pre-cap delivery,
long-gap progress, rollback requiring actual writes, and missing fingerprint
fail. Grok's two witnesses and the ownership update check pass on round one.
The second is **3 passed / 5 failed**: the three omitted-name hashes, mapping
case generator (**34 of 510 cases refuse on round one**), and clause-local `id`
refusal fail. Delivery/seen/compact rename fingerprints already pass on round
one. These are intentional controls, not unresolved product failures.

## Verification

Final affected results: **37/37** receipts, **16/16** delivery, **105/105** whole
guide, **30/30** device delivery, **81/81** readauth. Documentation budget passes;
primary receipt guide remains **321/350 lines**, starter **231 lines** versus
294 handwritten (63 fewer). Existing behavior assertions were not relaxed.
Only compact test callers gained the newly required fingerprint.

Ran `bash scripts/test.sh` **exactly once**, exit **1**. Full output is in
[`suite.log.gz`](./suite.log.gz); its exact final summary is:

```text
== 1 failure(s) in 1355 s
   client tests
```

Completed inventories:
**4,400 Rust passes / 0 failures / 33 existing ignores**, **5,314 client passes /
1 failure / 10 existing skips**, **79/79 serial model tests** (including both
full 5,000-sequence walks), and **9/9 fixture wrappers**. The whole guide, build,
wasm, release guard, documentation checks and all typechecks pass.

Every full-run failure:

| Failure | Attribution | Resolution |
| --- | --- | --- |
| `declarative full runs compact a long deleted hole through the real SDK` in `delivery-integrated.test.mjs`: `AssertionError: timed out: bound compaction` | **Ours — test fixture** | Its setup used absent gaps, so the repaired fold merged the runs before the expected saturation. Added live blockers, asserted 64 stored runs, removed only the leading blockers to force maintenance, then removed later blockers for final normalization. All existing maintenance/retry/fingerprint/coverage assertions remain. The corrected complete integration file passes **4/4** (`integrated-final.log.gz`). |
| Aggregate `client tests` | **Ours; same failure above** | No other client test failed. |

Baseline failures: **0**. Environmental failures: **0**. Product source was final
before the full run. Only that test fixture changed after its recorded failure;
the affected file was rerun, and the full suite was **not** rerun. No test counts,
ceilings, skips, assertions or timeouts were reduced. The inherited nominal
60-second suite bar remains exceeded. `ref-check --verbose` passes: 525 LLP
documents, 9,995 references, zero errors or unchecked references.

## Wasm

The full-suite canonical build measures **1,988,204 B raw / 596,444 B gzip** on
Rust 1.97.0, wasm-bindgen 0.2.127 and locked Binaryen 132. This is **803 B below**
the unchanged **597,247 B** ratchet and equals round one's recorded byte counts.
The compiler/template edits add no device code; the required-fingerprint check
is SQLite/server gated. No budget increase or runtime ceiling change.
Source and artifact SHA-256 hashes are in `source-artifact-sha256.json`.

## Development failures and corrections

All failures here are ours; raw attempt logs are retained compressed. They are
separate from the intentional round-one controls and the full-suite ledger.

- Two editing/build commands used repository-root paths from the Snapback 4
  working directory; the first could not create `names.rs` and its harness build
  failed on the missing file. The later formatting/edit command likewise did not
  apply, so that check reran the uncorrected harness. Corrected paths; no product
  behavior conclusion was drawn from these command errors.
- The first generator used a positional two-column scan against the runs'
  three-column unique key; binding refused it. A temporary `where` rewrite
  compiled but lost the indexed endpoint seek, causing the unchanged guide's
  49-recipient page to be incomplete. Restored the original named-key seek.
- The first normalization attempted insertion from a synthesized list, and
  Quarry's structural fanout proof refused it. Reconciliation now visits the
  original complete run page, preserves surviving rows and inserts at most the
  input's single new start. No admission rule was weakened.
- The first generated-name corpus included four words that ordinary table
  declarations reserve for clauses. Restricted success cases to legal columns.
  A negative test also incorrectly expected watermark names inserted directly
  into the AST to be refused; they are valid there. Its final negative case is
  `id`, and it checks the actual receipts line (17), without a dependent authored
  query that would add an expected unknown-function cascade.
- Guide definition checking caught an earlier mention of `E_DELIVERY_BINDING`
  before its pinned defining paragraph. Kept the definition/action together and
  added omission to that paragraph. Whole-guide assertions are unchanged.
- `rustfmt` traversed the shared test module and reformatted an unrelated device
  helper. Restored that file; subsequent formatting uses `skip_children`.

## Governing context

Scoped `llp-orient` used the existing skill at
`/home/ccheever/lanes/q03r4/vendor/llp/skills/llp-orient/SKILL.md`; the local skill
symlink is uninitialized. LLP 3000's fence/one interpreter, LLP 3000.022 §§2–6
(coverage, binding identity and replay) and §14 (receipt family authority, mapping
and bounds), LLP 3000.015 §2 (authorization/meter limits), and LLP 3000.025
(expiring reads) govern the repair. Current authoring facts came from the receipts,
sequences and language guide cards. §14 was updated in place. No new LLP or gate.
Handoff: round three's allocation/count/floor work, as commissioned separately.
