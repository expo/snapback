# S1 report — bounded data programs kernel

## Verdict

S1 passes its brief. The standalone Rust crate builds with ordinary Cargo,
all seven integration tests pass, every named hand-lowered program certifies
and executes, and the receipt-only client scenarios work without a program-name
branch or other operation-specific opcode. No falsifier was observed in this
lane.

The work is committed locally on the spike branch. No push was attempted. All
authored files remain under `spikes/bounded-programs/`; the crate-local
`.gitignore` excludes derived Cargo output.

## What was built

- A standalone Cargo workspace using `rusqlite` with bundled SQLite.
- A Serde JSON IR for `const`/`let`, assignment, conditionals, bounded loops,
  recursion, generic reads/writes, modeled inputs, and pure deterministic
  builtins. `SPEC.md` pins the i53/codepoint value model and IR in 89 lines.
- Typed schemas with composite and unique SQLite indexes, one algebraic rule
  per effect, `unique`/`cap`/`appendOnly`/`immutable` constraints, and
  same-transaction maintained `count`/`sum` rows. Count maintenance covers
  insert `+1`, delete from the preimage, and group move `-1/+1`; sum uses the
  same lowering. Interval columns and `exclusion` were intentionally skipped,
  as S1 permits.
- A static checker that emits read/write sites, provenance, calls, hoists,
  rule hashes, constraint checks, maintenance amplification, step and examined
  bounds, geometric recursion bounds, disclosures, and per-transition closed
  versus partial prediction sites. Exclusive branches use a maximum; nested
  loops multiply. Helpers disappear before checking.
- A single interpreter running inside one SQLite transaction. Generic index
  entries are maintained with each row and scans execute as SQLite index
  queries with `LIMIT take+2`; rules mediate every returned/written row and
  memoize probes by rule hash plus pinned-input digest.
- Two separate artifacts: an authoritative trace (points, ranges, hidden rows,
  rule and constraint inputs, absences, writes) and a noninterfering closure
  receipt (readable rows/ranges/absences, halo, N+2 key, scoped verdicts).
  Runtime assertions enforce receipt ⊆ trace ⊆ certificate.
- A second, in-process SQLite client store constructed only from a closure
  receipt. It uses the same interpreter for local mutations and query replay,
  tracks generic range coverage and halo consumption, reports exact partial
  site ids, and rebuilds from reauthorized receipts to evict unheld rows.
- Rust-builder fixtures for private-chat `thread`, `send`, `markRead`, both
  inbox variants, bounded per-member unread maintenance, and `startDm`; Relay
  `boardView`/maintained `boardSummary`; Split maintained `ledger`,
  deterministic-remainder `addExpense`, and `ancestors`; plus the computed-key
  `mentionScan`.

## Pass/fail results

`cargo test -- --nocapture` from this directory: **7 passed, 0 failed**.

- PASS — every named program JSON-round-trips, certifies, and executes.
- PASS — 10,000-message `thread` stays beneath its certificate and its
  conversation-membership rule costs one memoized probe.
- PASS — a hidden entitlement rule emits one verdict bound to rule hash,
  pinned inputs, principal, and auth epoch; no entitlement row or range extent
  enters the receipt.
- PASS — `expenses take 500 × shares take 50` is refused as `E_BOUND` with the
  named product and a `maintain.count/sum` rewrite.
- PASS — an inlined helper retains `take 37`, one maximum call, and a 39-entry
  scan reserve. `recurse(depth=8, fanout=1)` certifies the geometric sum of nine
  point calls.
- PASS — owner-filtered waitlist depth is refused as `E_STRUCTURAL_COUNT`; the
  maintained count with declared `readable` is admitted with an
  `E_DISCLOSURE` item.
- PASS — unique, cap, append-only, immutable, aggregate insert/delete/group
  move, sum, and deterministic remainder behavior execute under the same
  transaction.
- PASS — receipt-only replay: ordinary local `send` is `predicted`; one held-row
  delete remains complete from the halo and the second is `partial` at
  `thread.messages`; first `@mention` is `partial` only at
  `thread.mentionUser`; server-side membership deletion followed by rehydration
  evicts all message rows.
- PASS — the 256-member unread fan-out increments every counter on every send;
  latency is recorded but not used as an assertion.

## Measurements

- 10,000-message `thread`: **42 actual examined entries** versus a **5,142**
  static maximum (the gap is the worst-case 85 mentions in each of 20 bounded
  256-codepoint bodies); the message range itself examines 22 entries (`take
  20` + halo + N+2); rule probes: **1**.
- Rejected expenses/shares plan: **26,502** total conservative examined entries
  versus the **10,240** ceiling; the named nested population product is
  **25,000**.
- Helper scan: `take=37`, `maxCalls=1`, examined reserve **39**.
- Recursive ancestors: depth 8, fan-out 1, maximum point calls **9**.
- Per-member unread maintenance: **256** counter writes per send, nine measured
  sends, all final counters equal nine. Final debug-test p95: **73,082 µs** on
  this machine. This is a test-harness number, not a product latency claim.
- Final full test run: **12.40 s**; `cargo clippy --all-targets -- -D warnings`
  also passes.

## Ambiguities and restrictive choices

1. LLP 0329.014.000 §6 requires “row N+1 plus the authorized key of N+2,”
   while §2.2's worked certificate arithmetic generally reserves only
   `take+1`. This spike treats obtaining the N+2 key as an examined entry and
   statically reserves `take+2`. That is safer but makes certificates larger.

2. LLP 0329.014.000 §4.2 describes `scan` as `Page<Row,N>` but does not say
   whether hidden rows consume `take`. Letting invisible population size decide
   work would contradict §5 (“never functions of invisible-row counts”). This
   spike therefore caps raw index entries at `take+2`; hidden rows consume the
   budget and can yield fewer than N visible rows. The product semantics need an
   explicit ruling.

3. LLP 0329.014.000 §6 says receipts contain “visible ranges” and “no hidden
   range extents” but does not define the proof for a range under a nonuniform
   row rule. This spike ships an extent only when every examined candidate was
   readable. Otherwise it ships readable rows/verdicts but no stop, absence,
   halo, or range fact, so local replay becomes partial rather than leaking
   cardinality.

4. LLP 0329.014.000 §3 gives one predicate per write effect, while the spike
   brief says write rules are checked against old and new rows. There is no
   binding syntax for both. This spike evaluates the same update predicate once
   on the preimage and once on the postimage; insert uses only new and delete
   only old. `upsert` chooses the corresponding path and its certificate
   reserves the more expensive rule path.

5. LLP 0329.014.000 §2 specifies aggregate grouping and target names but not
   the physical target-row shape or id. This spike uses a canonical JSON group
   tuple as `id`, repeats group columns, and stores the scalar as `value`.
   Same-transaction and retry-by-transaction behavior is implemented; online
   backfill/cutover is outside S1. For an omitted aggregate `readable`, the
   spike does not implement a general logical implication proof between source
   and aggregate rules; fixtures use public sources/targets, while the security
   test uses an explicit declaration.

6. LLP 0329.014.000 §4.2 does not state whether recursion depth includes the
   seed. This spike includes it: the bound is `1 + F + ... + F^D`, uses a visited
   set, and refuses a step returning more than F successors.

7. LLP 0329.014.000 §4.2 leaves `after`/`before` cursor meaning under descending
   order implicit. This spike interprets cursor inequalities in ascending index
   key space and applies direction only to result ordering. A production spec
   should define directional cursor semantics explicitly.

8. LLP 0329.014.000 §4.4 distinguishes a structural resource count from a
   caller-scoped count, but the IR has no explicit marker for that intent. The
   checker uses a restrictive proof: a page count/sum is admitted only when the
   read rule is public or all row fields used by the rule are pinned by the scan
   prefix; otherwise it emits `E_STRUCTURAL_COUNT`. This is sound for the spike
   fixtures but not a complete rule-implication algorithm.

9. LLP 0329.014.000 §4.3 says `now`/`newId` are validated by the server. The
   interpreter consumes only pinned context values and a finite new-id queue,
   which proves replay identity, but S1 has no id-format or clock-skew validator.

10. LLP 0329.014.000 §4.5 says integer money uses deterministic `divmod` but is
    silent on negative allocations. Generic `divmod` uses Euclidean division;
    the expense allocator restricts its intended use to non-negative minor-unit
    amounts and gives remainder units to lexicographically sorted recipient ids.

## Known S1 limits

- No TypeScript front end, client cross-engine corpus, WASM measurement,
  Postgres lowering, scheduler, channels, effects, online aggregate backfill,
  encryption, outbox settlement, or persisted auth epochs; those are outside
  the S1 brief.
- `maxSteps`, examined/index entries, rule probes, writes, constraints, and
  maintenance amplification are real static bounds. Heap/output/closure byte
  fields are deliberately coarse estimates in this spike, not a production
  allocator or serializer proof.
- The generic SQLite index table supports up to eight scalar key columns. JSON,
  rows, arrays, and maps are rejected as index keys, consistent with JSON being
  opaque in v0.
- Range/constraint tracing is sufficient for the S1 subset and subset
  assertions, but no OCC or subscription invalidation engine consumes it yet.
