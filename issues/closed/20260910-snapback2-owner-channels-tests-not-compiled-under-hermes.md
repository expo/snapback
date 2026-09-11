# snapback2: `owner_cases/channels.rs` does not compile under `--features hermes`; gated off, so channel journeys have no Hermes-build coverage

**Status:** Closed — the unchanged channel journey compiles and passes under Hermes

- Filed: 2026-09-10 (lane `traps` fix round r1 of the RFC implementation program; reviewer muse M2)
- Area: `snapback2/crates/snapback2/tests/owner_cases/{channels.rs,mod.rs}`, `tests/owner_wire/mod.rs`

## Symptom

`channels.rs` (landed with the typed latest-state channels, `e3e96920ca`) uses `Sse` at `:26,38,48`
ungated, while `Sse` is defined under `#[cfg(not(feature = "hermes"))]` in `owner_wire/mod.rs:136-141`
and imported under the same gate in `owner.rs:24-25`. The whole `owner` integration test crate
therefore failed to compile with `--features hermes` on main, which hid every owner journey from
the Hermes suite until lane `traps` gated `mod channels;` like its siblings (one line in
`owner_cases/mod.rs`).

## What is owed

The gate restores the Hermes build but removes channel-journey coverage from it. Either make `Sse`
available on both builds (it is a test helper; the gate looks incidental) and un-gate the module,
or duplicate the channel journeys in the Hermes suite. Preferred: un-gate `Sse`.

## Not a landing blocker

The gate is the smallest change that makes the Hermes suite compile again; the coverage hole is
inherited from the channels landing, not introduced by the lane.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — production-build coverage gap. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

owner_wire::Sse and its impl remain cfg(not(feature = "hermes")); gating the channels module restores compilation but does not exercise those channel journeys with the shipped engine.

Current sources: snapback2/crates/snapback2/tests/owner_wire/mod.rs and owner_cases/mod.rs. Next: make the test helper available on both configurations and run unchanged channel cases in both. No Hermes build was claimed by this read-only source audit.

## Resolution — 2026-09-10

The shared `BufRead`/`BufReader` imports, `Sse` helper and owner-level `Sse`
import now compile in both configurations, and `owner_cases::channels` is no
longer gated out. The channel journey itself was not weakened or duplicated.

Verified with the exact
`owner_cases::channels::channel_values_expire_without_requests_and_late_subscribers_get_fresh_state`
test in both the default build and `--features hermes`; both pass.
