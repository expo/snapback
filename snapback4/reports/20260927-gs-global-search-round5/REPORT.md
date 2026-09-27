# Lane GS round 5 — final-copy refusal and public-witness admission

Local branch `sb4-intent/gs-global-search`. Read rounds 0–4's prompts, reports,
journal entries, LLP 3000.024 and its Decision, and both complete round-4 reviews.
Fetched and merged origin/main first as `6b277bf5c`. Both journal parents survive
verbatim as ordered subsequences. The code conflicts combine GS's compact search
with main's LLP 3000.027 cursorless completion; the guide preserves both contracts.
No push or publication. All local commits carry the requested co-author trailer.
The merge retains `engine/read.rs`'s compact `prepaid_head` alongside main's
`stop_at_bound`; `engine/word_merge.rs` keeps GS's extracted page-finishing
helper with main's cursorless completion, removing its obsolete `has_more`
parameter and updating the membership-search call. `guide/search_all.md`
retains main's expanded device-coverage description. Both complete journal
appends are preserved.

## Changes by file

Paths below are relative to snapback4 except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/engine/pages.rs` | Tracks compact sites/counts in the existing return plan without cloning IR or payloads. Its existing binding/alias analysis supplies the page origin at return. Each executed compact merge records its own visible membership count. |
| `engine/membership_search.rs` | Records that execution's count in the return plan; retains the existing compact-page refusal boundary. The merge resolution also adopts main's cursorless-completion behavior. |
| `engine/runner.rs` | Converts a heap failure while evaluating a compact page's return to E_SEARCH_OPEN, including the generated binding's final array copy. The copy charge stays intact. Holds the caller ceiling and public reservations across protected scopes. |
| `engine/authorized_scan.rs` | Removes schema-wide default scratch. Nested protected scopes save/share caller admission separately from private internal work, restore all existing meter/authorization state, and preserve public heap refusal. Shared non-generic entry/exit helpers avoid duplicating this code for each closure. |
| `engine/witness.rs` | Checks actual public materialization against that saved caller budget before `into_value`; keeps its charge in the live witness's scope. Adds nested-scope, allocation-before-refusal and private-work isolation tests. |
| `crates/snapback4-core/src/value/disclosed.rs` | Removes `witness_default_reservation`. Decides visibility/defaults before moving the row and inserting, so a uniquely owned stored map is not deep-copied. Tests pointer identity and measured allocations with both a literal default and an omitted optional. |
| `crates/snapback4-core/src/value.rs` | Adds exact pricing assertions for owned nested arrays and strings/ids with spare capacity; production formulas are unchanged. |
| `crates/snapback4-core/src/search_plan.rs`, `crates/snapback4-lang/src/bind/mod.rs` | Moves the existing merge walker into the server-only shared module; the binder re-exports the same helper. Runtime provenance and diagnostics reuse it. |
| `crates/snapback4-sim/tests/membership_search/edges.rs` | Byte-by-byte admission/delivery sweeps, both reviewer return-copy reproductions, exact retained default heap, stored-versus-missing public defaults, large stored witness fields, and the 200,000-byte ceiling. |
| `../llp/3000.024-global-search-beyond-one-read.rfc.md` | Updates the existing Decision with these charge lifetimes and delivery boundaries. |
| `JOURNAL.md`, this report and qualification artifacts | Append-only results, exact suite outcome and reproducible evidence. |

## Governing context and scope

`llp-orient` scope is compact server search, disclosure/materialization and
protected authorization accounting. LLP 3000 is the fenced root; LLP 3000.024
(in current/) supplies the accepted Decision and §§3–4's one-read boundary.
LLP 3000.015 §§1–2 governs disclosure and private accounting; LLP 3000.007.000
§3 retains drain continuations. Main's LLP 3000.027 §§1–2 governs cursorless
completion in the merge conflicts. The search guide remains the authoring
contract. No design handoff or new LLP is needed.

No multi-request continuation, retained search session, new syntax, changed
cursor format, meter increase, authorization relaxation or wasm-budget change.
No original calibration database was opened or modified, and no tool was
installed on a shared path. Device search keeps its existing evaluator.

The saved caller ledger tracks only the caller's admitted heap and public
materialization reservations. Private internal charges do not enter it. Public
witness reservations remain until the enclosing restoring scope ends; a direct
public lookup retains its charge. Expiring/private/inherited admission stays
unchanged. Deciding default visibility before moving the row preserves the
original owner/default semantics, including omitted private fields.

## Reproductions and tests

- `final_result_copy_preserves_the_compact_refusal` visits every ceiling from
  3,025,040 through 3,025,073. The 32-byte interval formerly returning null now
  refuses E_SEARCH_OPEN; 3,025,073 completes. The 1,900,000-byte stored-payload
  fixture also refuses explicitly at 17,125,185, with its charge preserved.
- `delivery_sweep` derives the cursor/page, result, generated binding and final
  copy boundaries from the completed fixture's retained charges, then visits
  every byte across each boundary. It includes an adopted-default page, the
  stored-payload reproduction and a two-hit page with a real continuation.
  The tiny/wide-witness fixtures also locate their active transient-admission
  threshold and sweep every byte around it; no 512/1,024-byte gaps remain.
  Complete pages must keep the same next token as the ample-heap control.
  These delivery-only sweeps use a 16 MiB fixture output allowance so the
  multi-megabyte pages can reach delivery; the assigned 17,125,185-byte refusal
  still runs with the default output limit. Production output stays 1 MiB.
- `stored_public_witness_field_does_not_reserve_its_unused_default` stores
  `rooms.note = 'hi'` under an adopted million-byte default and completes at
  64 KiB. Its small schema keeps unrelated search scratch below that ceiling.
- `public_witness_materialization_uses_actual_stored_fields_and_active_ceiling`
  stores a 1,500,000-byte title and omits note: a million-byte literal default
  refuses at 1,200,000 bytes; an omitted optional without a literal default
  refuses at 64 KiB. Both use the actual materialization price.
- `public_witness_default_must_fit_before_materialization` now also refuses at
  200,000 bytes, catching the surviving constant-80,000 reservation mutation.
- `adopted_default_prepay_is_replaced_by_the_retained_row_charge` asserts exact
  retained heap: compact **3,025,073 B**, control **3,034,639 B**, and equal rows.
  Keeping even 500,000 bytes of the released prepay fails this assertion.
- Core tests assert nested owned-list clone and retained prices independently,
  and distinguish tight string/id copy length from 256-byte retained capacity.
  A direct materialization test proves the 1.5 MB title keeps its pointer while
  defaults are inserted and measures allocation below the title-copy size.
  Nested protected lookups reject before copying at 64 KiB and 200,000 bytes,
  restore their caller state, and behave identically with 0 or 10 MB of private
  internal charges at an ample public budget.

No existing assertion, timeout or seed count was weakened, and no production
resource ceiling changed. The delivery-only fixture allowance is described above.
Existing round-3/4 regressions, exact visible counts, noninterference, ordering,
revocation and examined/index/probe drain continuation remain covered.

## Runnable forms

Existing syntax still compiles and runs; no new authoring form is introduced:

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.room, viewer] last 2 by .at after c
```

The public-witness fixture uses `messages.read <- exists rooms[.room]`,
`rooms.read <- allow`, and the same membership search without tombstone:

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.room, viewer] last 2 by .at after c
```

Adopting `note: text <=1000000 default '<one million n characters>'` on rooms
preserves an existing `note: 'hi'`; an omitted note must fit materialization.
The grouped repair and three-hit preview remain the previously qualified
forms; this round changes neither their rendering nor their semantics.

## Qualification

Implementation is `5cf51bed3`. All ten affected checks pass: core **153 passed,
one existing ignored**; membership **24/24**; certificate **7/7**; shared server
search **17/17**; full device **436 passed, one existing ignored**, including
all 50 shared search fixtures; authorization/census **81/81**; merge **11/11**;
whole guide **86/86**; docs budget and wasm build. Reference audit: **519 LLP
files, 9,656 references, zero errors and zero unchecked**. Whitespace and the
1,500-line source limit pass.

Nine focused negative controls fail at assertions, not compilation: final-copy
conversion, result charge, unused default reservation, saved caller ceiling,
constant-80,000 materialization price, cloning the owned row, leaving 500,000
bytes of prepay, omitted recursive array copy pricing, and lost string capacity.
Each mutation restores its source byte-for-byte. The final-copy control was
rerun after removing unnecessary IR copies from the provenance implementation;
the result-charge control predates that cleanup but mutates the unchanged
charge expression. `controls.json` records each source hash and exact command;
`controls.log.gz` preserves the nine assertion-failure logs.
An additional development experiment removed only the earlier page-level
refusal guard: the new return guard still refused, so that deliberately
redundant removal preserved behavior. Its passing result is retained separately
and is not counted among the nine failing controls.

Device wasm is **1,979,558 raw / 572,577 gzip bytes**, **264 bytes below** the
unchanged **572,841-byte** budget. The merged baseline itself measured
**1,982,126 raw / 572,898 gzip bytes**, 57 bytes over budget. Final delta is
**−2,568 raw / −321 gzip bytes** against that same-toolchain merged baseline;
against round 4's recorded artifact it is −2,709 raw / −226 gzip bytes,
including main's changes. The raw wasm SHA-256 is
`c48fb51532c3e09e8e0d3855adc6ca5cccf06c05630e130d16e8ebac5b9dfedf`.
The gzip measurement uses the exact `gzip -9 -c` command in build-wasm.sh.
The new scope checks initially increased the artifact; factoring shared scope
entry/restoration out of the generic wrapper recovered the bytes without
removing checks, changing pricing formulas or disabling device functionality.

Linux x86_64; Rust 1.97.0, Node 24.13.1, Bun 1.3.14, wasm-bindgen 0.2.127.
Eight Cargo jobs, dev/test debug information and incremental compilation off,
file descriptor limit 65,536. Frozen Bun install passes. No tool installation.

Re-run the affected commands listed verbatim in `qualification.json` from
`snapback4/`, with the toolchain above on PATH. The focused reproductions are:

```sh
cargo test -p snapback4-sim --test membership_search final_result_copy_preserves_the_compact_refusal
cargo test -p snapback4-sim --test membership_search public_witness
cargo test -p snapback4-sim --test membership_search adopted_default_prepay_is_replaced_by_the_retained_row_charge
cargo test -p snapback4-core --lib protected_public_materialization_uses_caller_budget_not_private_work
cargo test -p snapback4-core --lib uniquely_owned_materialization_moves_stored_payload
```

The full Rust run passes **4,006 tests, zero failed, 24 existing ignored**
across **249 test binaries / 962 executions**, plus workspace doctests
(899 seconds). Both app typechecks and all nine fixture-wrapper tests pass.
Client files and their seven additional shards pass **2,701 tests, zero failed,
10 existing skipped** (195 seconds).

The single `scripts/test.sh` run, started at **2026-09-27T16:15:18Z** on
`5cf51bed32db66f91c988385b6a994d830b6a2fd`, finishes:

```text
== 0 failure(s) in 1389 s
```

Exit **0**. All **78 serial client models** pass (258 seconds). Every phase
passes. Every full-suite failure: **none — ours 0, baseline 0, environmental 0**.
Existing ignores/skips remain explicit and are not counted as passes. The full
run reproduces the final wasm bytes; all qualified source hashes stayed fixed.
`qualification.json` binds the source, artifact, affected commands, full run,
and negative controls; `suite.log.gz` preserves the complete log and
`suite-failures.txt` records the exact result and classification.

## Deviations and remaining limits

No deviation from the round-5 scope and no unresolved reviewer reproduction.
The delivery-only test output allowance is the fixture choice described above;
it does not change production admission. The one-read Decision, ordinary drain
continuations, device evaluator, pricing formulas and all production budgets
remain unchanged. No saved search session, new protocol or syntax was added.

The inherited **60-second suite target remains exceeded**: this run takes
1,389 seconds; round 4 recorded 1,381 seconds. Reproduction: run
`scripts/test.sh` on this worktree with the recorded environment. This is a
baseline duration limitation, not a reported test failure; no timeout, seed
count or assertion was relaxed to make the run pass.
