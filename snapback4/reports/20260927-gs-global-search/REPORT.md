# Lane GS — measured baseline and continuation decision

2026-09-27. **Stopped at the brief's design checkpoint. Global search is not
fixed by this branch.** [LLP 3000.024](../../../llp/3000.024-global-search-beyond-one-read.rfc.md)
contains the proposed bounded plan, concrete counterexamples and the decision
required before implementing resumable opening. No engine, authorization,
cursor, meter, package, cost-certificate or guide behavior changes.

## What the evidence establishes

The supplied worktree begins at `origin/main` commit
`54099bc882c529713f6e6204c5f51181f696a8ef`, 0.4.4. Local `main` is a stale
earlier ref, so the baseline was built from that supplied current-main source,
before edits. Its binary is retained at `target/lane-gs/baseline/snapback4`;
[measurement.json](measurement.json) records its digest and method. Builds are
Linux debug builds, not the original macOS package or production throughput.

Only copied databases/WALs were opened. The original database, WAL and SHM
hashes match before/after ([source-hashes.json](source-hashes.json)).
The supplied final store has 1,002 conversations. The probe viewer, u0500,
has **100 memberships**, and just one readable conversation contains `coffee`
hits (9,990 non-tombstoned rows). Do not attribute this page's cost to 1,002
opened memberships or to 20 hits in every chat.

The original query was recoverable from `m5-search-why.txt`, with the change
confirmed by `run-log.md` entries 111–115 and `m8-search-scoped-why-2.txt`:

```text
messages where not .tombstone matching q last 20 by .at after c
  { *, senderProfile: profiles[principal = .sender],
       chat: conversations[.conversation],
       peers: members[conversation = .conversation] where .principal != viewer
         { profile: profiles[principal = .principal] } }
```

The original returns **exactly** its recorded logical meters: examined 1,
heap 36, index entries 33, probes 55, steps 23, output 12; `data: []`,
`complete: false`, `cut: null`, no `next`. `word_cut_at` is also absent.
The 33 entries are a fixed non-uniform word-discovery reservation, **not**
evidence that 33 words were found.

The fixed diagnostic predates the supplied final program. Restoring its
unconditional peer decoration yields 2,142 examined, 10,985,983 heap and
520,591 output: within 105 heap / 40 output bytes of the earlier checkpoint's
10,985,878 / 520,551. The query's diagnostic site name and the corpus changed;
this is not a claim of identical source/store bytes. The final builder program
already uses `searchPeers`, which returns no peers for group chats.

### Why an examined count of one hides the dead end

In the copied global coffee word index, the first descending row readable by
u0500 is at ordinal **44,101**. The earlier 44,100 coffee entries are in other
chats. The source path is:

- `engine/read.rs::discover_words` uses a fixed reservation for a non-uniform
  scope; `word_lanes` keeps that class on the eager traversal.
- `scan_consumed` reserves one examined unit for the private page, then
  `authorized_candidate` walks candidates and rule witnesses inside the
  protected authorization scope.
- `engine/authorized_scan.rs::GuardedRows` shares an 8,192 physical-entry
  allowance across the whole request. Hidden candidate/witness work consumes
  that allowance. `prepaid_scan` restores the caller meter after this work.
- `authorized_candidate` returns no candidate on exhaustion. The query stays
  non-uniform, so `Engine::query` reports incomplete. `read_cut` withholds its
  reason and `outcome_next_cursor` withholds a merge cursor.

The physical scan did **not** stop after reading one database row. Returning
its last unreadable key as `next` would turn internal authorization work into
caller-visible state. Raising this physical allowance is not a fix.

## Heap, output and latency attribution

All samples below use the copied final store, `q = 'coffee'`, the same viewer
and fixed clock 1790493000000. In-process `Engine::query`, three warmups and
20 samples; p50 = sorted sample 10, p95 = sorted sample 19. Shared Linux host;
these are baseline measurements, not comparisons against macOS release speed.
Compile, adoption, JSON network encoding and transport are excluded. Raw
samples and both first/second-page meters: [calibration.jsonl](calibration.jsonl).

| Shape | Examined | Heap B | Output B | p50 ms | p95 ms | Complete / next |
|---|---:|---:|---:|---:|---:|---|
| Original unscoped | 1 | 36 | 12 | 381.114 | 391.760 | no / no |
| Membership merge, bare | 122 | 554,978 | 8,251 | 10.431 | 10.526 | yes / yes |
| Bare + sender profile | 142 | 734,968 | 18,271 | 12.511 | 13.453 | yes / yes |
| Bare + chat | 142 | 693,498 | 15,271 | 11.942 | 12.107 | yes / yes |
| Bare + unconditional peers | 2,102 | 10,734,723 | 503,551 | 111.098 | 112.588 | yes / yes |
| Diagnostic-era full shape | 2,142 | 10,985,983 | 520,591 | 114.538 | 115.826 | yes / yes |
| Final builder's DM-only peers | 182 | 907,738 | 25,711 | 14.492 | 14.608 | yes / yes |

Every successful form above returns 20 rows; following its `next` returns
another 20 complete rows without duplicates. The original has no second page.

The exact telescoping heap account is:

| Stage | Heap increment B | Examined increment | Output increment B |
|---|---:|---:|---:|
| Bare membership discovery and merge | 554,978 | 122 | 8,251 |
| Add sender profile | 179,990 | 20 | 10,020 |
| Add chat to sender shape | 80,780 | 20 | 7,020 |
| Add unconditional peers to both | 10,170,235 | 1,980 | 495,300 |
| Total | **10,985,983** | **2,142** | **520,591** |

The intermediate sender+chat result is 815,748 heap / 162 examined / 25,291
output ([shape-stages.json](shape-stages.json), reproduced again on a fresh
copy by `prepare.py`). Collector overhead is shared: adding isolated shape deltas is not an
exact decomposition. Each of 20 messages repeats a roster read and **49**
peer-profile reads: 980 profile images. The peer step averages 508,512 heap
and 24,765 output bytes per emitted message, and accounts for 92.6% of the
full query's heap. This is payload the author requested, not pre-materialized
shapes for every merge candidate.

`engine/shaping.rs` runs returned collectors after page materialization.
`word_merge.rs::merge_lazy` already fetches heads lazily, but
`read.rs::lane_values` materializes source rows and descriptors accumulate per
matching word. `word_heap.rs` prices allocations and conservative allowances;
some decoder scopes release scratch. The reported heap is **not process RSS**.

## Synthetic scale and marginal costs

Fresh SQLite memory stores have the requested number of readable memberships
plus one unreadable sentinel chat with newer hits. The source uses the guide's
membership predicate, page size 20, one word and 30 hits per chat, equal times
across chats. No output decoration. Every request retains default ceilings.
The seed import is setup, not part of query timing or query meters.

| Memberships | Rows | Examined | Heap B | Index entries | Output B | p50 / p95 ms | Complete / next |
|---|---:|---:|---:|---:|---:|---:|---|
| 1,000 | 20 | 3,040 | 12,737,170 | 2,000 | 2,131 | 188.430 / 189.224 | yes / yes |
| 3,000 | null | 3,000 | 16,782,426 | 4,888 | 6 | 246.719 / 249.686 | no / no |
| 10,000 | 0 | 8,193 | 14,170,444 | 0 | 12 | 145.551 / 145.815 | no / no |

The 3,000 case exhausts heap during word discovery/descriptor construction
(`programs.newest.2`); the 10,000 case exhausts examined during membership
discovery (`programs.newest.1`), before word opening. A failed charge can report
a value just above its ceiling; it does not authorize that allocation/work.
Only the 1,000 case has a second page; it returns 20 complete, distinct hits.
The unreadable sentinel is absent. Raw evidence: [synthetic.jsonl](synthetic.jsonl).

| Memberships × words × hits per chat | Examined | Heap B | Output B | Complete / next |
|---|---:|---:|---:|---|
| 100 × 1 × 1 | 200 | 1,128,918 | 2,111 | yes / yes |
| 100 × 1 × 30 | 340 | 1,503,678 | 2,131 | yes / yes |
| 100 × 4 × 30 | 1,060 | 5,295,366 | 2,731 | yes / yes |
| 100 × 32 × 30 | 100 | 16,777,635 | 6 | no / no |
| 500 × 1 × 30 | 1,540 | 6,485,646 | 2,131 | yes / yes |

These controlled differences distinguish the cost axes without pretending each
allocation has a constant price:

- **Membership:** 100→500→1,000 dense scopes adds about 12.45–12.50 kB
  (12,455–12,503 bytes) of ledger per scope, including one word and head work.
  Membership rows alone are not this whole cost.
- **Word:** 100 scopes × one→four words adds 3,791,688 heap bytes for 300 extra
  word lanes, about 12,639 bytes each including overlap/refill/dedup work and
  wider text. A per-membership wrapper around that vector cannot bound it.
- **Candidate:** increasing hits from one to 30 adds only 140 examined rows
  and 374,760 heap bytes on the first page, despite 2,900 extra stored matches.
  The engine is already lazy with respect to the full match population.
- **Shape:** the calibration's 10.17 MB incremental peer cost applies to
  emitted rows. Moving shaping after the merge is already done.

## Design handoff and deviations

The lean plan in LLP 3000.024 streams membership keys, retains compact authorized
heads, bounds the inner word traversal and materializes emitted rows. It still
cannot discover 10,000 rows within 8,192 examined units. Existing cursors carry
only the last emitted position, not unfinished discovery.

Concrete counterexample: the undiscovered 10,000th membership has the newest
hit. Emitting from the discovered prefix and continuing after it either omits
that hit or puts it after older hits. Repeating the same start never progresses.
Another request can revoke a saved head's membership; an old snapshot must not
restore that authority. An expired/denied run can leave no lawful visible key
for a discovery continuation. A serialized 10,000-head frontier also exceeds
the existing 4 KiB decoded cursor limit.

The supervisor must select the consistency, authority and state-lifetime
contract for a retained search-work session or a stateless multi-pass protocol.
The brief explicitly directs stopping at that boundary. Therefore steps 4–5
are **not implemented**: these are baseline scale measurements; no claim is
made that the proposed design runs, that every partial page resumes, or that
the certificate/card now promises it. No budget is raised, no durable query
state added, and no rule/disclosure guard removed.

The existing `check --cost` says these operations grow with membership and word
work, and `N_NEVER_COMPLETE` flags the unscoped form. It does not tell a builder
that opening can be terminal. [cost-excerpt.json](cost-excerpt.json) preserves
that evidence. The proposed certificate distinguishes unresumable opening,
inner word work and shape cost and supplies concrete rewrites; it cannot label
a new shape resumable until the continuation protocol exists. `search_all`
is unchanged rather than shortened into a promise the engine does not meet.

The required implementation `@ref LLP 3000.019` comments do not arise: this
branch implements no runtime decision from that RFC. Its probe references the
new measurement RFC instead. The root LLP gains the required scope extension.

## Files and executable checks

- `llp/3000.024-global-search-beyond-one-read.rfc.md`: governing context pack,
  diagnosis, bounded-plan proposal, counterexamples and decision handoff.
- `llp/3000-snapback4.explainer.md`: links that scope; `llp/current/3000.024…`
  declares it in progress, not accepted or implemented.
- `crates/snapback4/examples/gs_search_probe.rs`: executable baseline research
  fixture and repeated query measurements. Assertions check unreadable sentinel
  exclusion, complete-page cardinality, disjoint first/second pages and strict
  `(at, id)` descending order across their boundary.
- This directory's `prepare.py`: copies the evidence, reconstructs exact
  query forms, runs the CLI and certificate, checks both reproduced outcomes
  and verifies source hashes in `finally`. It refuses an existing destination.
- `calibration.jsonl`, `synthetic.jsonl`, `calibration-cli.json`,
  `shape-stages.json`, `cost-excerpt.json`, `measurement.json`, `source-hashes.json`: measured
  evidence and method, without database payloads or session credentials.
- `qualification.json`, `suite-failures.txt`, `retained-branch-isolated.txt`: the two baseline
  client-test failures and their passing isolated reproduction attempt.
- `JOURNAL.md`: one append-only dated entry with the outcome and qualification.

No new product regression tests: no product code was changed. The executable
research assertions above establish baseline behavior, not an implemented fix.
Initial probe-development mistakes (a Rust slice-length/Path type mismatch and
the synthetic query's filename namespace) were lane-owned and corrected before
the successful probe runs. They were not product failures.

## Reproduction

From `snapback4/`, with the pinned tools on PATH:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
bun install --frozen-lockfile
cargo build -p snapback4
python3 reports/20260927-gs-global-search/prepare.py \
  --evidence /home/ccheever/sb4-intent/gs-store \
  --out target/gs-reproduction \
  --binary target/debug/snapback4
cargo run -p snapback4 --example gs_search_probe -- \
  target/gs-reproduction/.snapback4/store.sqlite
cargo run -p snapback4 --example gs_search_probe
cargo test -p snapback4-lang --test guide
scripts/test.sh
```

Use a fresh `--out` each time. Adding the recovered global index to this 2.2 GB
store needs adoption work (about 96 seconds in the original CLI pass); that
is not query latency. The standalone repeated probe opens the adopted copy.
The supplied source store is never opened by either reproduction path.

## Qualification

Frozen Bun install passes. The standalone probe build and all eight synthetic
and seven original calibration measurements pass their assertions; the
additional sender+chat CLI measurement completes. The complete `prepare.py`
reproduction passes on a second fresh copy, including its hash and outcome
assertions. The whole guide passes **86/86**, zero failed, in 2.62 seconds.
The full suite ran once and finished with the result below.
The final probe source also runs all eight calibration variants successfully
against the second copy (`target/lane-gs/probe-final-calibration.jsonl`) and
all eight synthetic variants (`target/lane-gs/probe-final-synthetic.jsonl`),
including the final strict-order assertions; their logical meters match the
recorded baseline measurements.

`ref-check --verbose`: 518 LLP documents, 9,609 references, zero errors and
zero unchecked at the final audit. `git diff --check` passes.

The full suite's wasm build measured **1,981,512 raw / 572,053 gzip bytes**,
under the unchanged **572,841** gzip ceiling. No runtime source changed, so
the lane's wasm code delta is **0**; this is the built baseline artifact,
not a comparison against another host's historical compression result.

Exact `scripts/test.sh` summary: **`== 1 failure(s) in 1296 s`**, exit **1**.
The failing phase is `client tests`; Rust, the whole guide, package builds and
typechecks, wasm/budgets, fixture wrappers and the seeded client models pass.
The source suite began during baseline investigation; runtime inputs did not
change, and the research probe was built and checked separately afterward.
The inherited 60-second suite budget is exceeded; no ceiling or deadline was
raised. [qualification.json](qualification.json) binds the full log by SHA-256.

The client phase has two **baseline intermittent failures**, with runtime and
test sources byte-identical to the starting commit:

1. `MQ local branch wasm: retained history and independent held coverage`:
   `retained-history.test.mjs:336` expected clock 1790500889276, observed
   1790504489418. Assertion failure, 491 ms.
2. `MQ local branch watch wasm: retained history and independent held coverage`:
   timed out after 60,000 ms (reported as one cancelled test).

Both pass together in isolation (2 passed, zero failed/cancelled, 805 ms):

```sh
node --test --test-name-pattern='^MQ local branch( watch)? wasm:' \
  packages/snapback4/test/retained-history.test.mjs
```

Full failure stacks are in [suite-failures.txt](suite-failures.txt); the isolated
result is [retained-branch-isolated.txt](retained-branch-isolated.txt).
The underlying clock/watch race is **not diagnosed or fixed** here. The
classification is baseline because this lane changes neither code nor tests
on those paths; a host-load cause has not been established. Reproduce with the
whole `scripts/test.sh` client phase; the isolated command is not a reliable
failure reproduction. No deadlines or assertions were changed. No lane-owned
or established environmental full-suite failure has been observed.

No push or package publication. Integration and blind reviews remain the
supervisor's work. Open product problems are the exact reproduction above,
the 3,000/10,000 terminal cuts and the many-words opening cut; no implementation
is claimed to resolve them.
