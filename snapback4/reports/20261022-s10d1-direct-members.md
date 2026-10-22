# S10d-1 — admitted direct operations through the committer

Base: `b644365e1d`, branch `sb4-pg/s10d1`. SQLite behavior is retained; this is
K0 routing for the parent store-port RFC's §3.4 HTTP profile, with no queue,
thread, production batching, retry policy, ownership or listener change.

The governing context is LLP 3000 (Snapback 4 root), LLP
3000.009.001.000 §3.4 (admitted profile and deferred producers), LLP
3000.009.001.000.000 §3.2/§3.7/§9 (Direct members, restricted member savepoints,
explicit dispositions and K0a–K0c), LLP 3000.009 §5.1 (session-family authority)
and LLP 3000.033 §1.3 (immutable read-session authority). The committer and port
RFCs are in `llp/current/`; the affected references remain applicable. The
production guide's account/guest/session behavior is unchanged. No new design
document or protocol is needed; the existing committer RFC receives the K0d note.

## Routed operations

- Guest mint (full/read), ordinary open and service/custom session provisioning.
- Password signup and login, including account/credential creation and their
  in-transaction credential/uniqueness rechecks and expiry sweeps.
- Full and read refresh, including expired-token deletion, family replacement
  and resolve's post-snapshot expired-session pruning.
- Token close, authenticated family logout, principal revoke-all and narrowing
  a full bearer to a read capability.
- Startup's unconditional cleanup of stale supervised session families/reports.

Each shared-port writer uses `Committer::run(Member::new(Kind::Direct, …))`.
Bodies receive only `MemberTx` and typed family operations. SQLite's deferred
composite openers, immediate read-refresh opener, and generation-checked
immediate logout/narrow openers remain distinct. Authority-clock callbacks run
after acquiring the writer. Full replacement with no live old row completes
its original cleanup, while refused/missing read refresh aborts. Convenience
mint/close retain a member per originally autocommitted statement, including
partial success and lazy read-storage DDL before a later error.

Plain `run` uses K0c's owned pending result and completes physical COMMIT before
returning. These direct operations have no additional post-commit process work.
No raw owning handle/callback is added to `MemberTx`. No file under
`engine/postgres/` or matching `store_owner*` is changed.

Ordinary and supervised bearer authentication use existing read-only snapshots.
Queries' applicable publication work already uses Publication members.
Identified mutations' success, refusal, receipt-only outcomes and
insert-then-bind receipt writes already live inside their Program member.
Replay and id reuse retain their existing no-new-write behavior.

## Census and deferred work

The lexical census/allowlist falls from **11 files / 49 sites** to **10 files /
47 sites**: `identity.rs` loses logout's opener (5 → 4), and
`identity/read_sessions.rs` loses narrowing's opener (1 → 0). Adapter-internal
identity composite transactions were excluded from the census, so their
routing does not inflate the reported decrease. No allowance is raised.

| Remaining file (under `crates/`) | Sites | Deferred operation families |
| --- | ---: | --- |
| `snapback4-core/src/engine/actions.rs` | 9 | Action admission/cancel/claim/settle/renewal; conservative authority snapshots |
| `snapback4-core/src/engine/actions/steps.rs` | 3 | Action step begin/complete/park |
| `snapback4-core/src/engine/asset_uploads.rs` | 11 | Asset upload/intent/placement lifecycle, access/view recording, sweeps and receipt-only asset reports |
| `snapback4-core/src/engine/effect_steps.rs` | 3 | Effect step begin/complete/park |
| `snapback4-core/src/engine/effects.rs` | 11 | Effect/work claims, settlement, lease renewal, expiry and worker presence |
| `snapback4-core/src/engine/job.rs` | 2 | Job enqueue and schedule admission |
| `snapback4-core/src/engine/mod.rs` | 1 | Opening/upgrade transaction |
| `snapback4-core/src/engine/routes.rs` | 2 | Route admission and status authority snapshot |
| `snapback4-core/src/identity.rs` | 4 | Bound action-session mint/recovery and three read-only authority snapshots |
| `snapback4/src/dev_replay.rs` | 1 | Development replay schedule policy |

Six of the remaining lexical matches are authority snapshots rather than
writes. Supervised-worker mint/revocation and status reports, development
replay's effect-policy write, and legacy concrete-adapter identity composites
used by fixtures/evaluation also remain outside the committer, outside this
lexical denominator. Those direct paths are outside the admitted request
profile. The administrative opening/upgrade match belongs to the parent's public opening/activation
prerequisite, outside this direct-operation slice.
The parent RFC's startup-runner gating is still required when public configured
serve is enabled; this lane does not enable it or claim a production lease.

## Qualification

The existing private-Postgres HTTP witness also exercises the shared-port
signup/login paths in both scopes, duplicate-signup refusal, full/read refresh,
narrowing and immutable caps, family logout and revoke-all, read guest mint,
resolve's expiry cleanup, token close and startup family cleanup. All direct
operations leave the original public head unchanged. Legacy concrete-adapter
fixtures alone would not qualify the new common-engine routing.

All requested commands returned **exit 0** in the continuation run. Cargo used
only `$HOME/projects/sb4-s10a/snapback4/target`, with ten build jobs. Node was
24.13.1. No runtime or test code from the saved WIP was discarded or changed
during recovery; review clarified the deferred typed-writer inventory above.

| Check | Result |
| --- | --- |
| `cargo build -p snapback4` | Pass; also rebuilt the default CLI after the Postgres manifest/feature handoff |
| `cargo check -p snapback4-core --no-default-features` | Pass |
| `cargo test -p snapback4-core --no-fail-fast` | Pass (1,084 s); 646 unit tests passed / 3 ignored, all integration/doctest targets passed, including all six new SQLite witnesses |
| `cargo test -p snapback4 --no-fail-fast` | Pass (1,104 s); all three supplied baseline tests also passed; no unexpected failure required an isolated rerun |
| `store_port_ratchet`, `store_handle_census`, `committer_ratchet` | 16 passed; actual committer census 10 files / 47 sites; production concrete-type/driver escape and owning-dereference counts remain zero |
| Compiled `store_handle_traits` guard | Pass in both default and Postgres builds |
| `cargo test -p snapback4-lang --test guide` | 127 passed |
| `(cd packages/snapback4 && node --test test/wasm-codec-census.test.mjs)` | 27 passed |
| `bash scripts/test-postgres.sh` | Pass (942 s): 58 evaluator + 209 family/oracle + 2 member + 1 compiled guard + 37 doctest + 1 expanded HTTP + 19 corpus tests |
| Root `./ref-check` | Pass: 564 documents / 11,698 refs / 0 errors / 0 unchecked |
| `git diff --check` | Pass after the final journal/report update |

The Postgres command used the requested environment:

```sh
PATH="$HOME/tools/pg16/usr/lib/postgresql/16/bin:$PATH" \
LD_LIBRARY_PATH="$HOME/tools/pg16/usr/lib/x86_64-linux-gnu" \
TMPDIR=/tmp bash scripts/test-postgres.sh
```

Its sole private cluster was `/tmp/sb4-pg-eval.DcDqvh`. The script stopped it
successfully and confirmed status 3 with no `postmaster.pid`; an independent
`pg_ctl status` also returned 3 (`no server running`) with no PID file. Data is
retained. Existing clusters were not stopped or modified. The original logs
remain under `/tmp/s10d1-checks/`; fresh transcripts, exact commands, exits,
disk measurements and `cluster-stops.json` are under its `continuation/`
subdirectory. Minimum free space was **133.0 GiB**, above the 20 GiB stop bound.
Named corpus exclusions and ignored tests stay outside the passed denominator.
