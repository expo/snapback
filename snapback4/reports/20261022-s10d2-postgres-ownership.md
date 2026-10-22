# S10d-2 — store-level Postgres ownership

Scope: LLP 3000.009.001.000 §5 and the thin pre-listener ownership slice of
§3.4. One worker, branch `sb4-pg/s10d2`, no other machines, no push or stash.
Identity and committer implementation files are unchanged.

The common-engine Postgres store creates and validates `_owner` inside its
successful attach/activation. Every later writing transaction takes its
`FOR KEY SHARE` token/id fence before the head fence. An absent owner table
is bootstrapped only during opening; failed opening rolls it back. Legacy
bootstrap serializes its DDL with a transaction advisory lock before taking
the owner fence and head. Fresh creation installs/fences the owner before
core/head writes. A positive acquired token refuses to recreate a lost row. Internal
token-zero opening supports initial construction, and refuses after a real
owner has acquired a positive token. Public serving must acquire explicitly.
SQLite retains its existing file/sidecar ownership and transaction behavior.

`StoreLease::connect` takes a logical store id, a four-hex holder, namespace
and bounded `LeasePolicy`. It validates the owner relation before lease
updates. `acquire` polls on the database clock, claims an expired token with
the prototype's conditional no-op UPDATE under its own lock timeout, then
upgrades to `FOR UPDATE` with a bounded savepoint loop. The claim survives
savepoint rollback. Its watcher observes `pg_blocking_pids` on a separate
connection and can terminate only same-role, same-database blockers with the
exact store tag and token no newer than the claimed token. Unowned/newer
blockers abort takeover. Post-commit hygiene uses the same token bound.
`renew` and `release` use their dedicated connection and token predicates;
none of this lease traffic enters the committer stream.

`AnyStore::open_postgres_owned` attaches the acquired token before opening
any writer and tags the connection. Reader factories retain that token and
logical id. Tags use `sb:<32-hex-store>:<4-hex-holder>:<token>` and fit in 60
bytes at BIGINT max; invalid components refuse before connecting.

Physical COMMIT, including lease commits, runs with local statement timeout
zero. No adapter cancellation races it. A transport/backend loss or other
unclassified COMMIT failure returns typed `CommitOutcomeUnknown`, code
`E_COMMIT_OUTCOME_UNKNOWN`. A cancelled synchronous-replication warning also
returns unknown and never an acknowledgement. Explicit serialization,
deadlock and constraint aborts retain their driver error. Unknown propagates
through the engine as a store failure, with automatic retry disabled.
Resolution by persisted receipt/key belongs to the caller/P1a retry table.

`worker_ledger_path` retains SQLite's adjacent identity-namespaced file. On
Postgres it requires an explicit absolute durable state directory and derives
the completion filename from the logical store id. Missing id and state use
`E_WORKER_STORE_ID` and `E_WORKER_STATE`. No dummy file path or URL is used.
The supervisor now calls this store-level seam; its Postgres configuration
is S10d-3 work.

## Real-Postgres witnesses

PostgreSQL **16.15**. The final full Postgres script exits **0**. The final
ownership run also exits **0**, with **15 / 0 failed**, as the private
`sb4_owner` non-superuser (no `pg_signal_backend` grant). Thirteen cases
exercise the database; the other two are the tag unit test and subprocess
helper. Source: `crates/snapback4-core/src/engine/postgres/tests/ownership.rs`.

| Witness | Observed result |
|---|---|
| Two owners; stale token | Token 1 hands off to 2. A deliberately surviving, retagged old connection refuses the stale mutation with `E_STORE_OWNERSHIP`; head and receipt count stay at one. Old-token reconnect and renewal also refuse. |
| Renewal between expiry poll and claim | The public renewal wins; the stale conditional claim returns no row. Both the fenced connection and renewal connection remain usable; no termination. |
| Two standbys | Exactly one acquires token 2. The loser's claim returns none; the winner renews and commits successfully. |
| SIGKILL owner | The parent kills and reaps precisely its recorded child. After database-clock expiry, token 2 takes over; both pre-kill and post-takeover commits remain. |
| Transaction longer than lease | A non-head sequence write stays fenced beyond the 300 ms lease, with eight independent renewals. The standby acquires nothing; the transaction commits its durable sequence value. |
| First lock | While a writer waits for `_head`, an independent `FOR UPDATE NOWAIT` on `_owner` gets `55P03`, proving the owner key-share fence came first. |
| Bounded blocker termination | Takeover terminates the old fenced backend and takes token 2. A same-store session tagged with token 99 remains usable. |
| Mid-COMMIT backend termination | A deferred advisory-lock barrier makes COMMIT observable in `pg_stat_activity`; terminating that backend produces typed unknown through `Engine::mutate`, with retry disabled. Resolution observes rollback and no receipt/head advance. |
| Durable commit, lost acknowledgement | A local wire relay drops the connection after Postgres emits COMMIT completion and before the adapter receives it. The error is unknown; reopen finds exactly one receipt/head, and replay does not advance it. |
| Uncancellable adapter COMMIT | A deferred 80 ms trigger checks both statement and lock timeouts are zero during COMMIT; the write succeeds despite the connection's 30 ms statement timeout. |
| Synchronous-wait warning | A deferred trigger injects the real warning's SQLSTATE with non-English text. The committed operation is returned as unknown, never an acknowledgement; its receipt replays once. This is warning-handler evidence, not replication qualification. |
| Legacy attach | Removing `_owner` then refusing selected-release opening leaves it absent. Two concurrent successful openers install one matching token-zero row. Once a positive lease exists, loss of the owner table refuses rather than resetting ownership. |
| Worker ledger | Two logical stores using the same connection and state directory get distinct ledger paths; a reader of the same store gets the same path. Missing id and location return the named errors. |

## Requested checks

| Check | Result |
|---|---|
| `cargo test -p snapback4-core --no-fail-fast` | Exit 0; aggregate unfiltered summaries: **1,062 passed / 0 failed / 5 ignored**, including 26 doctests. |
| `cargo test -p snapback4 --no-fail-fast` | Initial exit 101: **6 failures across 4 targets**. Every failed case passed in its isolated rerun after the corrections/setup below. No clean full-suite repeat is claimed. |
| Core `--no-default-features` | Pass. |
| Committer/store-port ratchets and handle census | Final **16 / 0 failed**, with unchanged zero production allowance and no allowlist increases. |
| Compiled handle guards | Pass in default and Postgres builds; Postgres script also passes **37** external-consumer doctests. |
| Guide | Final **127 / 0 failed**; all 387 registered codes have dedicated definitions/recovery text, including the four added codes. |
| Wasm codec census | **27 / 0 failed**. |
| `scripts/test-postgres.sh` | Final exit 0: **58 evaluator + 209 family/oracle + 15 ownership + 1 compiled guard + 37 doctest + 2 member + 1 HTTP + 19 corpus** cases pass. |
| Non-superuser ownership repeat | **15 / 0 failed**, exact final source, separate private cluster. |
| Root `./ref-check` | **564 LLPs / 11,704 refs / 0 errors / 0 unchecked**. |
| Diff/new-file formatting | Whitespace and rustfmt checks on all four new Rust files pass. |

After the complete script passed, the warning hook was tightened to use
SQLSTATE `57014` alone, independent of `lc_messages`. The affected ownership
group repeated **15/15** on the exact final source, including a non-English
warning, as a non-superuser in a seventh private cluster. Its log is
`/tmp/s10d2-checks/ownership-locale-final.log`.

The final Postgres oracle retains **65 increments** in both modes, no losses,
zero serialized retries and **54** serializable retries. C1 warmed query
calls remain **20 off / 23 on** in both common and retained engines, with
**8** marked reads. Existing unsupported corpus cases retain their exclusions;
there is no certified changes/sync, public serving, HA or publication claim.

The initial host failures were the new codes' missing dedicated renderer/CLI
excerpts (two tests), the direct root port re-export caught by the lexical
ratchet (one test), and the three supplied toolchain/web fixture baselines.
All six pass alone. The definitions, recovery pins, card routing and excerpt
placement now satisfy the existing guide guards. The re-export now lives in
the existing adapter module; no guard allowance was relaxed. Frozen Bun
installation supplied the missing local TypeScript/Playwright dependencies.
TypeScript emit produced the guide's referenced dist leaves. The separate
full client build still refuses missing ignored wasm source artifacts;
this backend lane makes no client-build or publication claim.

Retained earlier attempts: two fixture expectations in the first executing
ownership run were corrected (hygiene legitimately closed the old lease
connection; the temporary COMMIT trigger had to be removed before validated
reopen). The legacy attach correction initially had a crate-visibility
compiler error; the complete Postgres repeat passes after that correction.
The initial guide run also exposed the mandatory definition/action pins and
missing local generated JS leaves, all resolved for its passing repeat.
An optional workspace-wide rustfmt check reports pre-existing formatting
throughout the tree; the four new Rust files are formatted. Transcripts and
stage exit files are retained under `/tmp/s10d2-checks`.

## Cluster and scope custody

All seven clusters started by this lane were stopped and independently checked
again with `pg_ctl status = 3` and no `postmaster.pid`:
`/tmp/s10d2-owner.eTvYVt`, `/tmp/s10d2-owner.NYWP5l`,
`/tmp/s10d2-owner.1gIymW`, `/tmp/s10d2-owner.vs2jqS`,
`/tmp/s10d2-owner.tVEHVs`,
`/tmp/sb4-pg-eval.qQN1YE`, `/tmp/sb4-pg-eval.R3col9`.
Their data is retained. No other cluster was touched. Cargo used only the
specified lane target, incremental off, both debug profiles at line tables,
and at most 16 build jobs. All observed disk readings stayed above 30 GiB;
the lowest observed reading was about 77 GiB.

The affected LLP audit reconciles §3.4's worker-path census and the ownership
implementation note with §5; the other scoped refs remain applicable. The
RFC retains its single Revised line, prepended with S10d-2. The journal entry
lands with the implementation. No identity or committer implementation file
changed; no sub-agents, cloning, other-machine commands, push or stash.

## S10d-3 handoff

Wire StoreConfig and matching backend/source/release validation into public
deploy/serve. Bootstrap the store, acquire the positive lease, then reopen via
`open_postgres_owned` before listener admission. Keep the internal token-zero
API out of public serving. Schedule renewal outside the committer; stop
admission and startup/background producers on ownership loss, drain before
release, and apply the admitted profile's drain-and-park policy. Configure
and validate the explicit durable worker state directory and pass it to
`worker_ledger_path` before starting workers. Retain the same owner token and
connection configuration for readers and serving connections, with direct or
session pooling. Resolve unknown commits through P1a's persisted keys/receipts
before retry or source cleanup. Rerun the applicable witnesses through the
public listener. Full declared HA/provider/identity/tripwire and worker
recovery work remains P1b; this slice does not qualify those modes.

## S10d-2 fix round 1 — 2026-10-22

Rebased `78a90983da` onto `origin/main` at `e7d33f738d`, retaining the new
S10d-1 identity routing and scale measurement records. The replayed lane commit
is `49153622a9`. The journal conflict was resolved by union; the port conflict
retains both the identity-member and ownership exports. The Postgres core
compiled after that integration. Delivery remains local on `sb4-pg/s10d2`.

The scoped orientation is LLP 3000 (the Snapback 4 fence), LLP
3000.009.001.000 §3.4 (retained evaluator and thin host slice), §5.1 (owner
before head), §5.2 (conditional claim before signals and claim retention),
§5.4.1 (unknown/uncancellable COMMIT), and §9.1 rule 7 (observed contention).
The existing annotations still apply. The affected-corpus audit updates the
existing implementation note and takeover steps; it changes no proposal
status, public-serving scope, committer/identity policy or capability claim.
The RFC has one Revised line, prepended with `S10d-2 fix round 1`.

### Review findings and forcing evidence

1. **Mixed blockers.** `terminate` first classifies the complete observed
   blocker set, then signals eligible members. Any ineligible member returns
   `E_STORE_OWNERSHIP` before a signal to that set. This chooses §3.4's
   abort-on-ineligible behavior and makes it explicit in §5.2; the prototype's
   skip-and-wait behavior is not adopted. The real-cluster witness retains an
   expired owner's conditional claim and two owner key-shares. A shared-advisory
   wait exposes both blockers in one `pg_blocking_pids` set (row multixact waits
   may expose holders one at a time). The production termination function
   refuses; both sessions survive, the tagged transaction commits its staged
   sequence value 17, the token stays 1, and the original owner renews.
2. **Claim cancellation.** Both policy timeouts are at most four seconds,
   with a one-second margin below the five-second lease statement timeout.
   A conditional-claim `57014` returns `None` before any watcher starts. After
   a returned claim row, statement timeout is disabled before the watcher;
   fence waits retain their lock timeout and finite attempt count. The policy
   test rejects 4,001 ms and 5 s and accepts 4 s. An injected slow UPDATE
   reaches a real `57014`, returns no acquisition, leaves the writer alive,
   and permits renewal. The forced retry test starts with a 20 ms session
   statement timeout yet reaches the fence's real one-second `55P03`, proving
   that the claimed phase cannot hit that statement timer after signalling.
3. **Evaluator isolation.** The evaluator returns `E_STORE_OWNERSHIP` when
   opening any unified namespace with `_owner`, including token zero. Its
   connection retains a shared session advisory guard on the namespace's
   bootstrap key. Legacy adoption takes the exclusive transaction guard before
   owner DDL, including before a logical store id is available; a positive
   token still refuses to bootstrap a lost record. One test refuses evaluator
   opening at tokens 0 and 1. Another observes legacy adoption blocked by an
   already-open serializable evaluator, commits through that evaluator, drops
   it, and only then completes adoption and positive-token acquisition.
   Ordinary evaluator write calls and both oracle modes remain unchanged.
4. **Forced interleavings.** Hooks are test-only and local to each invoking
   thread; the watcher gate is transferred only to that claim's watcher.

   | Witness | Required observation before release |
   | --- | --- |
   | Two standbys | Winner holds its actual returned conditional-UPDATE lock; `pg_blocking_pids(loser)` contains the winner. Loser returns `None` and never starts its watcher; winner's session, renewal and mutation succeed. |
   | Renewal between poll and claim | Public `acquire` polls expired, then its hook renews before the conditional UPDATE. The claim matches zero rows; after-claim/watcher hooks must never execute. Old fenced transaction commits and lease renews. |
   | Savepoint rollback | Watcher cannot signal yet; fence wait returns actual `55P03`. Renewal is observed blocked before timeout and again after `ROLLBACK TO`/`RELEASE`, while paused at the post-rollback hook. Only then may the next wait and termination proceed. Renewal returns false under the changed token. |
   | Legacy openers | First opener pauses after acquiring the bootstrap advisory transaction lock, before owner DDL. The second backend must have advisory `wait_event` and name the first in `pg_blocking_pids` before release. Both open successfully with one token-zero row. |

The guide's existing ownership refusal now also explains evaluator namespace
separation. COMMIT outcome classification, worker-ledger behavior, normal
owner/head lock order and the admitted identity/committer implementation are
otherwise unchanged.

### Qualification

All requested checks pass on the completed source. Transcripts and exit
records are retained at `/tmp/s10d2-fix1-checks/`. Parent-target totals below
exclude nested subprocess summaries already counted by their parent tests.

| Requested check | Final result |
| --- | --- |
| `cargo test -p snapback4-core --no-fail-fast` | Exit 0: **1,068 passed / 0 failed / 5 ignored**, including 646 unit cases and 26 doctests. |
| `cargo test -p snapback4 --no-fail-fast` | Exit 0: **1,405 passed / 0 failed / 15 ignored**. All three supplied baselines pass. No unexpected failure or isolated rerun. |
| `cargo check -p snapback4-core --no-default-features` | Exit 0. |
| Committer/store-port ratchets and handle census | **16/16**; committer remains **10 files / 47 sites**, store-port production **0 / 0**, concrete handles and owning bridges **0**. No allowlist changes. |
| Compiled handle guards | **1/1** in default and Postgres builds; **37** Postgres doctests also pass. |
| Guide | **127/127**. |
| Wasm codec census | **27/27**. |
| Stock `scripts/test-postgres.sh` | Exit 0: **58 evaluator + 209 family/oracle + 21 ownership + 1 compiled guard + 37 doctest + 2 member + 1 HTTP + 19 corpus** cases. Existing unsupported corpus exclusions remain. |
| Separate non-superuser ownership run | **21/21**, PostgreSQL 16.15, `sb4_owner` with no superuser or signal-role grant. The final stock-script ownership repeat covers the completed bootstrap guard. |
| Root `./ref-check` | **564 LLPs / 11,709 refs / 0 errors / 0 unchecked**. |
| Whitespace and ownership-file rustfmt | Pass. |

The Postgres oracle retains **65 increments** in each mode, with zero losses,
zero serialized retries and 107 serializable retries. C1 remains **20 off /
23 on** for both executors, with eight marked reads. The runner initially
invoked `../ref-check` from `snapback4/`, which has no root LLP corpus; that
wrong-directory attempt failed. The required repository-root `./ref-check`
passes and is recorded separately in `refs-root.log`.

Retained attempts: the first ownership compilation exposed test-hook visibility
that was corrected before any tests ran. Its cluster was stopped. The next
run passed 19/21: a row multixact did not expose both blockers simultaneously,
and trigger removal waited behind the surviving writer. The mixed witness
now uses the observable shared-advisory set, and the surviving writer commits
before trigger removal. The corrected group passed 21/21. These failed
attempts are retained, not counted as passed qualification.


All four clusters started during this fix round are stopped and independently
reconfirmed with status 3 and no `postmaster.pid`: `/tmp/s10d2-fix1-owner.f2nccY`,
`/tmp/s10d2-fix1-owner.mTCbhn`, `/tmp/s10d2-fix1-owner.C0lCuJ`, and
`/tmp/sb4-pg-eval.s7vhFS`. The receipt is `cluster-stops.log`; data is retained.
No unrelated cluster was touched. The only Cargo target was the specified
lane target, incremental stayed off, both debug profiles used line tables,
and build jobs never exceeded 16. The lowest observed root free space was
about **91 GiB**, above the 30 GiB stop threshold. No push, stash, sub-agents,
other-machine commands, dependency/policy allowance increase or publication.
