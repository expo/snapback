---
title: Retrieval eval protocol
id: meta.retrieval-eval
order: 91
audience: agent-first
capabilities: []
authorities: [llp/0061-agent-first-snapback-guide.rfc.md]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-03
reviewed-commit: 3109a3b4f5068595a71448b10788b56b4fa358f5
---

# Retrieval eval protocol

<!-- @ref LLP 0061#5-keeping-it-current-ownership-the-diary-loop-and-a-small-eval — the pinned protocol -->

The repeatable check that the guide's discovery wiring actually works: a
cold agent with a real intent finds the paved road through the guide instead
of building around it. This is the Phase 1 exit criterion and reruns after
any discovery-wiring change (the AGENTS.md pointer, the README row, the
index page, the capability index's shape).

## Fixture

A fresh agent context — same family/tier as the repo's primary authoring
agents — cold-started in a Snapback checkout at HEAD with `AGENTS.md` as the
only steer. No prior conversation, no memory of this repo's guide.

## Seed intents

At least three, across feature areas (extend, don't replace, when new areas
land):

1. **Realtime:** "Add a live-updating list of items to an app built on
   Snapback." Expected pages: `realtime/live-queries.md` (and
   `getting-started/` if starting fresh).
2. **Ephemeral:** "Let two users of my Snapback app see each other's
   cursors." Expected pages: `recipes/presence-cursors.md` or
   `realtime/ephemeral-state.md`.
3. **Auth:** "Scope a query so each signed-in user only sees their own
   rows." Expected pages: `auth/sessions-and-principals.md`,
   `recipes/hidden-hands.md`.

Cases 4–7 are regression seeds from the replicated 2026-08-04/05 bakeoff
discoverability misses (LLP 0187 T7, landed under LLP 0186 W2). The standing
rule: every replicated discoverability miss, once fixed in the guide, must
add a seed case here that would have caught it.

4. **Relational routing:** "Show a user's conversation list (a membership
   join)." Expected pages: `backend/relational-queries.md`. The run fails if
   the plan hand-writes the join in `defineJsLiveQuery`.
5. **Ephemeral vocabulary:** "Add a typing indicator." Expected pages:
   `realtime/ephemeral-state.md` or `clients/react.md` — the plan must reach
   `useSnapbackPresence` from either vocabulary entry point (schema-side
   `ephemeral`/`useSnapbackEphemeral` grep or client-side `presence` grep).
6. **Operating:** "A mutation is misbehaving — inspect what it read and
   wrote." Expected pages: `operating/admin-console.md`. The run fails if
   the plan reaches for `curl`, raw host-op calls, or a one-off verification
   script without naming the console.
7. **Assets:** "Upload a photo from an Expo app without login." Expected
   pages: `backend/assets.md` (the unified ImagePicker recipe). The plan
   must state the owner-authorization rule — attempt creation may be public,
   but ownership checks are never anonymous.

## Budget

The relevant guide page must be loaded within the first ~15 tool uses.

## Rubric

The run passes when the agent:

- (a) loads the relevant guide page(s) within budget;
- (b) plans or implements with the paved technique the page teaches; and
- (c) does **not** reach for the named anti-patterns — hand-wired HTTP glue
  for app data, polling a subscribable query, client-asserted identity.

## Evidence

The transcript of each run is retained under `guide/eval-runs/` (dated
subdirectory per run, one file per intent), referenced from the run's
summary note. A failed intent files a guide gap (see
[conventions](./conventions.md)) and blocks the change that triggered the
rerun until dispositioned.

## Owner and cadence

The guide's named owner (see `capabilities.md` header). Run at Phase 1 exit
and after any discovery-wiring change. Two consecutive runs with a failed
intent escalate to the Exact LLP 0365 retrieval-eval machinery per
LLP 0061's adoption triggers.

## Baseline

The failure exemplars this eval must not reproduce: diary 0010's
connection-state source-reading detour and ENG-22218's hand-wired HTTP glue.
