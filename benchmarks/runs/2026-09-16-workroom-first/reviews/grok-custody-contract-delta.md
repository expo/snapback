# Workroom custody — independent Grok contract-delta review

Date: 2026-09-17
Reviewer: Grok 4.6, requested xhigh.
Native session: `01a0ad0c-0baa-7251-8c36-f39c46a873c1`.
Reviewed: `197aa9c6b3a8f0e5a4d8db932b87957c8721a5f2` against unchanged runner/test bytes from `19cc2656f7`.
Received: 2026-09-17T02:14:56Z; process exit 0.

Continuation of the reviewer's own mutually blind native session. Documentation-only clarification; no other review was supplied. The original verdict is retained separately and not relabelled. Sol's first resume command refused an unsupported option before model execution; corrected invocation above produced the received verdict.
Only the received public answer follows; no private model thoughts are retained.

## Supervisor disposition

READY under the explicitly narrower diagnostic-only contract. No runtime evidence was generated.

## Received review

I’ll re-read the clarified docs against the unchanged runner/tests and check whether my earlier findings still matter under the narrower drain-budget claim.Delta review of docs-only `197aa9c6b3` against unchanged r3 bytes (`run-pilot.mjs` / `run-pilot.test.mjs`). Hashes were not recomputed. Original 19cc review is not restated as satisfied and is not changed.

The narrowed claim matches this code:

- `TERMINAL_CLEANUP_MS` is armed at `_cleanup` entry (`run-pilot.mjs`), after `cleanupAfterActiveSample` waits out any in-flight live sample.
- Polling waits are clamped with `deadline - Date.now()`. A `sample()` that starts while `Date.now() < deadline` can still run `processSnapshot`’s 2s `spawnSync` timeout. Exhaustion then does a separate adopt-enabled `sample()` (`PILOT_FINAL_SNAPSHOT_FAILED` if that throws).
- Identity-unverified `cleanupExactChild` (5s+5s on the Node handle) never sees `TERMINAL_CLEANUP_MS` and already sets `ok: false`.
- Exhaustion still records `PILOT_TERMINAL_CLEANUP_DEADLINE_EXHAUSTED`, keeps survivors, and forces `receipt.ok === false`.
- Historical `35f2417e…` is now labeled as the initial-pilot runner, not r3. The prior hard 30s stop-to-end claim is explicitly not treated as met. No new run is claimed.

Prior P3s remain true as retained limits, not as repair-blocking defects under this diagnostic contract: 5s SIGINT grace can spend the leader `groupTermMs` default and skip SIGKILL with a non-green receipt; 124/125/130/143 are preserved and are not `custody.ok`. Both are now written in the 2026-09-17 section. Sampled double-fork/reparent remains the stated blindspot. No unsafe group/PID signalling path showed up in this re-read.

Mid-drain snapshots still advance the same `Date.now()` deadline; the extra wall time is the pre-entry wait, a 2s hangover on a snapshot started before the deadline, the post-exhaustion evidence snapshot, and the unverified-identity fallback. That is a tighter drain budget, not a reintroduction of the withdrawn 30s stop-to-end guarantee.

**Delta VERDICT: READY** for this documentation-only narrowing. Not a rescues of the old wall-clock contract; not a scored-cell or generic subtree claim. Original 19cc verdict stands as previously given.

