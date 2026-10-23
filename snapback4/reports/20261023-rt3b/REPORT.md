# RT3b — authority boundaries (2026-10-23)

Lane `sb4-pg/rt3b`, base `f9d714d4a2`, expo-build-450b. Local commits only.
Raw command output and temporary process custody records stay outside Git.

The governing constraints are LLP 3000.009.001.000.001 §3.1, §3.5 and §7;
committer §3.6–3.7; store-port §5. Authority policy remains in Rust, owner
and head locks retain their order, and COMMIT remains a separate command.
No pre-execution or batching implementation is claimed by this lane.

## Commit 1 — reader ingress

Prediction before coding: every warm RT0 cell remains at RT3a. Only the
connection used by non-detached mutation ingress changes; no statement is
removed. The ingress may refuse without joining the writer queue, and all
later authority checks remain for this commit.

| Class | SQLite predicted | SQLite measured | Postgres predicted | Postgres measured |
| --- | ---: | ---: | ---: | ---: |
| action_session_w1 | 28 | 28 | 22 | 22 |
| keyed_first | 40 | 40 | 46 | 46 |
| narrowed_argument | 17 | 17 | 13 | 13 |
| one_membership | 33 | 33 | 27 | 27 |
| rate_limited | 0 | 0 | 0 | 0 |
| replay_hit | 19 | 19 | 21 | 21 |
| unauthenticated | 0 | 0 | 0 | 0 |
| unkeyed_increment | 32 | 32 | 26 | 26 |
| unknown_operation | 17 | 17 | 13 | 13 |
| unknown_token | 3 | 3 | 3 | 3 |
| w1_point | 16 | 16 | 12 | 12 |
| w2_newest20 | 16 | 16 | 12 | 12 |

Validation: `cargo build -p snapback4`, both RT0 ratchets (three equal warm samples per class), and all four SQLite/Postgres queued-authority and ingress witnesses pass. Every cell matches its unchanged prediction. The new ingress witness holds the writer until the unauthenticated refusal arrives and asserts no writer waiter and no store metadata.

## Commit 2 — reader preflight only when needed

Prediction before coding: keep route and final authority checks for this
increment. Combine keyed preflight authority, identity/head/generation and bound
receipt in one reader snapshot. Skip successful unkeyed preflight. Metadata
refusals authenticate in their own preflight snapshot.

| Class | SQLite predicted | Postgres predicted |
| --- | ---: | ---: |
| action_session_w1 | 28 | 22 |
| keyed_first | 39 | 39 |
| narrowed_argument | 9 | 9 |
| one_membership | 30 | 24 |
| rate_limited | 0 | 0 |
| replay_hit | 10 | 10 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 29 | 23 |
| unknown_operation | 9 | 9 |
| unknown_token | 3 | 3 |
| w1_point | 16 | 12 |
| w2_newest20 | 16 | 12 |

Unkeyed success loses its three-statement preflight authority snapshot. Keyed
first combines five SQLite statements / eleven Postgres flights into four.
Replay replaces those plus the separate eight/four-statement metadata read
with four. Unknown operation and bad arguments retain ingress and route (six)
plus the three-statement authenticated refusal snapshot. Other cells retain
their paths and counts.

All predictions match measured counts exactly (three equal warm samples per
class). The small `preflight-sqlite.json` and `preflight-postgres.json` files
record the complete measured tables. Final build, both lowered ratchets, all
four authority witnesses and the normal 206-case serving regression scope pass.
The latency witness now counts the three readers used by its concurrent keyed
write as well as the poll's two; the poll's own timing assertion is unchanged.
An exploratory `--include-ignored` serving sweep also invoked three opt-in
fixtures without their required input variables; those are not standalone
checks. It found two affected regressions (delivery-refusal precedence and the
reader-count assertion), both repaired and green in the normal repeat.

## Commit 3 — final authority belongs to execution

Prediction before coding: remove route resolution and the standalone writer
resolution; resolve within the durable/query snapshot instead. Keep ingress
framing for this increment. Skip the engine's duplicate preflight receipt read
for host-admitted mutations, retain the serial re-check, and take intent-store
identity from the transaction authority projection.

| Class | SQLite predicted | Postgres predicted |
| --- | ---: | ---: |
| action_session_w1 | 25 | 19 |
| keyed_first | 32 | 26 |
| narrowed_argument | 6 | 6 |
| one_membership | 25 | 19 |
| rate_limited | 0 | 0 |
| replay_hit | 7 | 7 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 24 | 18 |
| unknown_operation | 6 | 6 |
| unknown_token | 3 | 3 |
| w1_point | 13 | 9 |
| w2_newest20 | 13 | 9 |

Every ordinary route loses three statements. Mutations additionally replace
three writer-authority statements with one in-transaction statement. Keyed
first loses one/four intent-store statements and one/four duplicate engine
replay statements (SQLite/Postgres). Reads replace the separate response-id
statement with the in-snapshot authority statement. Action W1 loses its full
nine/eight-statement route resolution and adds seven/six in-snapshot authority
statements while removing the response-id read. Rate-limit/unauthenticated and
unknown-token ingress paths are unchanged. Ingress autocommit will remove two
more flights for ordinary classes in the next increment, reaching 16/7 on
Postgres unkeyed/W1; keyed first will still pay separate receipt writes and
placement, which the B1 table expects a later tail increment to combine.

The execution-boundary checkpoint matches every prediction above; both
`boundary-*.json` summaries retain it. The initial RT3b witness groups pass on
both stores, as do both ratchets and all four retained authority witnesses.
A highly parallel serving sweep hit the existing three-second socket guard in
the 18-client committer stress test; it is rerun in isolation and final Rust
suites use eight test threads to avoid oversubscribing the fixture hosts.

**Refined final prediction, before the ingress opener change.** Finish the
same commit with one autocommit facts SELECT for ordinary ingress. An action
credential first needs that projection to discover its kind, then opens the
complete resolver snapshot (the first facts are discarded); this adds one
statement to that checkpoint's action row. Across the complete commit every
class still falls or holds relative to commit 2. Ordinary classes remove
BEGIN/ROLLBACK at ingress; unauthenticated/rate-limited remain zero.

| Class | SQLite final predicted | Postgres final predicted |
| --- | ---: | ---: |
| action_session_w1 | 26 | 20 |
| keyed_first | 30 | 24 |
| narrowed_argument | 4 | 4 |
| one_membership | 23 | 17 |
| rate_limited | 0 | 0 |
| replay_hit | 5 | 5 |
| unauthenticated | 0 | 0 |
| unkeyed_increment | 22 | 16 |
| unknown_operation | 4 | 4 |
| unknown_token | 1 | 1 |
| w1_point | 11 | 7 |
| w2_newest20 | 11 | 7 |

The final measurements exactly match the refined table, with three equal warm
samples each. `final-sqlite.json` and `final-postgres.json` contain all cells.
Relative to commit 2, every class decreases or holds. The action row is 26/20
(28/22 before this commit), because it discovers a non-ordinary credential,
discards the probe and resolves the complete claim walk in a fresh snapshot.
The intermediate checkpoint is retained rather than presented as another commit.

The Postgres unkeyed/W1 RT3 targets (16/7) are reached. W1's remaining separate
reader-generation command belongs to RT4 (7→6). Keyed first is 24 rather than
the §4 B1 prediction of 21: one asset-placement read and two receipt writes are
still separate commands. RT6's ordered setup/tail flights absorb their waits;
this lane does not change their semantics or introduce the flight mechanism.
SQLite retains its four application-opener identity-marker reads in addition
to the common structure, explaining its larger read/mutation counts.

Postgres qualification runs the existing `bash scripts/test-postgres.sh` with
an ephemeral cargo wrapper: every cargo process receives the assigned absolute
target, both line-tables-only profiles and eight build jobs. The shell script's
optional shared-target `cargo clean` is disabled because this lane may not
delete pre-existing warm artifacts. No other target or repository configuration
is changed; both independent manifests and all substantive checks still run.

At a manifest handoff, the wrapper invalidates the three path crates by changing
only their source timestamps, forcing Cargo to rebuild their identities without
deleting warm artifacts. This repaired an actual shared-target duplicate-crate
identity error encountered during qualification. No source content or Cargo
configuration changes are needed for that repair.

## Final command accounting

All final predictions equal the measured tables. These are warm request counts,
not wall-clock timings; cold connection construction remains a separate RT0
observation. Counters keep their original request attribution and thresholds.

| Class | Reader ingress: predicted = measured, SQLite / PG | Reader preflight: predicted = measured, SQLite / PG | Final boundary: predicted = measured, SQLite / PG |
| --- | ---: | ---: | ---: |
| action_session_w1 | 28 / 22 | 28 / 22 | 26 / 20 |
| keyed_first | 40 / 46 | 39 / 39 | 30 / 24 |
| narrowed_argument | 17 / 13 | 9 / 9 | 4 / 4 |
| one_membership | 33 / 27 | 30 / 24 | 23 / 17 |
| rate_limited | 0 / 0 | 0 / 0 | 0 / 0 |
| replay_hit | 19 / 21 | 10 / 10 | 5 / 5 |
| unauthenticated | 0 / 0 | 0 / 0 | 0 / 0 |
| unkeyed_increment | 32 / 26 | 29 / 23 | 22 / 16 |
| unknown_operation | 17 / 13 | 9 / 9 | 4 / 4 |
| unknown_token | 3 / 3 | 3 / 3 | 1 / 1 |
| w1_point | 16 / 12 | 16 / 12 | 11 / 7 |
| w2_newest20 | 16 / 12 | 16 / 12 | 11 / 7 |

The remaining Postgres schedules explain each final cell:

- Ordinary ingress: one autocommit facts SELECT. Unknown tokens stop there (1).
  Missing credentials and identity rate limiting stop before SQL (0).
- Metadata refusal: ingress (1), BEGIN, authority/store/head/generation facts,
  ROLLBACK (3), totaling 4 for unknown operation and narrowed arguments.
- Replay hit: ingress (1), BEGIN, facts, bound receipt, ROLLBACK (4), totaling 5.
  Store binding and receipt judgment occur in memory, in that order.
- W1 and W2: ingress, BEGIN, reader generation/head, authority/store id, rows,
  membership, ROLLBACK: 7. The row query differs but each uses one command.
- Unkeyed increment: ingress (1), then BEGIN, owner fence, head lock,
  generation, member SAVEPOINT, authority/store id, program SAVEPOINT,
  three program commands, program RELEASE, durable tail, member RELEASE,
  SET LOCAL batch, COMMIT (15): 16. The owner and head locks, receipt and
  COMMIT remain separate commands.
- One membership adds one lookup to unkeyed increment: 17.
- Keyed first adds preflight (4), the serial bound receipt (1), asset placement
  (1) and receipt INSERT/binding UPDATE (2) to unkeyed increment: 24.
- Action W1 retains the complete resolver's claim/work/session checks: the
  discarded ingress probe plus its full snapshot adds eight over ordinary
  ingress, and the in-query complete resolver adds five over one facts SELECT.
  Thus 7 + 8 + 5 = 20. No action authority is inferred by the probe.

SQLite follows the same boundaries. Its metadata refusals, replay, missing
credentials and unknown-token paths have the same counts. Its query opener
retains four identity-marker reads, so W1/W2 are 7 + 4 = 11. Compared with
Postgres's durable path, SQLite's four identity-marker reads, separate
head/sequence observation and separately executed row/tail bookkeeping add six
net statements, giving unkeyed 22, membership 23 and keyed 30. The action path's
complete ingress resolver adds nine over ordinary ingress, and its query
resolver adds six: 11 + 9 + 6 = 26. This explains every cell; the per-increment
sections above account for each removal relative to its previous commit.

## Correctness witnesses

`tests/serve_authority/mod.rs` runs four groups per adapter (eight groups total),
using real TCP requests and either a private SQLite file or a private Postgres
namespace. The same assertions execute on both stores. The queue matrix includes
unkeyed first attempts, keyed misses, stored replays and a concurrent copy that
commits after another copy's preflight miss.

| Required constraint | Witness and observed behavior |
| --- | --- |
| Fresh authority during upload | Partial body held after ingress; revoke; finish upload. First attempt and replay both return 401, no store metadata, no additional application. |
| Fresh authority while queued | Revoke, exact expiry, and replacement supervised family during the real writer wait; first attempts, replay and concurrent stored copy refuse 401 without store metadata. Replay waits before its reader snapshot. Keyed/unkeyed misses and a concurrent stored copy whose scope changes refuse retryable 503 without store metadata. |
| Store binding before replay | Wrong store before preflight and replacement during queued execution/replay return `E_STORE_REPLACED`; no receipt is disclosed. |
| Bound id reuse | Same id with another name or other raw arguments returns `E_ID_REUSED`. |
| Replay before judgment | Stored outcome survives rename, argument narrowing and ephemeral conversion, even with now-invalid delivery input. A historical ephemeral retry revoked before preflight instead refuses 401. |
| Ownership loss | Replay answers after idle readers are cleared, including actual Postgres owner-token mismatch. Fresh keyed intent returns retryable 503 and records no receipt. |
| Concurrent copies / member isolation | Both copies miss preflight; exactly one applies, the other replays the same sequence. Core bound-hit witnesses roll back only the duplicate member and retain the previous receipt/head and a later member, on both stores. |
| No cross-request authority cache | Reuse of pooled readers after revocation, expiry and family replacement still refuses; each boundary fetches live facts. |
| Snapshot consistency | Query revocation/expiry, changed scope (retryable stale refusal), and adoption during metadata-refusal checkout. The latter re-judges the successor program instead of stamping an obsolete refusal with successor metadata. Existing adoption/store regressions also remain. |
| Owner fence order | Existing Postgres `owner_fence_precedes_the_head_lock`, identity head-fence and committer tests remain green. Cold readers use read-only bootstrap, no owner fence, and raw UPDATE fails `25006`. |
| COMMIT outcome classification | Existing `commit_connection_loss_is_unknown_and_propagates_through_engine`, `committed_receipt_survives_lost_commit_acknowledgement`, timeout and warning witnesses remain green. Unknown outcomes carry no durable publication metadata; COMMIT stays separate. |
| Both-store policy equivalence | The generated authority matrix covers 3,456 states per adapter with one facts SELECT each, plus the shared store contracts and corpus tests. |

The existing `tests/serve_adoption/authority.rs` tests and
`tests/serve_store/mod.rs` regressions pass. Early online-only authentication
refusals retain the existing HTTP 200 `failed` envelope, with no store id/head
or automatic generation stamp. The strengthened ephemeral regression checks
that privacy property, while the security campaign checks its established
HTTP status. Application-defined `E_AUTH` outside the auth family is unaffected.

An authority storage error is also an unauthenticated cut. The query callback
records that error before unwinding; it cannot fall back to an unrelated head
snapshot or the cached generation stamp. A duplicated full/read session
introduced while the query waits exercises this on both stores: 503, no data,
store id, head or generation. A query opener failure likewise supplies only
its original refusal until an authority snapshot has actually succeeded.
The same storage-error witness covers a keyed first attempt, stored replay and
unkeyed argument refusal in preflight. Preflight outcomes carry their snapshot
generation explicitly, including receipt hits and binding errors. The checkout /
adoption witness also covers a historical keyed replay, whose fresh generation
must override the generation observed when its HTTP request began.

## Qualification

All Cargo commands use the assigned warm `snapback4/target`, eight build jobs
and the two `line-tables-only` debug profiles. Runtime test concurrency is eight;
Cargo commands are serialized. No check threshold, timeout or ratchet is raised.

The complete core suite passes **1,091 tests, five ignored**. It completed before
the later Postgres-only cold-reader repair and two member tests; the affected
Postgres engine suite subsequently passes **222**, and the final cold-reader /
both-store member filter passes **three**. The shared authority matrix repeat
passes five tests (3,456 generated states for each store). Those later changes
do not affect the default non-Postgres core runtime.

The complete CLI repeat finishes all **59 targets: 1,436 passed, four failed,
26 ignored**. Its **542 unit tests pass**. Only the supplied reservation-fixture
family remains red:

| Target | Test | Failure |
| --- | --- | --- |
| `init` | `w7a_residency_measures_the_wired_500_follow_reader` | `E_SCHEMA`: source reservations differ from the schema derivation |
| `init` | `w8b_residency_measures_the_wired_calibration_shape` | Same |
| `timeline_adoption` | `retirement_resets_dependent_aggregates_even_when_all_names_survive` | Same |
| `timeline_adoption` | `check_and_adoption_agree_across_expiry_through_changes_and_following_presence` | Same |

No clean full-CLI claim is made. The first broad repeat also hit a 30-second
clock socket timeout and the run-admission startup guard; both pass alone and
in the complete repeat. A late envelope experiment changed online-only auth
to 401 and broke two established ephemeral/security tests. Restoring its
HTTP 200 contract while removing unauthenticated metadata repairs both;
all ephemeral cases and the full security campaign pass in the complete repeat.
The final query-error guard and duplicate-authority witness are subsequently
qualified by the affected host repeat recorded below.

The store-port ratchet initially exposed raw driver-error construction in the
authority policy layer, including the inherited RT3a duplicate-session path.
The same strict duplicate error is now constructed behind the typed store port,
shared by both resolver paths. All seven ratchet cases pass; no allowance changes.

The complete Postgres script finishes every stage: **398 Rust passes, two
failures**, plus passing public serving, restart/takeover, release adoption and
P1-MC. The two broad-run failures are the supplied Serializable stress signature
(`40001`) and `two_owners_stale_token_refuses_without_a_receipt`, whose short
lease expired before its standby check. Both pass alone afterward. The exact
script-built evaluator binary retains 65 increments in both modes, no lost
updates, and 0 Serialized / 88 Serializable retries. The lease witness passes
alone in 1.07 seconds. The earlier complete script had only the Serializable
red; its ownership group passed. No clean complete-script claim is made.

A later whole-unit repeat also hit the existing stalled-resolver fixture's
three-second deadline before `descendant.pid` appeared. That test passed in the
complete CLI run and passes its exact isolated repeat. Its production code and
deadline are unchanged. The final affected checks below all pass.

| Required / affected check | Final result |
| --- | --- |
| `cargo build -p snapback4` | Pass after final source changes |
| `cargo check -p snapback4-core --no-default-features` | Pass |
| `cargo test -p snapback4-core --no-fail-fast` | 1,091 pass / five ignored at the documented checkpoint; later affected core witnesses pass |
| `cargo test -p snapback4 --no-fail-fast` | 1,436 pass / four supplied reservation-fixture failures / 26 ignored; final affected repeats pass |
| Both RT0 ratchets | Pass; all twelve classes per store equal prediction, three identical warm samples; no allowance raised |
| `bash scripts/test-postgres.sh` | Complete, with the two broad-run failures above; both isolated repeats pass; public milestones pass |
| Final serving regression scope | 210 pass / 13 opt-in ignores, including all four store regressions |
| Final SQLite/Postgres RT3b HTTP groups | Eight pass, including checkout/adoption replay generation and all preflight/query storage-error cases |
| Retained `serve_adoption/authority.rs` | All four SQLite/Postgres tests pass |
| Core member isolation and cold reader | Three pass; Postgres engine regression scope 222 pass |
| Final committer refusal/publication scope | 12 pass, including the named Postgres case |
| Store-port ratchet | All seven pass |

Queue refusals and unknown COMMITs keep their existing status/retry
classification and carry no implicit generation stamp. The committer tests
now also require no store id/head/generation or generation header on those
refusals. Keyed ownership loss after a preflight miss remains the explicit
retryable 503 exception to the ordinary ownership 409.

`qualification.json` contains small check-count summaries. `first-use-*.json`
records the separately reported first sample of every RT0 class; those are
not the warm ratchet. No raw output, PID list or disk trace is committed.

The closing audit repeats all 210 serving cases, both RT0 ratchets, the eight
dual-store HTTP groups (with the added three mutation scope cases per store),
four retained authority tests, three member/cold-reader tests, five authority
matrix tests, all 12 committer cases and seven port ratchet cases. All pass;
production build, no-default and reference checking also pass. The full-run
counts above exclude nested child-test summaries, so those tests are not
counted twice. No product code changes follow this validation.

All five owned private clusters are stopped and independently confirmed:
`pg_ctl status` returns 3 and no `postmaster.pid` remains. The recorded workload
PID audit finds zero remaining processes. No unrelated cluster was touched,
no pre-existing warm artifact deleted, and no push, stash or Git configuration
change was made. Owned temporary scratch is removed after the summaries are
sealed. The disk floor never tripped.
