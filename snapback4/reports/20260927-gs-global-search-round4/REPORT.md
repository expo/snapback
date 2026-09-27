# Lane GS round 4 — heap boundaries and default ownership

Local branch `sb4-intent/gs-global-search`. Read rounds 0–3's prompts, reports,
journal entries, LLP 3000.024 and its Decision, and both complete round-3
reviews. Fetched and merged `origin/main` first as `0dd5eed43`, preserving
both journal parents verbatim as ordered subsequences. No push or publication.

## Changes by file

Paths below are relative to snapback4 except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/engine/membership_search.rs` | Converts a compact page's heap failure to E_SEARCH_OPEN after internal buffering as well as during opening; records its authorized count and includes the result reservation in that boundary. |
| `crates/snapback4-core/src/engine/read.rs` | Routes compact expression merges with their existing result-charge callback; legacy merges keep that same charge. |
| `crates/snapback4-core/src/engine/runner.rs` | Preserves the expression charge and converts a compact result's generated binding charge failure to the same refusal. The compiler's search conditional assigns its merge to a local before returning it. |
| `crates/snapback4-core/src/engine/authorized_point.rs` | Keeps missing-default prepayment before materialization, then releases it after the recheck, transferring retained ownership to `charge()`. |
| `crates/snapback4-core/src/engine/witness.rs` | Actual-size public lookup prepays missing-field materialization before consuming the disclosed image; its charge remains while the witness lives. Adds an allocation-sensitive lifetime regression. |
| `crates/snapback4-core/src/engine/authorized_scan.rs` | Protected rule scopes reserve public schema defaults before their internal ledger becomes unbounded/restoring. Charging only inside that scope could not enforce the caller's 64 KiB ceiling. |
| `crates/snapback4-core/src/value/disclosed.rs` | Computes that schema-only default reservation. Removes the temporary default vector, preserves visibility decisions on the original image, and expresses the existing pricing formulas as loops; avoids constructing missing-field errors for lookups used only as optional values. |
| `crates/snapback4-core/src/value.rs` | Equivalent recursive pricing loops reduce the device artifact; all allocation formulas and ceilings are unchanged. |
| `crates/snapback4-core/src/search_plan/print.rs` | Withholds literals containing carriage returns; Quarry has no preserving spelling for them. |
| `crates/snapback4-sim/tests/membership_search.rs` | Shares the tiny-payload fixture and sweeps examined/index/probe cuts, checking usable continuations. |
| `crates/snapback4-sim/tests/membership_search/edges.rs` | Seven regressions for refill and binding overflows, a heap sweep, stored payloads, adopted defaults, carriage returns, and executable calendar repairs. |
| `crates/snapback4-lang/src/guide/search_all.md`, `crates/snapback4-lang/src/guide/why/SEARCH.md` | Documents the compact heap refusal and the conditional availability of a renderable repair. |
| `../llp/3000.024-global-search-beyond-one-read.rfc.md` | Updates the existing Decision with charge lifetimes, generated binding reservations, public defaults and repair tests. |
| `JOURNAL.md`, this report and qualification records | Append-only results, measured artifact and exact suite outcome. |

## Findings and regression evidence

1. **Internal buffering is not delivery.** Both tiny-row reproductions now
   refuse E_SEARCH_OPEN, rather than returning unavailable null: body bound
   4,000 plus witness bound 1,045,950 at 16 MiB; body bound 1,023,557 at
   64 KiB. The explicit control still returns the complete hit. One stored
   message with 1,900,000 / 2,000,000 / 2,200,000 payload bytes also refuses
   explicitly on the default heap. That reproduction additionally exposed the
   generated assignment charge after the merge result, so both reservations
   remain inside the refusal contract. No allocation charge was removed.
2. **Heap sweep.** 638 ceilings cover 2,048–262,144 bytes in 512-byte steps
   and 16 MiB ±64 KiB in 1,024-byte steps. Each eligible tiny-payload plan
   either returns the complete hit or E_SEARCH_OPEN. The low-range fixture completes at 382 ceilings and refuses at 127;
   the 16 MiB range completes at 64 and refuses at 65. The existing declaration-band and custom-ceiling regressions
   still run. Examined, index-entry and rule-probe sweeps retain nonempty
   partial pages with working next cursors; resumed results have no gap or
   duplicate at the boundary.
3. **One retained default.** A 1,000,000-byte adopted payload omitted from
   SQLite storage completes at a 3,600,000-byte heap and equals the control.
   The retained meters are 3,025,073 compact / 3,034,639 control. The 64 KiB
   case still refuses before copying; the earlier allocation-sensitive prepay
   test is retained.
4. **Public witness materialization.** A public room with an omitted million-
   byte literal default refuses at 64 KiB on both compact and legacy paths,
   and compact completes with the default heap. A direct memory-store lookup
   measures allocations, proves refusal precedes the default copy, and checks
   that the large-ceiling result still holds a million-byte reservation while
   its witness row exists. The 64 KiB attempt allocates 133 bytes before
   refusal; the 3.6 MB arm allocates 1,000,812 bytes under a 1,003,016-byte
   retained reservation and ledger peak. The extra schema reservation is necessary because
   protected authorization scopes restore their internal ledger; it depends
   only on declaration literals, not a private stored image.
5. **Carriage return.** The real `newest(q: "cof\r")` refusal at a 2,000-byte
   heap has E_SEARCH_OPEN and the search guide, with no fabricated rewrite.
   If a rewrite is emitted, the test first compiles it against its originating
   schema, then requires withholding the unsupported literal. `\\r` is not
   substituted: Quarry would read it as `r`.
6. **Calendar behavior.** Original and runtime-repaired predicates execute
   around both boundaries of bucket zero for `day(.at, 8h)`,
   `hour(.at, 30m)` and `bucket(.at, 2m, 1s)`. Each fixture includes the instant
   before, at, and after the offset, the preceding boundary and the next
   boundary. Exact original hit ids, repaired membership ids and every preview
   are asserted. Removing offset emission fails the execution assertion.

The negative controls remove each refusal conversion, retain the double charge,
remove the public lookup prepay, remove its protected-scope reservation, emit
carriage returns, and drop calendar offsets. All seven fail at their intended
assertions (exit 101), and the restored implementation passes the regressions. `controls.json` binds commands and log hashes; production files are
restored byte-for-byte after every mutation.

## Runnable forms

No new syntax. Implementation is committed as `39f3998dd`, with the required
co-author trailer. On the test schema, the existing form still compiles and runs:

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.room, viewer] last 2 by .at after c
```

An offset predicate remains meaningful in both searches in the generated repair:

```quarry
query calendar(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and day(.at, 8h) = 0 and exists members[.room, viewer] last 20 by .at after c
```

The repair pages memberships and previews up to three matching messages per
chat. Reset the cursor when switching forms. Carriage-return-containing runtime
text still searches normally when resources fit; its diagnostic literal cannot
be rendered faithfully and is withheld.

## Qualification

All ten affected checks pass on `39f3998ddaafad1f0ef114486c93e534f2dbed8c`:
core 149 passed / one existing ignored; runtime membership 20/20; certificate
7/7; shared server search 17/17; whole device 436 passed / one existing ignored
(including all 50 shared search fixtures); device authorization/census 81/81;
merge search 11/11; whole guide 86/86; docs budget and device wasm build.
The LLP reference audit passes: 518 docs, 9,647 references, zero errors and
zero unchecked. No changed source exceeds 1,500 lines.

The full Rust run passes: 3,991 passed, zero failed, 24 existing ignored across
247 binaries / 960 executions, plus workspace doctests (888 seconds).
Both app typechecks and all nine fixture-wrapper tests also pass.

The single full run of `scripts/test.sh` on `39f3998ddaafad1f0ef114486c93e534f2dbed8c`
finishes **`== 0 failure(s) in 1381 s`**, exit **0**. Client tests and their seven
additional shards total **2,701 passed, 0 failed,
10 existing skipped**. All **78 serial client models** pass.
Every phase passes. The full run reproduces the final device size exactly.

**Every full-suite failure: none.** Yours: zero; baseline: zero;
environmental: zero. The inherited 60-second suite target remains exceeded;
no seed, assertion, deadline or budget was relaxed. The full suite ran once,
and no implementation changed after its source snapshot.

[qualification.json](qualification.json) binds the source commit, source/log
hashes, affected results and wasm artifact. [suite-failures.txt](suite-failures.txt)
records the exact summary and classifications; [suite.log.gz](suite.log.gz)
archives the complete raw log. [controls.json](controls.json) records all seven
intentional negative-control failures separately.

The merged baseline itself builds at **1,983,525 raw / 573,173 gzip bytes**,
332 bytes above the unchanged **572,841-byte** gate. The temporary baseline
build restores every modified production source byte-for-byte. The final
candidate build measures **1,982,267 raw / 572,803 gzip bytes**, passing by
38 bytes: −1,258 raw / −370 gzip versus that merged baseline. Relative to
round 3's recorded artifact: −1,180 raw / +115 gzip, including merged main.
The source size reduction keeps identical pricing formulas and field visibility;
it neither changes the compression gate nor disables device functionality.

Linux x86_64, Rust 1.97.0, Node 24.13.1, Bun 1.3.14; eight Cargo build jobs,
no dev/test debug information or incremental compilation, fd limit 65,536.
Frozen Bun install passes. No tools installed. The earlier round's worktree-
local Binaryen was tried and not selected; no shared path was changed. Only
this lane's old ignored incremental build cache was removed for disk space.

## Scope and deviations

LLP 3000.024's Decision remains one read: no retained search session, multi-
request continuation, cursor format change, meter increase or wasm-budget
increase. The existing public-image and default-pricing helpers are reused;
private/expiring/recorded/inherited authorization is not relaxed. Device search
keeps its existing evaluator. The schema-derived witness reservation stays in the shared code, including the device build.

The additional result/binding refusal handling and schema-derived witness prepay
are necessary extensions of the requested fixes, demonstrated by regressions
that still failed with only the suggested local edits. The disclosure/pricing
refactor is the extra work required to pass the inherited merged wasm overrun.
Filling defaults keeps the original image alive for visibility decisions and
can force a copy of its shared map; the existing materialization prepay already
includes that copy. This replaces the temporary vector of defaults.
There is no protocol redesign. Existing legacy/device opening limits and the
bounded one-read discovery envelope remain intentional. No calibration source
store was opened or modified.

There are no remaining assigned findings. To reproduce the new edge suite:

```sh
cargo test -p snapback4-sim --test membership_search -- --nocapture
cargo test -p snapback4-core --lib public_lookup_prepays -- --nocapture
```

The intentional one-read opening and legacy/device scale limits remain those
in the Decision; this round did not remeasure the original calibration store.
The suite's elapsed-time target is still exceeded, as the exact run above
shows; reproducing that maintenance limit is `scripts/test.sh` with the
recorded toolchain and environment.
