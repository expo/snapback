# Workroom process custody — independent Grok review of r2

Date: 2026-09-17
Reviewer: Grok 4.6, requested xhigh.
Native session: `01a0acec-c992-76e2-b5a5-f96451c49f13`.
Reviewed: `31dc2214f6295efd0570959f2683c51182e1b710` against `abe888311791ab6ecceba890d8b57a31065cd2c6`.
Received: 2026-09-17T01:30:55Z; process exit 0.

Fresh mutually blind, single-reviewer, local read-only source review. No builds, tests, clones, remote commands or spawning were authorized. Reported implementation test results were not rerun by the reviewer. Local source links identify the immutable review worktree.

The initial plan-mode run ended cancelled on a tool-permission request, with exit 0 but no verdict; it was not counted as a completed review. The same mutually blind native session resumed with Execute disabled and Read/Search/ListDir confined to the assigned checkout. The completed response had stopReason `end_turn`. Only its public `text` is retained here; private reasoning is excluded.

## Orchestrator disposition

Received READY; retained verbatim, not treated as consensus. The other independent review demonstrates an observable late-child leak missed here. r3 must repair it and earn new exact-byte actual-process qualification and fresh blind reviews. No claim of universal process containment or SIGINT containment is made.

## Received review

I’ll finish the review from the sources already in hand, using only in-checkout reads to pin line-level failure paths.Independent review of `abe888311..31dc2214f`, scoped to `run-pilot.mjs`, `run-pilot.test.mjs`, and `launcher-verification.md`. Inspection only: current sources plus the already-captured net delta. No tests, hashes, fixtures, fleet contact, or other reviews.

## Contract vs implementation

The class and `runPilot` wiring match the stated rules.

**Signalling identity is PID/UID/start token, not argv.** `stableIdentityMatches` (145–150) compares only those three. Exec/argv is receipted as `identity-coordinates-changed` (255–272) and stored as initial vs `lastObserved` command hashes. That is the r1 failure mode, and test `command hash evolution is receipted without changing stable process identity` (97–116) asserts `receipt.ok === true`, zero uncertainties, and a group signal to PGID 200 after `sha256:before-exec` → `sha256:after-exec`.

**Adoption is same-UID, current parent, leader live.** `observeRows` refreshes the ledger first, then returns without adopting unless `adopt && this.leader && verified.has(this.leader.pid)` (282). New rows need a currently verified PPID, `observed.uid === this.uid`, and a PID not already in `byPid` (286–303). Leader exit therefore keeps already-adopted children (first loop still identity-matches them) and will not adopt a PID-1 orphan that never had a verified parent in a snapshot.

**Intentional stop path.** `intentionalStop` (28–30) is only ceiling, disk-floor, driver SIGINT/SIGTERM. Those send revalidated leader SIGINT with 5s grace (`gracefulCancel` 347–365; `GRACEFUL_CANCEL_MS` 20), then descendant groups, then the spawn-verified leader group, then exact PIDs (`_cleanup` 486–528). Lifecycle/snapshot/log failures skip SIGINT (test 177–188).

**Group signal is fail-closed.** `validateGroup` (371–388) refuses if any current member is missing from the ledger or fails identity. Between TERM and KILL it re-validates and will not escalate a now-unsafe group (423–425). Unknown same-UID + foreign members: no `kill(-pgid)`, exact PID of the adopted member only (test 210–226).

**Cleanup is singleton and waits are bounded.** `cleanupPromise` (482–484) and `custodyStopPromise` (707–711). Snapshot `spawnSync` timeout 2s (137–141). Grace 5s, descendant TERM/KILL 5s, leader group 30s+10s, exact PID 5s+5s, close race 2s, cap still `MAX_MS` 4h (17). `waitForGroup` / `waitForExactGone` always terminate on gone, refused, or deadline.

**Receipts fail closed.** `ok` requires no uncertainties and no survivors (541–542). Limitation and `eligibleFromThisReceipt: false` are always present (553–558). `end.json` keeps `custody` plus aliased `groupCleanup`, separate `builderFinal` (`app/FINAL.md`) and `lastMessage` (622–623, 875). Packet pin `snapback4 !== '0.2.26'` and disk floor 2 GiB are unchanged (21, 584–586, 774).

**Full-run wiring, not just the class.** Stop clears the sample interval (718–721), then `cleanupAfterActiveSample` waits out an in-flight sample before `custody.cleanup` (568–571, 707–711). The interval `.catch` swallows snapshot rejection (784–788), so that wait cannot hang on a failed sample. Natural exit hits `finally` (808, 813–815) with `leader-exited` / `lifecycle-error`. Unverified identity still uses exact-child fallback only (823–834), not `kill(-pgid)`.

No demonstrated unsafe group/PID signal, new unbounded wait, dropped packet/pin/cap/FINAL coverage, or routine exec-spawn path whose argv/PGID change would still be treated as identity.

## Material issues

None that break the contract.

I looked specifically for: group kill with a foreign/uncertain member; hang; loss of original launcher guarantees; exec-spawn still keyed on argv. Those paths refuse or bound.

Closest inspected miss (not an unsafe signal):

**Historical `byPid` blocks re-adoption of a recycled PID** (297–303). If adopted PID 200 exits, then a new same-UID child of a live verified parent reuses 200 while the leader is still live, the first loop records `PILOT_PID_IDENTITY_CHANGED` (274–278) and adoption refuses `PILOT_REUSED_DESCENDANT_PID_REFUSED`. Cleanup will not signal the new process (identity mismatch / unknown group member). Receipt `ok` is false. That is fail-closed leak, same class as missed ancestry, not a foreign kill. Short r2 (19.71s) cannot show it; a 4h `npm` run could.

## Docs / tests vs wiring

Docs match the identity split, 5s cadence, SIGINT-then-validated-groups, fail-closed receipts, sampled-ancestry disclaimer, and “r2 does not mean SIGINT contained Codex.” Eleven `test(...)` blocks plus one skipped opt-in (259–262) match the stated focused command. Mock assertions cover the r1 argv bug, distinct-PGID cleanup after leader death, TERM→KILL, group refusal, survivor `ok: false`, and the explicit double-fork non-claim (241–257).

Gaps, not contradictions:

- No `runPilot()` test. Interval/`requestStop`/`finally`/`intentionalStop` are inspection-only. The opt-in actual test (259–353) constructs `ProcessCustody` itself and never exercises `cleanupAfterActiveSample` around `setInterval`.
- `cleanupAfterActiveSample` is tested only as a helper (118–132), not against a queued interval tick after `clearInterval`.
- No test for `PILOT_REUSED_DESCENDANT_PID_REFUSED` or foreign child that does not share a PGID.
- Actual-test `passed` requires `gracefulCancellation.attempted` and `receipt.ok`, not `outcome === 'leader-exited'` (332–335). That matches r2 (grace expired, TERM cleaned) and the docs. It does not overclaim SIGINT containment.

I did not re-hash files or read `/tmp` r1/r2 receipts.

## Observer cost, races, ledger, groups, leader exit

**Cadence.** Live path is one `ps -ax` per 5s, skip if a sample is already in flight (782–789). Documented ~120ms/sample → ~2.4% monitor-path wall is consistent with the code. Cleanup polling is denser (`pollMs` 100, 177) for the bounded TERM/KILL windows; bursty, not a hang.

**Stop/sample.** In-flight sample is awaited; failed samples resolve via `.catch` then cleanup still runs. Same-millisecond timers at the 4h mark (`MAX_MS` is an integer multiple of 5s and 60s) fire in registration order: heartbeat, then sample interval, then ceiling (781–790). The healthy-disk cap therefore starts a sample *before* ceiling `requestStop`, which then waits on it. Heartbeat `disk-floor` in that same tick can start cleanup with `custodySamplePromise === null` *before* the already-queued sample callback; `observeRows` is still synchronous once rows arrive, and `validateGroup` uses a fresh snapshot immediately before each group signal (391–394, 407–414). Concurrent adopt during cleanup can add descendants; it does not mark a foreign group safe.

**Ledger refresh.** Matched rows update `lastSeenAt` / `lastObserved` only. Top-level `ppid`/`pgid`/`commandSha256` stay first-seen; receipts keep both (545–550). `this.leader.pgid` used for leader-group cleanup is the spawn PGID (510–511). If the leader later `setpgid`s, descendants in the new PGID are targeted via `currentDescendantGroupIds` (443–453) and still member-validated; the original group is signalled only if it remains all-known.

**Leader exit / reparent.** Adopted identities remain after the leader row disappears. `currentDescendantGroupIds` uses *current* `lastRows`, not historical `groupLedger` keys, so a PGID the child already left is not group-signalled unless another live adopted member is still in it. PID-1 reparent of an already-adopted child still matches identity and is cleaned (test 148–159) — the original distinct-PGID leak class.

**Fallback.** `identitySeeded` is set before the unverified-PGID `fail` (742–746). `leaderGroupVerified` is false, so `_cleanup` will not `kill(-pgid)` on that group (518–521); exact leader PID only. Safe on a shared machine.

## Out of scope / pre-existing

- Snapshot-then-`kill(-pgid)` TOCTOU of milliseconds (a process joining the group after the validating snapshot) is inherent; the previous launcher signalled the spawn PGID with no member check.
- `lstart` is second-granularity; that is the contracted start token.
- Stop-reason process exits 124/130/143 still precede `custodyCleanup?.ok !== true` (879–884). Same precedence as the old cap/signal codes. Honesty is in `end.json`, not the exit code.
- Fast double-fork/reparent between 5s samples remains disclaimed (`CUSTODY_LIMITATION` 22–23). Not a universal subtree guarantee.

## Residual limitations

Sampled ancestry only, 5s first-interval gap after the spawn snapshot, no re-adoption of a recycled PID while the old ledger entry remains, cleanup-time `ps` burst, and r2 qualifying `ProcessCustody` + ordinary distinct-PGID exec-spawn rather than `runPilot`’s timer integration. SIGINT is leader-PID only; containment of Codex tools is not claimed and r2 did not show it.

VERDICT: READY

