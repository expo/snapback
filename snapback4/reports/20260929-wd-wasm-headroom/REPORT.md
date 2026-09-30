# WD round 0 — wasm headroom

**Recovered 12,692 B gzip: 592,979 → 580,287 B.** The final artifact has
**13,432 B headroom** under the unchanged **593,719 B** cap. Rust remains on
`opt-level=z`, fat LTO, one codegen unit and panic abort. No feature, validation,
message, codec or persisted representation was removed or changed.

The source changes save **9,654 B**; optional Binaryen 132 folding saves another
**3,038 B**. Without `wasm-opt` on PATH, the build is **583,325 B**, within the
cap but short of the requested 12,000 B recovery. The full recovery claim uses
the disclosed toolchain with Binaryen 132. Its folding pass is also in HV round
1, so these two lanes' savings cannot simply be added.

A **separate disposable HV integration build** measures **592,385 B gzip /
1,955,673 B raw**, **1,334 B under the cap**. It applies WD's core/device source
diff to HV commit `611f957f85d08109dcb39044fe77e870c7613197`, including the new
small-map module, and uses HV's existing folding script. Patches apply without
conflict. This is a size/build result, not a combined behavior qualification;
HV's worktree was untouched. `hv-combined.json` binds the artifact.

## Source and measurement custody

Branch `sb4-intent/wd-wasm-headroom`, base
`38abb89b8e0b206644b9e2619c6f2d159a981d23`. Builds and qualification ran on eb1000,
Linux x86_64, Rust **1.97.0**, LLVM 22.1.6, wasm-bindgen **0.2.127**, Node
**24.13.1**, GNU gzip level **9**, Binaryen **132** for the final optional pass.
`toolchain.json`, `artifacts.json`, build logs and the retained raw symbol tables
record identities. Every reported artifact gzip uses the production basename
**snapback4_device_bg.wasm**. Comparisons between temporary build candidates now
read gzip input from stdin, excluding temporary filenames from selection.

The baseline reproduces main's **2,040,531 B raw / 592,979 B gzip** exactly.
The old build script with Binaryen 132 also selects that artifact: its full
`-Os` candidate is **677,480 B gzip**, so it loses. No compiler upgrade,
changed compression level, smaller filename or hidden JavaScript transfer buys
the result. All **105 SDK JavaScript files are byte-identical**, including
wasm-bindgen glue (871,915 B raw in total; `sdk-js.json`).

## Where the bytes go

`twiggy 0.8.0` analyzes a symbol-bearing build (`CARGO_PROFILE_WASM_STRIP=none`),
then the same wasm-bindgen transformation. Names are retained for attribution;
DWARF is not needed. Shallow bytes belong to the outer concrete namespace
(including the implementor in `<T as Trait>`); inlined callees belong to callers.
They are **raw attribution, not additive gzip prices**. The symbol counterpart
has 2,042,133 attributed bytes before and 1,932,729 after; compiler strip choices
make it respectively 1,602 / 1,744 B different from production. It is not claimed
byte-identical to the shipped artifact. Full named item tables are retained as
`baseline-symbols.tsv.gz` and `final-symbols.tsv.gz`.

| Outer crate / owner | Before raw B | After raw B |
| --- | ---: | ---: |
| snapback4-core | 542,956 | 543,631 |
| alloc | 475,405 | 446,516 |
| serde_json | 412,862 | 408,088 |
| core | 253,526 | 179,788 |
| snapback4-device | 215,805 | 213,920 |
| module/data/glue | 107,618 | 107,259 |
| dlmalloc | 7,302 | 7,307 |
| serde_core | 6,703 | 6,705 |
| sha2 | 5,033 | 5,017 |
| std | 3,124 | 3,094 |
| wasm_bindgen | 2,795 | 2,476 |

The JSON attribution files enumerate every remaining crate. Families, before:
serde deserialization **445,548 B**, B-tree machinery **443,251 B**, serde
serialization **69,506 B**, serde_json's other code **58,422 B**, sorting outside
the B-tree class **46,843 B**, formatting/panic **26,573 B**. The broad B-tree
family also owns its bulk-construction sorts; those two class rows do not count
the same symbol twice. By generic entry point, `deserialize_struct` contributes
**233,448 B across 120 instances**, `deserialize_seq` 24,144 B across 45,
`MapAccess::next_key_seed` 23,691 B across 111, stable drift sort 23,414 B across
44, and `SeqAccess::next_element_seed` 20,283 B across 136.

Largest individual baseline functions, after wasm-bindgen (raw shallow B):

| Function | Bytes |
| --- | ---: |
| Runner statements closure | 27,489 |
| Runner row_changed | 25,058 |
| Runner insert_attempt | 17,498 |
| MemoryStore call dispatcher closure | 15,765 |
| Runner scan_consumed | 12,637 |
| Runner merge_with_words | 12,582 |
| Runner expr | 11,431 |
| Runner builtin | 10,490 |

The pre-bindgen census supplies a second cross-cut: BTreeMap/BTreeSet
**554,638 → 473,849 B**, 2,960 → 2,663 generic items; all slice sorts
**134,328 → 63,053 B**, 493 → 236 items. These categories overlap and include
code later removed by wasm-bindgen; they guide source work, not billing.

Ranked reducible contributors and disposition:

1. **Generic map construction and sort instantiations — changed.** Small field
   and plan maps paid for bulk sort, temporary vector and bulk-tree construction
   per concrete type/iterator even though ordinary insertion was already linked.
   Keep the B-tree representation, ordered output and last duplicate value;
   reuse insertion. Large row/index stores and group sets retain their algorithms.
2. **Serde derives and codec families — preserved.** Derived visitors remain the
   format definition. The family guard passes before and after: one typed text
   reader and Vec writer, with the established counting/replay/envelope exceptions.
   No accidentally retained second typed codec was found. A replacement here has
   substantially higher format/refusal risk than the measured map reduction.
3. **Large interpreter functions — preserved.** Statements, row changes, insert,
   scan, merge and expression evaluation are required on the device. Folding
   shares identical branch tails without changing their checks or server/device
   placement; full size optimization and outlining were worse.
4. **Strings, formatting and panic — preserved.** Formatting/panic is about 26.6 KB
   raw; JSON Display/pretty writer instances alone are 3,958 B across 23 entries.
   The entire multiset of 1,063 printable ASCII data runs (53,434 B) is identical
   before/after, hash `1e22e13705e41688df01d27b4c47a3555708e9f22781d8754e4096b5be002c83`.
   No public refusal text is shortened. Dynamic error construction is unchanged.
5. **Dependency features and tables — audited, no feature removed.** `features.txt`
   records normal/build dependency features for the actual web target; native
   SQLite/wasmi dependencies are absent. The existing symbol guard confirms
   server-only prefetch/admission/log events and Rust NFC tables are absent.
   Remaining hash, JSON-number and Unicode character operations serve existing
   behavior; no measured safe feature deletion was identified.

Production section accounting is independent of symbols. The baseline code
section payload is **1,935,793 B**, falling to **1,826,990 B**. Data has exactly two segments, **93,308 B**
(main read-only constants) and **36 B** (remaining initialized data), unchanged
in length after the reduction. Of the first, 53,434 B are printable ASCII runs
of length at least four; the other 39,874 B mixes tables, numeric constants,
addresses and short/non-ASCII strings. It is not all a removable table. The
section JSON records every production section's payload, framing and offset;
relocated numeric data can differ even while the textual runs match exactly.

## Measured change ladder

These are successive whole-module builds. Grouped source changes are measured
as a group; no per-site or additive per-function gzip estimate is claimed.

| Change | Raw B | Gzip B | Saved from prior B |
| --- | ---: | ---: | ---: |
| Main baseline | 2,040,531 | 592,979 | — |
| ObjectFields construction uses existing insertion/extend | 2,020,505 | 592,379 | 600 |
| Small program, plan, coverage, pinned-field and metadata maps | 1,968,977 | 585,493 | 6,886 |
| Remaining row-field maps; one plain-JSON field insertion path | 1,956,976 | 583,325 | 2,168 |
| Narrow Binaryen folding, duplicate elimination, DCE, vacuum | **1,930,985** | **580,287** | **3,038** |
| Total recovered | **109,546** | **12,692** | |

`small_map::{collect,try_collect}` only constructs ordinary BTreeMaps by
insertion. Fallible iteration returns its first error without consuming later
entries. No map lookup, order, rule or meter code changes. ObjectFields retains
its Arc and BTreeMap. `wire::to_json` shares `map_to_json`; the latter inserts into
the same serde_json ordered Map. The existing build stage keeps a folding result
only when gzip gets smaller. The cap file and Cargo profiles are unchanged.

Rejected trials: whole profile `s` **687,227 B**; zero LLVM ordinary/inline-hint
thresholds on the first source rung **598,817 B**; baseline merge-similar-functions
**597,507 B**; baseline multivalue outlining **616,284 B**. Baseline narrow
folding alone saves only 2,729 B (**590,250 B**), insufficient. See FAILURES.md
for unsuccessful setup/diagnostic attempts as well as validation failures.

## Acquisition and byte equivalence

The unchanged AQ `tools/browser.mjs` runs on a private copy of HV's preserved
full fixture, with its preserved production server (`server-sha256.txt`), real
password sessions, empty browser IndexedDB and strict durability. Five
alternating AB/BA pairs per mode are followed by a separate instrumented phase
series: **40 fresh contexts**, Chromium **151.0.7922.34**. There are no WD
builds/tests overlapping these samples. Host load-1 ranges **3.63–5.09** on
96 logical CPUs. This is cold device acquisition against a warm server; login
and initial SDK download are outside the interval, as in AQ.

| u0500, median | Baseline | Final | Change |
| --- | ---: | ---: | ---: |
| Default acquired | 2,216.0 ms | 2,210.3 ms | −5.7 ms (−0.3%) |
| Worker acquired | 2,343.4 ms | 2,228.8 ms | −114.6 ms (−4.9%) |
| Default first answer | 416.3 ms | 398.9 ms | −17.4 ms |
| Worker first answer | 498.3 ms | 448.6 ms | −49.7 ms |
| Default apply, separate instrumented series | 389.6 ms | 410.5 ms | +20.9 ms (+5.4%) |
| Worker apply, separate instrumented series | 394.2 ms | 414.9 ms | +20.7 ms (+5.3%) |
| Default drain, instrumented | 87.2 ms | 89.9 ms | +2.7 ms |
| Worker drain, instrumented | 90.0 ms | 92.0 ms | +2.0 ms |
| Default strict saves, instrumented | 676.5 ms | 678.5 ms | +2.0 ms |
| Worker strict saves, instrumented | 506.0 ms | 496.3 ms | −9.7 ms |

The final acquired ranges are 2.104–2.215 s default and 2.196–2.271 s Worker.
No overall acquisition regression appears in this sample; apply is modestly
slower, so this is not a claim that every operation is faster. Instrumented
phase medians cannot be summed into uninstrumented totals. Sync JSON response bodies remain **3,652,183 B over three responses**. Every context verifies
all **11,612 rows**, every delivered stored value, and a complete offline inbox.
Wasm high-water memory remains **57,278,464 B** for both builds and modes.
`paired/summary.json` contains individual timings, intervals and phase values.

The separate exact wasm differential replays a hash-bound private 44-command
acquisition trace, compares every reply and drain as text, consolidates the
persisted records, reopens offline, and compares malformed-command, backend and
kept-state errors. **119 comparisons match**, including **12,740 persisted
records / 5,176,053 bytes** (SHA-256 in `differential.json`). The captured commands
contain 41 sync-state reads and three apply pages; this trace alone does not
exercise every query/prediction or initialize SDK delivery. The complete AQ runs
exercise delivery and offline inbox, and existing device/codec/client suites
cover the broader contract. Generated duplicate/unsorted field-map tests also
compare canonical bytes and digests to baseline BTreeMap construction. Neither
private fixture data nor captured row payloads are committed.

## Validation

Affected device tests (`cargo test -p snapback4-device --lib --tests`) pass
**1,385**, with five declared ignores and no failures, across 73 test binaries.
The two small-map regressions pass **2/2**. The whole guide passes **99/99**.
Serde-family/server-only-symbol guards pass before and after. Reference audit:
524 LLP documents, 9,934 refs, zero errors and unchecked references.

The full suite's Rust stage passes **4,344 tests**, with 33 declared ignores;
fixture wrappers pass **9/9**. Cargo/wasm builds, docs budget, release guard,
package build/typecheck, chat check/typecheck and Expo typecheck all pass.
Client tests pass **5,197**, with ten existing skips and zero cancellations;
serial models pass **79/79**, including all 10,000 session and 3,000 online-client
sequences. Ran `scripts/test.sh` **exactly once**, exit **0**, final summary:

```text
== 0 failure(s) in 1375 s
```

Every full-suite failure: **none**. Ours **0**, baseline **0**, environmental **0**.
The separate affected/guide checks also have zero failures. Corrected exploratory
compile/tooling errors and rejected candidates are itemized in `FAILURES.md`.
The inherited nominal 60-second process budget is still exceeded; no timeout,
case count, assertion, size ceiling or diagnostic was relaxed.

Rust qualification used `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_BUILD_JOBS=8`, `RUST_TEST_THREADS=8`; the full runner retains its own
per-target scheduling/stack policy. The production artifact reproduced exactly
inside the full suite. All 19 changed source/test/build inputs stayed hash-identical
through qualification (`qualified-inputs.json`). `git diff --check` passes.
Completed logs and raw samples are ordinary gzip archives; use `gzip -dc` to read
them. Summary JSON and the reproduction tools remain plain text.

## Reproduce

From `snapback4/`, put Binaryen 132 on PATH, then run
`bash scripts/build-wasm.sh`. Use the pinned Rust/wasm-bindgen and Node 24.
The final size claim requires that optional optimizer. Build `38abb89b8e` in a
separate worktree for the control. `node scripts/attribute-wasm.mjs --families
--check-families --check-absent` reproduces pre-bindgen attribution. Run
wasm-bindgen without `--keep-debug` on its symbol-bearing output before Binaryen
with `--debuginfo`; preserving incompatible DWARF is unnecessary.
`attribute.py SYMBOLS_JSON PRODUCTION_WASM OUTPUT_JSON` parses production
sections and summarizes `twiggy top -n 1000000 --format json` output.

`measure.py` uses AQ's existing harness, u0500 only, the private server on 49771
and preserved SDKs at `target/wd/{baseline,final}-sdk`. It does not provision a
public fixture. `differential.mjs CAPTURE` consumes the private capture. The
measurement server is stopped after sampling. The SDKs, fixture, captured data and disposable HV source/build remain
ignored. Report evidence is retained here; nothing is pushed or published.
