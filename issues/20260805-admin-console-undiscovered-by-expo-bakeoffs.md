# The shipped admin console was never discovered by three independent Expo/messaging builds

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Developer experience, Admin console, Onboarding
**Date:** 2026-08-05
**Governing:** LLP 0017 (admin console and inspection surface)
**Related:** LLP 0176; `guide/operating/admin-console.md`; Diaries 0058
(`messaging-snapback`), 0058 (`relay-room-expo-backend-bakeoff`), 0059
(`tandem-expo-messaging-bakeoff`), 0060

## Problem

LLP 0017 is Accepted and `guide/operating/admin-console.md` marks it
`status: current`, `maturity: shipped`: a browser console with Data (browse
declared tables), Functions (run queries/mutations/actions and inspect
captured reads/writes), and Realtime (delivery state) views, launchable in one
command against a local dev server.

None of the three independent 2026-08-05 messaging bakeoffs (`tandem-expo-bakeoff`,
`relay-room-bakeoff`, `messaging-snapback`/`messaging-convex`) mention it,
reference it, or appear to have discovered it. All three instead debugged
through a mix of raw host-operations calls, `curl`, CLI `assets put`
workarounds, and hand-written verification scripts — exactly the kind of
manual, ad hoc inspection the admin console exists to replace. This is not a
capability gap; the tool that would have shortened at least the "figure out
whether the bug is server-side or client-side" step in every one of the three
builds already exists and was invisible to all three builders.

This matters more than an ordinary guide gap because Relay Room's independent
weighted score attributes Snapback's largest measured loss to exactly the
dimension this tool would move: "Operations + current maturity," scored 62
(Snapback) vs 96 (Convex) — largely a proxy for "does this platform have a
polished way to see what's happening without writing more code." An unused,
already-shipped console does nothing for that score.

## Fix shape

- Cross-link the admin console prominently from wherever an Expo/React author
  first gets a local server running — the `react-expo` guide page, the
  `snapback dev` output banner, and any generated `.env.local`/setup output a
  launcher script prints (several bakeoffs printed a phone-reachable
  `EXPO_PUBLIC_SNAPBACK_ORIGIN=...` line; the console URL/launch command
  belongs right next to it).
- Consider having `snapback dev` (and any Expo-profile variant proposed by LLP
  0176 §Design 6) print the console launch command by default, the way many
  frameworks print a local dashboard URL on dev-server boot.
- Add or extend a guide cross-reference so a search from "how do I see what my
  backend is doing" (the actual question every one of the three bakeoffs
  answered by hand) reaches `guide/operating/admin-console.md`.

## Acceptance

- A first-time Expo/React builder following the guide's getting-started or
  `react-expo` path reaches a mention of the admin console before they would
  otherwise reach for `curl`/raw host-operations debugging.
- `snapback dev`'s (or its Expo-profile successor's) boot output includes the
  console launch command or URL.
