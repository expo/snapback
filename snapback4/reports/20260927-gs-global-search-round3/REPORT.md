# Lane GS round 3 — actual-size admission and executable repairs

Read rounds 0–2's reports, journal entries and binding prompts, LLP 3000.024
and its Decision, and both complete round-2 reviews. First fetched and merged
origin/main as `3588816da`. Preserved both parent journal histories verbatim
as ordered subsequences. The merge added one caller of `scan_authorized`;
its missing feature-gated selection argument was repaired before qualification.
Implementation commits are `140463e43` and `67931c9d8`, each with the requested
co-author trailer. No push, publication, shared-path installation, meter or
cursor budget change.

## Changes by file

Paths are relative to snapback4 except the LLP.

| File | Final change |
| --- | --- |
| `crates/snapback4-core/src/engine/authorized_point.rs` | Trusted non-expiring selected heads use the ordinary actual-size metered scan. An emitted id authorized by a head in the same read-only transaction uses that adapter, prepays missing-field materialization, then rechecks its rule under a separate declared witness reservation. Expiring, private-field, recorded and inherited images retain their existing admission. |
| `crates/snapback4-core/src/engine/word_heap.rs`, `engine/word_heap/tests.rs` | Exposes the existing test-only allocation counter to the default-materialization regression; no production allocator or ledger change. |
| `crates/snapback4-core/src/engine/membership_search.rs` | Passes the established head authority into emitted-member admission. |
| `crates/snapback4-core/src/engine/row_views.rs` | Existing member reads explicitly retain untrusted admission. |
| `crates/snapback4-core/src/engine/row_views/batch.rs` | Mechanical integration repair for main's new authorized scan call. |
| `crates/snapback4-core/src/search_plan.rs` | Removes the incomplete declaration-size fallback; runtime and certificate continue sharing eligibility. |
| `crates/snapback4-core/src/search_plan/print.rs` | Prints text length as `count`, concatenation as parenthesized `+`, calendar offsets as duration literals, and arbitrary calendar periods as `bucket`. Other unsupported IR expressions still withhold a repair. |
| `crates/snapback4-sim/tests/membership_search.rs` | Boundary and combined-witness regressions, active-ceiling checks, private-payload noninterference, both admission paths' revocation, and compiled/executed repairs with four live hits and three returned previews. |
| `crates/snapback4/src/scale/search_tests.rs` | Wide declarations remain eligible; every emitted builtin spelling compiles against its originating schema; certificate/refusal previews require `last 3`. |
| `crates/snapback4-lang/src/guide/search_all.md` | Replaces the obsolete declaration fallback with actual-size admission and its authority boundary. |
| `../llp/3000.024-global-search-beyond-one-read.rfc.md` | Updates the existing Decision and repair contract. |
| `JOURNAL.md`, this report and qualification records | Append-only measurements and reproducible validation. |

## Governing context

Scope: compact server membership search, authorized row admission and generated
search repairs. LLP 3000 is the fenced root; LLP 3000.024 (in current/) is the
active commission. Its Decision and §§3–4 govern bounded opening and leave
multi-request state out. LLP 3000.015 §§1–2 govern disclosure, declared private
scratch and physical authorization accounting. LLP 3000.007.000 §3 governs
stopping after a failed refill and preserving the existing continuation.
The current search card supplied the authoring contract. The existing Decision
and card are updated together; no new design handoff is needed.

## Admission and evidence

The preferred actual-size fix is implemented. No default-heap threshold is
used to select the compact plan. The existing metered store adapter charges
before payload decode/ownership. Its trusted head image is full and transient;
the streaming consumer drops it and retains only the ordering key. The
selected-field decoder remains useful on declared-admission paths. This is a
tradeoff: trusted heads decode unused fields, rather than adding a second
selected-field actual-size decoder and ledger in this round. They do not retain
full images per membership. Emitted hits still recheck the read rule, including
witness deadlines, before final disclosure.

The actual-size path requires established authority in this read-only server
transaction, no expiry, no private fields, no recorded capture and no inherited
parent. It never prices an unreadable candidate from its actual storage size.
Private witness work stays under its declared reservation and the existing
physical authorization allowance. No cursor format, meter, byte budget or
multi-request consistency contract changes.

Default-heap regressions cover body maxima 1,023,556 / 1,023,557 / 1,026,000 /
1,027,327 / 1,027,328 / 1,551,615 / 1,551,616 / 2,000,000. These straddle
Grok's first failing band and the old 16 MiB and proposed 24 MiB cutoffs.
Each stores one membership and one tiny message. Both the explicit old merge
and compact newest return exactly `hit`, complete, with identical data/next.
Old retained heap is 27,446 B; compact is 25,253 B for every declaration.
The same reads complete with a 128 KiB active heap. The combined 600,000-body /
600,000-membership-info reproduction completes at default and 10 MiB active
heap, with each witness reservation admitted separately from decoded rows. Both
reads retain the same 27,446 / 25,253 B as the ordinary fixture after scratch
release; these counters are not their peak reservations or process RSS.

The private-payload test compares the entire serialized outcome with hidden
payloads of 0 and 20,000 bytes. Revocation between pages runs with and without
message expiry. Existing exact refusal-count, lower-bound, hidden-membership,
cross-word, tombstone, expiry, deduplication and continuation checks remain.

## Repairs and runnable forms

Existing syntax is unchanged. For the test schema, these compile and execute:

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and count(.body) > 3 and exists members[.room, viewer] last 2 by .at after c
```

Concatenation is preserved as an operator:

```quarry
query newest(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and (.body + 'x') != 'hidden' and exists members[.room, viewer] last 2 by .at after c
```

The emitted grouped repair retains both predicates, pages memberships and
returns three live previews:

```quarry
query repaired(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 2 by .room, .id where exists (messages[room = .room, tombstone = false] matching q by .at, .id where (count(.body) > 3)) { room, hits: messages[room = .room, tombstone = false] matching q last 3 by .at, .id where (count(.body) > 3) }
```

Reset the cursor when switching from newest to grouped.

The tests compile the actual emitted text against the originating schema,
including renamed roster/posts/roomId bindings. Runtime repairs return the
newest three of four live hits, exclude a newer tombstone, and exclude chats
with only deleted or too-old hits. A one-hit preview mutation must fail both
runtime and certificate assertions. The builtin audit additionally found the
calendar offset defect: `day(.sent, 8h)` had printed an invalid bare integer.
Calendar repairs now include units; `hour`, `day` and arbitrary `bucket` periods
round-trip. `lower`, `trim` and `slice` were already valid and are now tested too.

## Qualification

Linux x86_64; Rust 1.97.0, Node 24.13.1, Bun 1.3.14, wasm-bindgen 0.2.127.
Eight Cargo build jobs, dev/test debug info and incremental disabled, file
descriptor limit 65,536. Frozen Bun install passes; no tools were installed.

Affected checks pass: membership 13/13, certificate 7/7, shared server search
17/17, shared device search 50/50, device authorization/census 81/81, merge
search 11/11, whole guide 86/86. The reference audit passes with 518 LLPs,
9,639 references, zero errors and zero unchecked. No changed source file
exceeds 1,500 lines.

The device build passes at **1,983,447 B raw / 572,688 B gzip**, below the
unchanged **572,841 B** budget by **153 B**. Relative to round 2: +3 raw /
−11 gzip bytes. The admission and printer changes remain behind server-search;
the device retains its existing evaluator. This is a whole-artifact measurement,
including merged main, not inferred component attribution.

All eight original negative controls fail at assertions (ten executions), with sources
restored byte-for-byte after each: full round-2 admission/printer, round-2 with
a 24 MiB cutoff, head admission alone, emitted-row admission alone, `len`,
`concat`, unitless calendar offsets, and `last 1` previews. The 24 MiB mutation
specifically completes 1,023,556 and returns a heap-null/no-next page at
1,023,557; the regression catches that exact lower band. The preview mutation
fails both runtime and certificate suites. [controls.json](controls.json)
records commands, exact failed summaries and log digests.

The restored runtime and certificate suites pass 13/13 and 7/7. The single
full run, on implementation commit `140463e43024421d7cac704563970cc98e638b1b`,
finishes **`== 0 failure(s) in 1434 s`**, exit **0**. Every phase passes:
Rust **3,984 passed, 0 failed, 24 existing ignored**, across 246 binaries /
959 executions plus doctests (913 s); client main **2,644 passed, 0 failed,
10 existing skips**, all seven additional shards **56/56** (195 s); all nine
fixture wrappers, both app typechecks, and all **78 client models** (263 s).
The full run reproduces the 572,688 B gzip device build exactly.

**Every full-suite failure: none.** Yours: zero; baseline: zero;
environmental: zero. The inherited 60-second target is exceeded, as in prior
rounds; no timeout, assertion, seed count or budget was raised. The full suite
ran once. Raw log and source commit are bound in qualification.json.

An admission audit during the full run identified an additional missing-field
materialization precharge on the new emitted-member fast path. The suite's
source stayed unchanged through completion. The allocation-sensitive regression demonstrably fails without the precharge:
a 64 KiB heap refuses only after allocating 1,001,185 bytes for a million-byte
adopted default. The fix prepays `materialization_heap` before `into_value`,
matching the ordinary scan's ordering. The low-heap test requires refusal
before that copy; its ample-heap arm requires the full default and a ledger
peak covering measured Rust allocations. This is the ninth negative control
(eleventh execution).

Final implementation `67931c9d8` passes the whole core library (148 passed,
one existing ignored), membership 13/13, certificate 7/7, shared server search
17/17, shared device search 50/50, device authorization/census 81/81, merge
search 11/11, whole guide 86/86, and the docs budget check. With the precharge,
the 64 KiB default test allocates only 265 B before refusal; its attempted
reservation reaches 1,003,372 B. With 16 MiB it materializes the complete
default, allocating 1,001,185 B under a 2,003,584 B ledger peak. The final device
build remains **1,983,447 B raw / 572,688 B gzip**, the same sizes as the
full-suite artifact. Its SHA-256 is
`dea4612052a43f422f6a9c62a73ed2b77b9fc5bb853368be84bd2d401a9a1891`;
five bytes differ from the suite artifact, whose separate digest is retained
in the qualification record. Equal sizes are not a byte-identity claim.
The full suite was not repeated after this one-line admission correction;
the complete affected checks above qualify it. [qualification.json](qualification.json)
binds both source commits, the final source hashes, logs and artifact size.
[suite-failures.txt](suite-failures.txt) records the exact summary and failure
classification. Earlier local development runs caught the merge caller's
missing argument and the calendar printer defect; both were corrected before
the full suite. The deliberately failing mutation/default controls are
regression evidence, not unresolved failures.

## Scope and remaining limits

No multi-request continuation or saved search work is introduced. All heads
must still be established in one read. Actual row sizes, witness reservations,
word expansion, retained work and returned shapes still consume the active
meters. An actual resource exhaustion remains possible; this fix removes
refusals caused solely by a wide declaration on an otherwise authorized tiny
non-expiring image. Device and explicit legacy merge semantics are unchanged.
The device keeps its old evaluator and its documented scale boundary.
The guide labels the empty-chat calibration limits as round-1 measurements:
those predate actual-size admission and were not remeasured in round 3. The
shared dense/search envelopes were rerun. No original calibration database
was opened or changed. There are no remaining assigned findings; the known
one-read and legacy/device limits above remain intentional.

Reproduction uses the pinned tools and local target directory:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0
cd snapback4
bun install --frozen-lockfile
cargo test -p snapback4-core --lib
cargo test -p snapback4-sim --test membership_search -- --nocapture
cargo test -p snapback4 --bin snapback4 scale::search
cargo test -p snapback4-sim --test clique search_global
cargo test -p snapback4-device --test device search_global
cargo test -p snapback4-device --test readauth
cargo test -p snapback4-sim --test search_merge
cargo test -p snapback4-lang --test guide
bash scripts/build-wasm.sh
ulimit -n 65536
scripts/test.sh
```
