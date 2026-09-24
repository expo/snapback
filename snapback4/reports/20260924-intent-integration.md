# LLP 3000.013 integration — 2026-09-24

Branch `sb4-intent/integration`, actual worktree `~/sb4-intent/lane-i`.
The supplied `~/sb4-intent/integration` directory did not exist; the designated
branch was already checked out in lane-i at `56629451c`. No push or publication.

## Merges and conflict resolutions

Every branch was merged at its then-current head with `git merge --no-ff`, in
B, D, G, E, A, C order. A successful `cargo build --workspace` followed every
merge before starting the next. Build logs are
`~/sb4-intent/integration-build-{b,d,g,e,a,c}.log`.

| Lane / merged head | Merge | Conflicts and resolution |
|---|---|---|
| B `a0c8098a4` | `74874ca18` | No conflicts. Derived readability and inferred maintained columns. |
| D `c55c36349` | `05b596877` | Journal only: retain both append-only entries. AST/parser changes combined automatically. Streaming aggregates, adaptive jobs and permanent emission keys. |
| G `b104f6c4b` | `4fce97253` | Journal only: retain every entry. Both bounds-card additions survive. Structural scale certificates. |
| E `213a20cdd` | `5d6728366` | Journal only: retain every entry. Guide-test edits compose automatically. App auth, durable custody and the offline shell. |
| A `7dc85b6b7` | `0a6d5820a` | Details below. Predicate planner, synthesized indexes and projected views. |
| C `47ebcf127` | `514f3bda5` | Details below. Durable Following delivery without author caps. |
| D review `2f9afbb13` | `0eab30bea` | Journal and `engine/read.rs`: retain C's prepaid timeline payload scans while adding D's transient key-scratch release, retained cursor reservation, single-candidate adaptive pages and prepaid retained domains. |
| G review `542df62f4` | `b120cccf0` | Journal only; preserve all entries. The new refused-write witness combines automatically with the named-key fixtures. |
| E review `4e21d8688` | `b01b6cacf` | Journal only; preserve all entries. Conditional auth restoration and cached exported-page routing combine without source conflicts. |

The three available review-fix heads were incorporated incrementally after the
first complete run. Each was followed by a successful workspace build before
the next merge; logs end in `integration-build-{d,g,e}-review.log`. Their external
reports were `lane-d.r4.final.md`, `lane-g.r3.final.md` and `lane-e.r3.final.md`.
Committed follow-up reports are [work round 2](20260924-intent-work-r2.md) and
[client delta](20260924-lane-e-delta.md); G records its witness in the journal.

A conflicts, file by file:

- `crates/snapback4-lang/src/bind/catalog.rs`: initialize A's planning maps and
  synthesized-index state, then run B's guarded derived-rule inference.
- `src/bind/program.rs`: retain A's original predicate spelling in diagnostics
  and D's mutable scan upgraded to streaming only under its existing admission.
- `src/bind/program/prefix.rs`: combine intent-seek recognition with D's
  aggregate/existence/job-domain exceptions. Ordinary admission still applies.
- `src/parser.rs`: aggregate views use B's optional read clause and derived
  readability; omit A's temporary default-deny placeholder.
- `src/parser/expr.rs`: keep D's domain-only `exists` restriction and filtered
  existence. Preserve A's read parser and named-key semantics.
- `src/guide/codes.rs`: keep both lanes' codes and explanations.
- `tests/guide.rs`: five compiled blocks, keeping intent and streaming examples.
- `tests/prefix_reads.rs`: use A's named-key spellings while keeping D's admitted
  inner job domains and refusal of paged `exists`.
- `metrics/wasm-budget.json`: concatenate both independent measurement histories;
  retain A's larger interim ratchet pending the integrated measurement.
- `JOURNAL.md`: preserve every entry.
- Build correction in `src/bind/program/control.rs`, `src/bind/program/expr.rs`
  and `src/parser/expr.rs`: initialize A's added `order_keys` and `computed`
  fields in D's bare-table ReadExpr constructors.

C conflicts, file by file:

- `crates/snapback4-core/src/engine/components.rs`: preserve D's scalar-visible
  coverage method and C's pending-delivery coverage bit.
- `src/engine/read.rs`: metered payload means word scans **or** internal timeline
  transitions. Combine that with streaming and adaptive-page prepaid fetches,
  transient row release, no adaptive lookahead, and D's interrupted-scalar
  handling. C's pending-feed continuation behavior remains.
- `src/engine/runner.rs`: retain both A's value-discovery flags and C's timeline
  pending flag, including all constructor initializers.
- `crates/snapback4/tests/timeline/admission.rs`: remove the obsolete cap-required
  cases explicitly superseded by C; retain every authority and shape refusal.
- `JOURNAL.md`: preserve every entry.

The external final reports and committed reports were read before their merges.
B and G contain no lane-specific committed `reports/` document; their committed
journal entries and external final reports supply that record. Other inventories:
[planner](20260924-intent-lane-a.md), [work](20260924-intent-work.md),
[work review](20260924-intent-work-r1.md), [client](20260924-lane-e-client.md),
[client review](20260924-lane-e-review2.md),
[Following](20260924-following-v2/report.md),
[Following review](20260924-following-v2/review-round2.md).

## Cross-lane changes, file by file

Paths are relative to `snapback4/`.

| File | Integration change |
|---|---|
| `crates/snapback4-lang/src/bind/intent_walk.rs` | Plan reads inside `emit … once` keys, including nested streaming predicates. |
| `crates/snapback4-lang/tests/prefix_reads.rs` | Preserve the domain-only matching-existence diagnostic and compile its exact rewrite. |
| `crates/snapback4/src/scale.rs` | Traverse projected-lane guards, distinct keys, cursor expressions and per-candidate projections; price projected eager scans at page+1. Count once-key reads and writes. Bound automatic top-level sweeps at 64 per chunk while retaining whole-job growth. |
| `crates/snapback4/src/scale/dependencies.rs` | Follow the same new IR expressions during dependency propagation. |
| `crates/snapback4/src/scale/display.rs` | Bound common clock-relative bucket ranges through the floor/ceiling relation; unknown ranges retain the meter allowance. |
| `crates/snapback4/tests/scale.rs` | Remove generated purge jobs that C intentionally replaces with durable internal work. |
| `crates/snapback4/tests/scale/witnesses.rs` | Name the intended grant columns in G's formerly ambiguous one-key fixtures; the authority and meter assertions remain. |
| `crates/snapback4-device/tests/readauth/census.txt` | Refresh only the inspected feeds-card occurrence changes; retain read-rule and prediction evidence. |
| `crates/snapback4/tests/scale_intent.rs` | Six cross-lane certificate tests, described below. |
| `crates/snapback4-sim/tests/fixtures/intent-clique.q` | Exact supplied target except deferred Following/home and the requested Trending upper bound. |
| `crates/snapback4-sim/tests/intent_integration.rs` | Two executable target scenarios, including streamed predicates, authorized search, restart and once-key persistence. |
| `metrics/wasm-budget.json` | Combined measurement and justified 485,000-byte gzip ratchet. |
| `JOURNAL.md` | One dated integration entry with measurements and exclusions. |
| `reports/20260924-intent-integration.md` | This handoff and verification record. |

## Forms and target status

The integrated fixture compiles with **zero diagnostics**. Its six advisory notes
are three N_NO_HORIZON notes (messages, profiles, reposts), N_NO_CURSOR for the
requested top-10 Trending query, N_MAINTAIN_SYNCED for the nine aggregates, and
N_MAINTAINED_COLUMN_STREAM for posts. No note was suppressed to make it pass.

| Form | Running example and evidence |
|---|---|
| Synthesized schema indexes | `unique handle`, `search displayName, handle`, `cap 50 by conversationId`, `expire at .expiresAt`, `sync to members[.conversationId]`; target compiles with no authored indexes. |
| Predicate page | `posts where .authorId = owner and .parentId = null last 20 by .at after c`; userPosts runs. |
| Reference thread | `posts where .parentId = postId first 20 by .at after c`; thread returns the reply. |
| Finite Trending | `posts where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at postCard`; runs through bucketed lanes. |
| Planned union | `view activity:` with posts/reposts projections; Global retains equal source ids from both tables and shapes their author/post/counts. |
| Derived views | All nine target declarations run: replyCount, followerCount, followingCount, receivedLikes, dailyLikes, receivedReplies, receivedReposts, originalPosts, dailyPosts. Example: `view receivedLikes: count likes by .postId.authorId`. |
| In-table count inference | `likeCount: count likes` and `repostCount: count reposts`; both return one on the test post. |
| Point lookup / named unique | `posts[.post]`, `profiles[principal = .actor]`; both shape Global. |
| Search | `profiles matching q last 20 by .createdAt after c`; people finds Alice. `messages matching q where exists members[.conversationId, viewer] and not .tombstone last 20 by .at after c`; searchAll excludes the hidden chat. |
| History | `messages where .conversationId = conversationId last 50 by .ordinal after c`; returns 50 rows with continuation. |
| Insights | Nine aggregate reads plus seven calendar buckets; asserted totals include received likes/replies/reposts and both follow directions. |
| Mutations | createPost, setLike and setFollow execute under their author rules. |
| Streaming predicate count | `count(messages where .conversationId = c and .at >= s and .at < e and not .tombstone)`; exact authorized total, expiry, endpoints and a meter-cut null result are asserted. |
| Automatic sweep / once | `for p in profiles:` and `emit push { … } once [p.principal, periodEnd]`; target daily completes across reopen and rerun emits no duplicates. |
| Following/home | Deferred exactly as commissioned. The full target's `view following: activity …` reports E_VIEW_FEED_PENDING at schema.q:79:1; its dependent `home` query reports E_QUARRY_UNKNOWN at schema.q:95:10 for unknown table following. Existing `maintain feed: timeline` executes the merged v2 engine. |
| Client app and shell | E's `createApp({ url, device, sessionStore })`, `AppProvider`, `useAuth()` and `snapback4 web-shell dist` are merged; their integration qualification is the full client suite. |

## Added tests and measurements

`cargo test -p snapback4 --test scale_intent`:

1. `projected_lane_prices_candidate_projections_before_page_truncation`: first-2
   projects three candidates and accounts for its nested point reads; certificate
   permits seven examined rows, not just the final two.
2. `cross_table_certificate_accounts_for_each_source_rule`: two pinned source
   tables certify 14 rows; unpinned sources independently produce growth reasons.
   Actual examined/probe meters stay within the allowances.
3. `bucketed_rank_has_fixed_lane_count_but_residual_work_grows`: a 24-hour window
   has 25 possible lanes, but exact time residuals remain population-dependent.
4. `streaming_total_is_population_work_even_without_page_retention`: streaming
   returns 30 and remains classified as growing work.
5. `automatic_sweep_is_bounded_per_chunk_and_grows_over_the_whole_job`: automatic
   jobs permit 64 keyed writes per chunk, conservatively 66 examined rows,
   and explicitly identify whole-job population growth.
6. `once_key_predicates_are_planned_and_counted`: an unindexed predicate in an
   emit key plans, streams and executes, and its scan and permanent write are
   included in the certificate.

`cargo test -p snapback4-sim --test intent_integration -- --nocapture`:

1. `target_queries_and_nine_derived_views_run_together`: all nine derived rules,
   maintained parent columns, equal-id union branches, point shapes, Global,
   Trending, userPosts, thread, people and insights on the actual target.
2. `predicate_stream_and_target_digest_sweep_preserve_authority_restart_and_once`:
   67 profiles, 5,000 period rows, a hidden chat, expired/tombstoned/out-of-window
   rows; an exact 4,949-row count, unauthorized zero, metered null, authorized
   history/search, durable chunk resumption and lifetime emission deduplication.
   Alice receives 4,899 unread messages; Bob 4,949; both have one unread chat.

Measured final target digest: **two chunks, K=64, zero retries, 311,014 B peak
heap**, down from 6,612,305 B before D's follow-up. Streaming count reports
**650 B** retained heap after transient release (this query field is not a
peak measurement), previously 3,179,166 B. The runtime limit remains
16,777,216 B. D's original retained recipient-heavy fixture measures 370,216 B
peak; the ordinal variant measures 372,756 B. All 24 focused tests pass: the
original digest, 12 work, five first-review, four second-review and two target
tests. D's 16,370-row wide-key fixture measures 22,233 B peak and its denied-row,
prepaid-decode and non-uniform adaptive-page regressions pass. Focused language
validation before the follow-up merges: 11 derived, 21 intent, 55 guide and
10 prefix tests pass. The complete run below rechecks these and all 17 existing
plus six new scale tests.

Final WASM: **1,743,957 B raw / 484,640 B gzip**, Rust 1.97.0,
wasm-bindgen 0.2.127, without wasm-opt. Same-host baseline:
1,707,362 / 472,890; delta +36,595 raw / +11,750 gzip. A alone:
1,735,736 / 480,624; delta +8,221 / +4,016. The initial integrated artifact was
1,742,590 / 483,983; D's follow-up adds +1,367 / +657. The inherited
481,000-byte ratchet is exceeded by 3,640; the next 1,000-byte step is **485,000**,
leaving 360 bytes. These are whole-artifact measurements, not feature attribution.

## Baseline audit and complete suite

The four original main failures were stale expectations, not runtime regressions:

- **schema_capabilities_legacy:** the baseline log's two Schema values compare
  equal after removing only `site` and `reason` strings. All structural schema
  and capability fields agree. The new compiler intentionally explains selected
  keys/results. C also intentionally changes v1 to v2 owned shapes, so its
  merged test asserts that difference, strict capability serialization and
  refusal of old stores. The historical fixture remains unchanged.
- **uniform_word_expansion:** A's fixture refresh changes 48 diagnostic reasons
  and two named-key site spellings. Every executable program and authorized
  snapshot page is unchanged. The actual generator must still match in the
  suite; no comparison was weakened.
- **check.rs w9b:** `877bcaaa2` intentionally adds selected index, bound keys,
  result shape and selection reason. A's merged expectation preserves those
  details along with the previous residency/cost assertions.
- **readauth census:** the initial main difference came from new compiled feeds
  and attribution examples. A accounts for those. The integrated remaining
  delta is confined to feeds-card membership: C inserted a new first block,
  shifting later blocks; B made the previously optional-read example compile.
  Every changed row was inspected with its compiled example. The expected
  census is refreshed to those actual occurrences; authority assertions and
  private read-rule strings remain. All 80 behavioral companions passed in
  the first full run.

First complete run: **`== 1 failure(s) in 730 s`**, category `cargo test`.
The sole failed test was `readauth::census::authoring_census`: an integration
expectation mismatch in the already-baselined census family, corrected in
`a3944aaf1` after reviewing the delta. All 1,066 client tests passed, with ten
skips; no intermittent client failure occurred. Log:
`~/sb4-intent/integration-suite-1.log`.

Final complete run after the review-fix merges: **`== 0 failure(s) in 307 s`**,
exit 0. Every stage passed: workspace build, WASM build/budget, docs budget,
release guard, package typecheck/build, chat check, Rust tests, chat/Expo
typechecks, fixture wrappers and client tests. Rust took 284 seconds; client
tests took 168 seconds and totaled **1,075 passed, zero failed, ten skipped**
across the eight processes. All four named baseline tests pass, including all
81 readauth tests, 68 CLI check tests, 17 scale tests and six new scale tests.
There are **no remaining integration, baseline or environmental failures in
this run**. Log: `~/sb4-intent/integration-suite-final.log`.

The W5c process acquisition case reported as timing-sensitive by E also passes
alone on this final integration tree: **1 passed, zero failed**, with no timing
modification or retry inside the test:

```sh
node --test --test-name-pattern='W5c process: pending writes recover' packages/snapback4/test/acquisition.test.mjs
```

Its failure did not reproduce. Log:
`~/sb4-intent/integration-client-intermittent-rerun.log`. The fixture remains
unchanged; E's prior scheduling counterexample is described in its linked delta
report. In a disposable copy, inserting `await sleep(1500)` immediately before
that case's first `await client.close()` reproduced `sent` instead of `pending`
in E's investigation: `/probe` and `/m/*` remain available while `/sync` is
blocked. That historical test timing sensitivity remains unmodified; no
intermittent client failure occurred in either integration suite.

Reference audit: `ref-check: ok — 504 LLP docs, 9226 refs in 25495 files,
0 errors, 0 unchecked`. All changed source files are at most 1,500 lines; every
lane's journal is preserved as an ordered subsequence of the integrated journal.

## Scope and limitations

No authorization, disclosure, durability or runtime meter ceiling was relaxed.
No new refusal code or replacement language design was introduced. Following
view recognition remains assigned to C; the merge table records the final
available heads incorporated here. Reproduce its two diagnostics by copying
`~/sb4-intent/target-clique.q` into an empty app's `snapback/schema.q`, adding
Trending's `.at <= now`, and running this tree's `target/debug/snapback4 check
--json` from that app directory. Output is recorded in
`~/sb4-intent/integration-following-pending.json`. No other target form is blocked.

The named integration directory was absent, so the existing branch/worktree was
used. The llp-orient symlink points into an absent vendor checkout; orientation
used the mandated RFC, command sheet, scope file, applicable guide cards and lane
reports directly. Local git committer identity was unset; each commit command
sets the instructed GPT-6 Astra identity without changing shared git config.
The nearly full shared disk prompted debug-symbol-free native builds and
non-incremental artifacts in this worktree's own target directory. Runtime
ceilings and production build configuration are unchanged. JS dependencies were
installed with `bun install --frozen-lockfile`; the first full run used serial
client files to reduce contention. The final run uses the script's ordinary
load-aware parallelism after host load fell below two on 96 CPUs. Both runs
limit Rust test processes and build jobs to 12.

No push, package publication, external worker/provider delivery, new browser or
native-device witness, full calibration or performance-score claim.
