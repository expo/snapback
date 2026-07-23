# CC-3.3: InstantDB revocation-eviction empirical probe

**Status:** In progress (2026-07-23 — credentials provided in .agent-local-secrets.md; preregistration below committed before execution)
**Severity:** P2
**Systems:** Competitive analysis, Auth
**Author:** Claude (Fable), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0086 CC-3, LLP 0082
**Marker:** llp-0086-execution
Build a probe app on InstantDB answering whether permission revocation evicts
already-synced rows; preregister the observable (row state per client store
constituting evicted/not-evicted) and timing threshold before running.
~~Blocked: no InstantDB account/credentials available.~~ Unblocked
2026-07-23: human-provisioned probe app (App ID
`11d1017c-eed1-4910-b7c4-7ba45fd205fa`; admin token in
.agent-local-secrets.md only — never in committed files).
Exit: probe results recorded in LLP 0082's open questions, both branches.

## Preregistration (2026-07-23, committed before execution)

**Question.** Does InstantDB permission revocation evict already-synced rows
from a live, connected client?

**Setup.** Namespace `probe_items`; a test user authenticated via an
admin-minted token; client = `@instantdb/core` running in Node with a live
`subscribeQuery({ probe_items: {} })` subscription that has delivered the
target row at least once.

**Two revocation shapes, both run:**
- **R1 — rule revocation:** view rule goes from permissive
  (`auth.id != null`) to `false`, pushed server-side while the client stays
  connected.
- **R2 — authorization-data revocation:** view rule is
  `data.visibleTo == auth.email`; revocation = admin-updating the row's
  `visibleTo` to a different value while the client stays connected.

**Primary observable (decided now, interpreted mechanically later):**
- **Evicted** = a subscription callback fires in which the
  previously-delivered row id is absent from `data.probe_items`, with no
  reconnect, within **T = 120 s** of the server change being acknowledged.
- **Not evicted (live)** = the row id is still present in the latest
  callback data at T. Checkpoints logged at 5/15/30/60/120 s.
- **Secondary observation (recorded, not primary):** after a forced fresh
  reconnect (new client instance, same user), is the row served? This
  separates "filtered on re-query but never evicted live" from "still
  served regardless."

**Decision rule for CC-3.4:** the LLP 0074 differentiator claim unblocks
only if **neither** R1 nor R2 produces live eviction within T; if either
shape evicts, the claim is narrowed to exactly the non-evicting shape or
withdrawn, and LLP 0082 §Permissions' inference is corrected either way.

**Receipts:** JSON log of every subscription callback and admin mutation
ack with ISO timestamps, kept in the session scratchpad; a secret-free
summary lands here and in LLP 0082.

**Preregistered contingencies (to prevent post-hoc protocol invention):**
new Instant apps default to allow-all (no rules), so both shapes require at
least one programmatic perms push (instant-cli or documented HTTP surface,
authed by the app admin token). If perms cannot be pushed without an
interactive dashboard/OAuth session, the fallback is one human dashboard
paste of the perms JSON (recorded here as a manual step), R1 executed via
that same manual channel or else recorded not-executable-with-available-
auth, with R2 still executed programmatically. If `@instantdb/core` cannot
sustain a live Node subscription, fallback is a headless browser
(playwright + chromium) with the identical observable; if neither client
path works, the ticket returns to Blocked with the environmental reason —
the observable is not reinterpreted.
