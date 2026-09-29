# KR round 0 context

Scope: the remount case in `packages/snapback4/test/keep-device.test.mjs`,
and its observation/online queue lifecycle. No client contract or product edit.

Governing LLPs (in `llp/current/`, none in `foundation/`):

- LLP 3000 §4: Snapback 4 workspace and verification fence.
- LLP 2000.000 §7–8: client tiers and the read contract.
- LLP 3000.019 §3.3: a kept watch's shared observation, keys and linger.
- LLP 3000.023 §10: current retention and queued-work lifetime policy;
  supersedes the universal cap/failure policy in §§3–6.

Active constraints and rationale: LLP 3000.023 §10 permits last-owner
cancellation and resumption on reacquisition. An answer visible at one instant
does not establish that its observation has no queued or active work. Change
evidence still bounds retention; plain revalidation marks the answer. Key,
account, store, row deadline, sign-out and scope withdrawals remain mandatory.
LLP 3000.019 §3.3 owns the unchanged 30-second subscriber-free boundary.

The current client guide and `CLIENT-AND-OPERATIONS.md` retention section agree
with this policy. The test's existing identity assertion tests an idle remount;
it must first establish that state rather than discard the identity requirement.

Risk checked: startup `/changes` from the fixture's own seed can dirty an
in-flight first query. No new mutation is necessary. Instrumentation distinguishes
that path from clocks, presence, retries and later fixture traffic.

Doc updates: this report and one append-only journal entry. No policy change
requires an LLP amendment. The requested SR ticket is absent on this base;
the report carries the resolution for its later integration. Hand-off: none.

Orientation used the repository's `llp-orient` skill from the initialized SR
worktree because this lane's vendor submodule was not initialized. It was read
only; no skill installation or update was needed.
