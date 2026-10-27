# OWN — silent Postgres ownership refusal

2026-10-27. Branch `sb4-pg/own-loss`, baseline main `2921a639cc`.

The confirmed bug is a **terminal G6 admission pause that never reached the
public owner's lifecycle watchdog**. An unconfirmed data COMMIT or rollback
closed the local writer/cache epoch. Requests then returned
`E_STORE_OWNERSHIP`, but lease renewal succeeded indefinitely and stderr said
nothing. This is distinct from losing the database owner token.

The fix makes the serving synchronous public owner attempt one bounded reason
line and exit, leaving lease/read-epoch expiry and fenced acquisition to a fresh
process. Short-lived deploy retains in-process activation reconciliation.
It does **not** establish which initiating fault happened in the two original
campaigns. That remaining attribution is tracked in
[`issues/20261027-snapback4-s1-ownership-initial-uncertainty.md`](../../../issues/20261027-snapback4-s1-ownership-initial-uncertainty.md).

## Original evidence and scope

- R0 measurement 041 on `expo-build-450b`: six warm-up ACKs, all 53,800
  measured requests HTTP 409, drain refusal, no ownership diagnostic, process
  alive until SIGTERM. The supplied read-only recovery receipt gives counter
  delta = ACKs = 6 and contiguous `_head`/commit count/max. The permitted
  `serve.stderr`, recovery/drain JSON and probe/rate JSON were read only.
  Measurement 039's startup/shutdown was also read. The requested 043 path
  was unavailable during inspection; later the 041 path was unavailable too.
  Nothing was started or changed on that benchmark host.
- The local batch-controller report records a separate main W5-exact/B100
  attempt with 2000/2000 measured errors after waiting for the prior lease to
  expire. Its original cleanup removed the counter evidence.
- Neither supplied record retains the first failed warm-up response body or
  the initiating database failure. An injected failure matching the wedged
  state is not proof of that original initiating failure.

Orientation followed LLP 3000.009.001.000 §§5.1–5.2 and its retry rows,
`store_owner.rs`, SQLite `store/ownership.rs`, Postgres `ownership.rs`,
`read_grant.rs`, the committer admission gates and `store_config.rs`.
The Snapback 4 fence needs no Ibex/Hermes bootstrap.

## Mechanism and hypotheses

`Grant::commit`, an unacknowledged durable rollback, or an unresolved pipeline
final can set `Grant.uncertain`. Both store and queue admission then refuse
with `E_STORE_OWNERSHIP`; the flag is deliberately sticky for the synchronous
cache epoch. `StoreLease::renew` can still update the same valid owner claim.
The public `OwnedStore` watched renewal outcome and its independent deadline,
but never watched the admission flag. Its renewal/deadline failure messages
therefore never fired in this state.

The six-ACK control deterministically demonstrates both outcomes:

| Fault after six ACKs | Unmodified main, PG16 and PG17 |
| --- | --- |
| The owned data backend records its PID, then terminates itself before commit | Seventh invocation unconfirmed; `head=max=count=6`; owner remains alive, valid lease keeps renewing, later `E_STORE_OWNERSHIP`, **zero** ownership lines |
| Deferred cancellation warning on data COMMIT | Seventh write durable but unacknowledged; `head=max=count=7`; same live-owner wedge and silence |

The baseline executable was rebuilt from unmodified product source at
`2921a639cc` (SHA-256
`1983190f51cbbf4139adfd632aeb5f4bc03316bce142ef91c90331f0bd5ddb9a`).
All four baseline regression runs failed at the expected lifecycle assertion.
They were then explicitly stopped/reaped; no managed row was repaired.

Other hypotheses were investigated, without claiming their universal absence:

- Renewal already has a dedicated connection and a separate watchdog. The
  extended G6 test proves renewal still succeeds after admission becomes
  terminal and that renewal cannot revive that epoch. This explains silence
  without pool starvation, clock expiry or a superseding token.
- Existing takeover/claim races, late predecessor renewal/release, fencing,
  timed renewal and uncancellable-COMMIT tests pass on both database versions.
  No fencing or clock arithmetic was changed.
- Exploratory controls included 12 direct-socket public restarts with 38,400
  HTTP upserts, four delayed-link upsert restarts, six delayed-link update
  restarts, and three depth-two queued-owner cycles. These did not reproduce
  ownership loss. An exploratory delayed queued-write test hit its ordinary
  100 ms invocation deadline; it was not an ownership failure or a passing
  throughput qualification.
- Sixteen native S1 trials used the unchanged S1 schema, 32 writers,
  32,768 messages, alternating direct/1 ms native-proxy links, 2690 offered/s,
  2 s warm-up and 4 s measurement. None produced ownership loss. They had
  substantial dispatch expiry and some HTTP 503s on this debug build and are
  **not** S1 performance qualification. The original million-row, 30-second
  campaign/spike was not reproduced or modified.

## Fix and fencing

- `StoreLease::admission_watch` returns an owned shared-memory check. The
  synchronous public watchdog can observe uncertainty without acquiring the
  lease-client mutex, including while lease COMMIT is blocked.
- G6 publishes its uncertainty flag before attempting one static, credential-free
  reason line through the bounded diagnostics queue. A separate shared-memory
  acknowledgement orders the watchdog after that queue attempt; it drains
  output for at most 100 ms before exit. A stalled or full destination can
  lose the line, never prevent loss publication or exit. Reasons distinguish
  unconfirmed COMMIT, rollback/durability history, pipeline final and panic.
  Repeated refused requests do not repeat the line.
- After `serving()` arms G6 fail-stop, a synchronous public owner exits
  nonzero on that terminal flag. Short-lived deploy instead probes persisted
  activation, completes its pointer/log and releases its lease on drop. It does
  not release or shorten either the lease or persisted read grant while
  admitted work may still finish. Normal takeover still claims the expired
  lease, takes the owner fence and advances its token.
- The embedded committer reports its first ownership-loss transition too,
  distinguishing claim mismatch, failed/uncertain renewal, late renewal and
  deadline expiry.
- No automatic invocation replay or reopening of the old synchronous cache
  epoch was added. The unknown seventh invocation retains its actual durable
  outcome. After expiry, the fresh owner accepts exactly one new invocation:
  the aborted case advances 6 → 7; the durable-unknown case advances 7 → 8.
- Arm E's explicitly fenced in-process durability recovery remains separate.
  Both public E controls stay alive, recover after the fault is removed and
  accept the next write without replaying the uncertain one.

LLP §5.1, the release guide and journal document this lifecycle rule; the
non-obvious code paths carry `@ref`s. The owner-record schema, takeover,
holder/token predicates, SQL fences, lease durations and retry policy are
unchanged. No harness workaround was made.

## First-pass reproduction and verification (4199a38cd3)

[`reproduce.py`](./reproduce.py) requires an explicitly private,
trust-authenticated Unix-socket cluster; it creates one unique namespace and
records/reaps its own CLI children. It never signals PostgreSQL. Example,
with a private cluster already started by the operator:

```sh
python3 snapback4/reports/20261027-ownership-loss/reproduce.py \
  --bin "$CARGO_TARGET_DIR/debug/snapback4" --psql "$PG_BIN/psql" \
  --socket "$PRIVATE_PG_SOCKET" --port "$PRIVATE_PG_PORT" \
  --user sb4_own --out /tmp/own-loss-repro
```

Add `--abort-before-commit` for the counter-delta-six case. Add `--early`
without that flag for the recoverable E control. Review regressions use
`--stalled-stderr` and `--deploy-unknown` separately. Some extracted PostgreSQL
installations also require their own `LD_LIBRARY_PATH`.

Builds used worktree-local `snapback4/target` (separate nested targets for the
native controls/seed), eight jobs for the product, and
`CARGO_PROFILE_DEV_DEBUG=line-tables-only` /
`CARGO_PROFILE_TEST_DEBUG=line-tables-only`. Tests ran with two libtest threads
per database version. PG16.15 used private port 35329; PG17.11 used private
port 60865. Neither the port-55440 cluster nor `~/q24` was touched.

| Final verification | PG16 pass/fail | PG17 pass/fail |
| --- | ---: | ---: |
| Core ownership/takeover/fencing, excluding the no-op subprocess helper | 24 / 0 | 24 / 0 |
| Core command queue, lease renewal, deadlines and blocked COMMIT | 16 / 0 | 16 / 0 |
| Core G6 grants, including the extended uncertainty/healthy-renewal witness | 19 / 0 | 19 / 0 |
| Core grant gate | 2 / 0 | 2 / 0 |
| Core final-flight fencing/deadlines/unknown outcomes | 9 / 0 | 9 / 0 |
| CLI store ownership | 13 / 0 | 13 / 0 |
| CLI store configuration/startup custody | 2 / 0 | 2 / 0 |
| CLI `serve_authority` | 92 / 0 | 92 / 0 |
| CLI committer fix/HTTP door cases | 15 / 0 | 15 / 0 |
| Public regression: aborted unknown, durable unknown, recoverable E | 3 / 0 | 3 / 0 |
| **Total** | **195 / 0** | **195 / 0** |

**390 passed, zero first-pass verification failures.** Separately: the four
unmodified-main reproducer runs failed as intended. Both fixed S fault cases
emit exactly one reason line and exit; all fresh-successor checks pass.
[`evidence.json`](./evidence.json) retains the per-run outcomes, counts and
recorded/reaped PIDs. Product fix executable SHA-256:
`7d6ff15c729c0d1da678a7f4d8a06a08f2d8e4dd095831fef837b3eea913c3c4`.

`ref-check --verbose` and `git diff --check` pass. An affected-selection plan
was generated. The complete scheduled battery, publication qualification and
an authoritative S1 rerun were not run or claimed for this commit-only lane.

## Fix round 1 — both review findings

The reviewed commit is `4199a38cd3`; these fixes are a separate commit on top.
The two review regressions fail on its saved executable, independently of the
original main-before-fix controls above:

| Finding | Before (`4199a38cd3`, PG16) | After (PG16 and PG17) |
| --- | --- | --- |
| sol P2: blocking stderr | After readiness and six ACKs, fill the real stderr pipe with 65,536 bytes and stop reading. The deferred seventh-COMMIT warning leaves `head=max=count=7`, owner alive, zero reason lines and a renewing lease (`7\|7\|7\|2\|t`). It still has not exited after the HTTP timeout plus two-second observation window. | Nonzero exit within the two-second bound despite the unread full pipe; successor accepts exactly the next write. No early lease release. |
| grok Major: deploy killed before reconciliation | A deferred warning makes activation COMMIT durable but unknown. A queued metadata blocker delays its probe for 300 ms. Exit 1; DB selection 2, `current` 1, release log `prepared`, lease unreleased. | Deploy exits 0 with `resolvedUnknownCommit: true`; DB selection and `current` 2, log `activated` with generation 2, lease explicitly released, no staged pointer. |

`read_grant.rs` now publishes the uncertainty flag before queuing its first
reason through bounded diagnostics. A separate atomic acknowledges that queue
attempt so the watchdog cannot exit before it. No logging I/O holds the
publication lock. `command.rs` sets loss and drains queued refusals before
queuing its diagnostic, outside the admission mutex. All public ownership exit
paths use the existing bounded sink and a 100 ms lifecycle drain, so a stalled
reader cannot block fail-stop. A full/broken sink can lose the reason line;
ordinary file-backed runs still assert exactly one.

`store_config.rs` shares its existing release-on-drop state with the watchdog:
only `serving()` arms the G6 uncertainty exit. Renewal/deadline-loss behavior
and Arm E's exemption remain. The deploy witness also exposed that merely
removing the premature exit was insufficient: reattaching an engine through
the sticky grant refused metadata work. `configured_release.rs` now finishes
from the validated probe's persisted selection and generation, without
reattachment, activation replay, or clearing the uncertain grant.

`reproduce.py` adds `--stalled-stderr` and `--deploy-unknown`. The latter uses
a namespace-filtered event hook to queue a deferred warning on an **unmanaged**
fault table, leaving managed-relation interception intact. A sequence and the
queued lock witness order the delayed probe deterministically. Cleanup removes
the event hook and namespace and reaps every child, escalating only a recorded
wedged child to SIGKILL when graceful shutdown cannot finish. Every serving
case now asserts both the original token and the audit's final `|t`: loss
neither replaces the claim nor releases/shortens the live lease.

LLP §5.1 and the release guide now state the bounded best-effort diagnostic
contract, serving-only G6 exit, and short-lived probe reconciliation. Journal
history is append-only; this review correction has its own entry.

Final executable SHA-256: `e57604823ab86704a9b3f8e89a1a4213bc7dd2ccb0db5ea99e728a1d8877f902`.
The final stalled-pipe witnesses exit in **127 ms (PG16)** and **130 ms (PG17)**.
Both final deploy witnesses finish with selection/pointer/log at release 2,
generation 2 and an explicitly released lease.

| Final affected verification | PG16 pass/fail | PG17 pass/fail |
| --- | ---: | ---: |
| Core ownership/takeover/fencing (no-op child excluded) | 24 / 0 | 24 / 0 |
| Core command queue, lease renewal, deadlines and blocked COMMIT | 16 / 0 | 16 / 0 |
| Core G6 grants | 19 / 0 | 19 / 0 |
| Core grant gate | 2 / 0 | 2 / 0 |
| Core final-flight fencing/deadlines/unknown outcomes | 9 / 0 | 9 / 0 |
| Core bounded diagnostics | 4 / 0 | 4 / 0 |
| Rebuilt CLI ownership / store configuration | 15 / 0 | 15 / 0 |
| Rebuilt CLI serve authority | 92 / 0 | 92 / 0 |
| Rebuilt CLI committer fixes / HTTP doors | 15 / 0 | 15 / 0 |
| Public regressions: aborted, durable unknown, E recovery, stalled stderr, unknown deploy | 5 / 0 | 5 / 0 |
| **Per-database subtotal** | **201 / 0** | **201 / 0** |

Additional shared release suites: **33 / 0** (control 12, files 2, release verbs
5, lifecycle 14; no-op crash helper excluded). Guide suite: **130 / 0**.
**565 passed, zero final test failures.** Separately, both new reviewed-commit
regressions failed as intended. Counts exclude repeated witnesses and earlier
CLI binaries. Serving's semantic inputs are unchanged by the final deploy-only
repair; both new regressions also ran on the final product executable.

The first guide run had 129 passes and one missing-generated-client-files
failure. Frozen dependency installation and TypeScript emission supplied the
referenced leaves, after which all 130 guide tests passed. A complete client
package build is not qualified: this tree lacks ignored web wasm artifacts.
No frontend or publication capability is claimed by the ownership fix.
`ref-check --verbose`, Python parsing and `git diff --check` pass. A fresh
affected-selection plan was retained; the complete battery was not run.

`evidence.json`'s `fix-round-1` record retains the before/after outcomes, suite
counts, final binary digest and cleanup audit. Both private clusters (masters
1612653 and 1612690) stopped successfully and their `postmaster.pid` files are
absent. All **36 recorded PIDs** and every remaining process using this
worktree's executables were inspected: **none left**. Raw local records remain
under `/tmp/sb4-own-round1`. No push, stash, git configuration change or external
message was performed.

## R0 applicability and cleanup

R0's stated main base `d6fdc5b72b` contains the same unobserved sticky G6 flag
and renewal/deadline-only public watchdog. The inherited synchronous owner
lifecycle is affected independently of the concurrent-commit opt-in. The
`ad1bfc1839` spike object was not present locally, and the running benchmark
host was used only for the expressly permitted evidence reads. This does not
prove that either original incident had the injected initiating fault, or
that the spike introduced it.

Private PG masters 892884 (PG16) and 982750 (PG17), and recorded proxy PIDs
966487 and 1031661, were stopped. Both cluster stops completed; both
`postmaster.pid` files are absent. The audit of 77 recorded operator/reproducer
PIDs found **none left**, and the test runners reaped their own children.
Private data and raw local logs remain under `/tmp/sb4-own-20261027`.
No push, stash, git configuration change, credential copy or external message
was performed.
