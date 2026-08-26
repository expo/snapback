# Signup and profile save race the authenticated dispatcher

**Filed:** 2026-08-26 · **guide-gap**
**Source:** Clique grok-4.6 xhigh published 0.1.27, lanes
`grok-clique-explicit` and `grok-clique-familiar`
**Systems:** Guide, Auth, React/Expo
**Owner:** LLP 0310 P17 — straightforward guide ticket
**Related:** LLP 0310 F6 / P15 (reclassified)

## Problem

Two M1 loops the lanes labeled `agent-error` exist because the start
packet does not say how generated mutations relate to auth identity:

1. **Explicit.** `setProfile` in the same tick as `signUpWithPassword`
   used the stale anonymous dispatcher (`400 HANDLE_TAKEN` with no UI
   error). Workaround: `pendingProfile` effect after the authenticated
   dispatcher exists.
2. **Explicit.** `SessionShell` remounted `HomeScreen` on auth and
   dropped the `HANDLE_TAKEN` refuse from the tree. Workaround: stable
   `AppChrome` children slot.
3. **Familiar.** Profile editor mounted before `getMine` seeded, so
   choreography saved an empty handle. Workaround: wait for the profile,
   then init the form.

These are Snapback-shaped (generated mutation hooks bind the current
auth identity; session changes remount auth-gated trees). They are not
a new auth API. Document the order: wait for the authenticated client
and the seeded profile before `saveProfile` / `upsertMine`; keep refuse
UI outside the auth-gated remount.

## Evidence

- Explicit `run-log.md` 1787657600 (both loops)
- Familiar diary M1 / final-report "choreography saved empty handle"
- LLP 0310 P15 (was "not a Snapback ticket"; method in that document
  treats undocumented seams that cause agent-errors as Snapback friction)

## Direction

On the expo-chat start packet and the passwords / React auth page:

- After `signUpWithPassword` / `signInWithPassword`, do not call an
  authenticated mutation in the same tick. Wait until the provider's
  authenticated dispatcher exists.
- Do not mount a profile editor that can save until `getMine` (or
  equivalent) has a row.
- Keep `ctx.refuse` / `HANDLE_TAKEN` UI outside a tree that unmounts
  on auth change.

Do not add a new Snapback API in this ticket. A later product helper is
out of scope here.
