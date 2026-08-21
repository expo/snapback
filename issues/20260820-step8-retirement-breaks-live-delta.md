# Step 8's registry retirement fires during normal serving, breaking live-delta

**Status:** Open — repair implemented; external live-gate confirmation pending
**Filed:** 2026-08-20
**Severity:** High — regression on `main`
**Systems:** Live/realtime, Security/authorization, Storage
**Related:** LLP 0285 §6 step 8, LLP 0290, `8de11f06e`, `8176b4348`

## Finding

`demos/_kit/tests/live-delta-e2e.mjs` fails on `main` with:

```text
SnapbackDiagnosticError: SNAPBACK_AUTH_INTERLOCK_RETIRED:
authorization participant registry is retired
```

That diagnostic was introduced by `8de11f06e` (step 8) and is raised at
`crates/snapback-kernel/src/storage.rs:1723` and
`crates/snapback-kernel/src/storage/room_authority.rs:2003`. It is firing in an ordinary
serving flow rather than only on genuine participant replacement.

Verified by running the gate on `main` directly, outside any agent sandbox — the failure is
not lane-local and not environmental.

## Why the landing checks missed it

Step 8 and its retirement fix were verified with `cargo check --all-targets --workspace`,
kernel 799, sync 243 and engine 456, plus a targeted review that confirmed the A-beside-B bind
and the held-permit regression. **All of those passed.** What none of them exercised was a
live end-to-end serving flow.

The complete F-3 battery would have caught it, but the codex sandboxes cannot bind a loopback
listener, so every lane that touched these gates stopped at server startup and reported the
bind denial rather than the real result. The failure only became visible when the gate was run
from an unsandboxed shell.

This is the same shape as the toolchain preconditions recorded in
`issues/20260820-f3-complete-battery-toolchain-preconditions.md`: a whole class of gates
silently degrades to "cannot start" and the underlying product failure stays hidden.

## Required repair

- Registry retirement must fire only for genuine participant replacement/retirement, not for
  ordinary serving. Determine which lifecycle transition is wrongly marking the registry
  retired, or which live path is consulting a retired registry it should not be.
- **Do not fix this by weakening the retirement check.** `8176b4348` closed a real defect:
  a permit obtained from participant P0 remained usable after P0 was replaced by P1, and the
  frame could reach transport. That property must survive.
- Add a live-flow regression so this class is covered by something faster than the complete
  battery.

## Acceptance

- `node demos/_kit/tests/live-delta-e2e.mjs` passes.
- The held-permit regression from `8176b4348` still fails without the retirement fix.
- A test exercises ordinary serving against a live registry so the two cases are distinguished.

## Repair implemented (2026-08-21)

No ordinary-serving lifecycle transition was retiring the registry. The managed server writer
gate treated every non-neutral preflight as requiring a room-authority reservation, even while
the database intentionally remained `ParticipantBound` before auth-time activation. Participant
preparation requires `READY`, and its non-live error was mapped to
`SNAPBACK_AUTH_INTERLOCK_RETIRED`; the live-but-dormant registry was therefore misreported as
retired.

The kernel now owns the lifecycle query that decides whether an authorization reservation is
required: `Disabled` and `ParticipantBound` preserve the former in-turn behavior,
`ParticipantPending` fails closed as unavailable, and `ParticipantReady` takes the exact
reservation path. Both the managed writer gate and direct engine helper consume that query.
Registry retirement and every post-replacement issued-authority validation remain unchanged.

`dormant_serving_schema_load_does_not_report_registry_retirement` exercises the real Axum
schema-load route against a fresh serving database. It failed before the repair with HTTP 500 and
the exact retirement diagnostic, and passes afterward with the committed schema hash.

The `8176b4348` property was mutation-checked independently: temporarily neutralizing the old
registry's authoritative retired bit made
`same_database_participant_replacement_rejects_held_room_permit` fail at the final transport
boundary. Restoring it made that regression and
`same_database_replacement_rejects_previously_admitted_transport_handoff` pass.

All non-network acceptance checks pass. This agent execution sandbox denied a minimal
`127.0.0.1:0` bind and the live gate reached the same OS error after runtime bootstrap, so the
ticket remains open only for an unsandboxed run of `node demos/_kit/tests/live-delta-e2e.mjs`.
