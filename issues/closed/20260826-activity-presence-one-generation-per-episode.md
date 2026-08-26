# `touch()` started a new presence generation on every call

**Filed:** 2026-08-26
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** Ephemeral state, React/Expo
**Owner:** LLP 0310.000 Track D / Ruling 3
**Related:** `issues/closed/20260825-guide-gap-activity-presence-url-first.md`
  (docs only; that close-out says this product change was not implemented),
  `issues/20260825-ruling-3-vs-llp-0257-background-withdrawal.md`

## Problem

`useSnapbackActivityPresence`'s `touch()` does `activity.generation += 1`
on every call (`packages/snapback-react/implementation.mjs`). That cancels
the in-flight publish. Per-keystroke `touch()` therefore never lands a
typing row in time for Clique's frozen 2s appearance check. Familiar
worked around it by publishing once on typing start and idle-stopping
locally, then isolating `MessageComposer`.

Generation fencing against overlapping *logical* rows is load-bearing.
Per-keystroke new generations are not.

## Evidence

- Familiar diary M3 / final-report correction loops
- LLP 0310 F4 / P6
- LLP 0310.000 Ruling 3, acceptance D1

## Direction

One typing episode reuses the generation of the first `touch()` until
`withdraw`, idle, unmount, routing-key change, or session change. Those
events still fence earlier in-flight publishes so a delayed completion
cannot resurrect presence. Per-keystroke `touch()` must not start a new
generation or cancel that episode's in-flight publish.

`touch()` currently uses the generation bump as the fence for two other
things, so an implementation must replace both rather than just delete the
bump:

- **Episode epoch.** `scheduleActivityDeadline` and `expireActivity` fence on
  `activity.generation` today; `attemptActivityWithdrawal` does **not** — it
  always issues the delete and uses the generation only to clear errors
  afterwards, with its callers doing the pre-call checks. Introduce a distinct
  monotone episode epoch so a re-armed idle deadline invalidates its
  predecessor timer without minting a new presence generation. The wire
  generation changes only at episode boundaries. **Do not put the epoch fence
  in front of the delete** — that can drop a required withdrawal.
- **Deadline still extends.** Every `touch()` pushes the idle deadline to
  `now + idleMs`, exactly as today. Reusing a generation must not make an
  episode expire on the first keystroke's clock.
- **Mid-episode value change.** If the captured value changes within an
  episode, coalesce and publish it under the same generation after the
  in-flight publish settles. Do not cancel the in-flight publish, and do not
  silently drop the update.
- **Every boundary discards pending work.** Abandon a queued coalesced publish
  at *every* episode boundary — `withdraw`, **idle expiry**, unmount,
  routing-key change, session change. Otherwise: V1 in flight, V2 queued, idle
  expiry, V1 settles, V2 publishes — presence resurrected after the episode
  ended. `expireActivity` ends an episode **without** bumping the generation,
  so the discard cannot rely on a generation change to fence it.
- **LLP 0257 is amended.** 0257 requires a per-`touch()` generation increment.
  This change reverses that for the within-episode case and must land as a
  dated amendment to 0257, not silently. 0257's boundary fencing and
  background-withdrawal requirement are untouched.

Do not invent a third hook. **The import split is not settled here.** LLP
0310.000 Ruling 3 holds the package boundary open pending the P20 re-test
(`issues/20260826-probe-expo-presence-facade-bare-provider.md`): the facade
resolves `lifecycleContext?.source ?? await resolveSnapbackExpoLifecycleSource(...)`,
so the Expo provider context is optional, and LLP 0257 requires that
bare-provider fallback. The 0257 background-withdrawal conflict is a separate
ticket and is gated on the same probe.

Fixture: one generation for one episode; delayed publish after withdraw
does not resurrect; Clique-shaped 2s/5s can green without isolating the
whole chrome.

## Resolution

Resolved 2026-08-26 by the LLP 0310.000 Track D implementation. The React
activity helper now keeps one generation per active episode, serializes and
coalesces changed captures behind the in-flight publish, extends the absolute
idle deadline on every touch, and discards queued work independently at
withdrawal, idle expiry, unmount, routing-key change, and auth-session change.
LLP 0257 carries the required dated amendment. Focused React, React
characterization, base presence, and Expo suites plus `ref-check` cover the
landing.
