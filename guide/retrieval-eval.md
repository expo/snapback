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
reviewed: 2026-08-08
reviewed-commit: effa2773760fd0d740c49f06990b3fde5e82a66b
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
land). Each case ends with two machine-parsed lines, consumed by the
[static routing check](#static-routing-check): `Expected pages:` lists
guide-relative paths in backticks (alternatives joined with "or"), and
`Route terms:` lists, in double quotes, the vocabulary an arriving agent
would plausibly grep for.

1. **Realtime:** "Add a live-updating list of items to an app built on
   Snapback." (Plus `getting-started/your-first-backend.md` when starting
   fresh.)
   Expected pages: `realtime/live-queries.md`.
   Route terms: "realtime", "subscription", "live-updating".

2. **Ephemeral:** "Let two users of my Snapback app see each other's
   cursors."
   Expected pages: `recipes/presence-cursors.md` or
   `realtime/ephemeral-state.md`.
   Route terms: "cursors", "presence".

3. **Auth:** "Scope a query so each signed-in user only sees their own
   rows."
   Expected pages: `auth/sessions-and-principals.md`,
   `recipes/hidden-hands.md`.
   Route terms: "per-user", "row security", "hidden data".

Cases 4–8 are regression seeds from the replicated 2026-08-04/05 bakeoff and
2026-08-06 G4 external-proof discoverability misses (LLP 0187 T7, landed under
LLP 0186 W2). The standing rule: every replicated discoverability miss, once
fixed in the guide, must add a seed case here that would have caught it.

4. **Relational routing:** "Show a user's conversation list (a membership
   join)." The run fails if the plan hand-writes the join in
   `defineJsLiveQuery`.
   Expected pages: `backend/relational-queries.md`.
   Route terms: "joins", "conversation membership", "relational".

5. **Ephemeral vocabulary:** "Add a typing indicator." The plan must reach
   `useSnapbackPresence` from either vocabulary entry point (schema-side
   `ephemeral`/`useSnapbackEphemeral` grep or client-side `presence` grep).
   Expected pages: `realtime/ephemeral-state.md` or `clients/react.md`.
   Route terms: "typing indicator", "ephemeral", "presence",
   "useSnapbackPresence".

6. **Operating:** "A mutation is misbehaving — inspect what it read and
   wrote." The run fails if the plan reaches for `curl`, raw host-op calls,
   or a one-off verification script without naming the console.
   Expected pages: `operating/admin-console.md`.
   Route terms: "console", "inspect function", "debug backend".

7. **Assets:** "Upload a photo from an Expo app without login." The plan
   must state the owner-authorization rule — attempt creation may be public,
   but ownership checks are never anonymous.
   Expected pages: `backend/assets.md` (the unified ImagePicker recipe).
   Route terms: "upload", "Expo ImagePicker", "images".

8. **Expo binding identity:** "My Expo app reports
   `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH`." The plan must regenerate the
   descriptor, stop an older supervisor, and restart the supervised loop; it
   fails if it suggests overriding the identity or weakening binding
   admission.
   Expected pages: `clients/react-expo.md`.
   Route terms: "SNAPBACK_APP_BINDING_IDENTITY_MISMATCH", "expo".

9. **Asset rendering:** "My uploaded image renders as an empty `<Image>` on
   a sessions-mode server." (The replicated 2026-08-06 rematch-bakeoff miss:
   the working pattern — the public-immutable URL plus handling the
   rendition-publication race — was found only by reading package source.)
   The plan must hand `useSnapbackAssetImage`'s `src` to the image tag, not
   hand-build a delivery route or add an `onError` retry loop.
   Expected pages: `backend/assets.md`.
   Route terms: "empty image", "render image", "useSnapbackAssetImage",
   "strict delivery URL".

Cases 10–14 are Rosetta-tier seeds from the LLP 0186 W2 amendment's
worked-example journeys (`protected-live-crud`, `expo-media-upload`,
`relational-queries`, `ephemeral-presence`, `reactive-queries`): a
coding agent arriving with competitor vocabulary must still land on the
correct Snapback security boundary, not a plausible-sounding guess.

10. **Rosetta — protected reads:** "I'm coming from Supabase — how do I
    scope a query with row-level security so users only see their own
    rows?" The run fails if the plan claims `authScopeField` alone
    enforces the filter, or if it never states the `authUserId()`
    predicate in the query's filter as the actual boundary.
    Expected pages: `auth/sessions-and-principals.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase RLS", "row-level security", "row security".

11. **Rosetta — asset upload:** "I'm used to Supabase Storage — how do I
    upload and attach a photo from an Expo app securely?" The run fails
    if the plan treats upload authorization as anonymous.
    Expected pages: `backend/assets.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase Storage", "Convex generateUploadUrl",
    "object storage".

12. **Rosetta — relational reads:** "I'm used to Supabase's nested joins —
    how do I read a conversation's messages with the sender's name
    attached?" The run fails if the plan hand-writes the join in a JS
    live query instead of using the bounded relational surface.
    Expected pages: `backend/relational-queries.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase joins", "Convex joins", "nested joins".

13. **Rosetta — presence and cursors:** "I'm coming from Supabase
    Presence/Broadcast — how do I show who's online and live cursor
    positions?" The run fails if the plan invents two different Snapback
    mechanisms for the two cases instead of one ephemeral mechanism with
    TTL.
    Expected pages: `realtime/ephemeral-state.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Supabase Presence", "Supabase Broadcast", "cursors".

14. **Rosetta — reactive queries:** "I'm used to Convex's useQuery — how
    do queries stay live in Snapback?" The run fails if the plan claims
    Snapback's hook is identical to Convex's auto-reactive model without
    naming the backend-declares/client-subscribes split.
    Expected pages: `clients/react.md` and
    `recipes/coming-from-convex-and-supabase.md`.
    Route terms: "Convex useQuery", "useQuery".

Cases 15–16 are absorption seeds from the 2026-08-01 optimistic-create/app-error
and 2026-08-05 large-fixture guide-gap tickets (LLP 0138 bakeoff and LLP 0183
Lane 1 misses, absorbed 2026-08-07).

15. **Large fixtures:** "Load a deterministic 5,000-row acceptance fixture —
    the seed refuses with `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`." The run
    fails if the plan tries to raise or dodge the seed ceiling, or reinvents
    an ungated import mutation without the sentinel-closed bootstrap gating.
    Expected pages: `testing/large-fixtures.md`.
    Route terms: "SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED", "large fixture",
    "seed ceiling".

16. **Domain errors and optimistic create:** "Show 'card is locked' copy when
    a mutation is rejected, and optimistically create a row whose ID the
    server mints." The run fails if the plan parses `SNAPBACK_HANDLER_FAILED`
    message text, or forges a provisional generated row ID instead of the
    intent-keyed pending sidecar.
    Expected pages: `clients/react.md` (both sections) and
    `backend/mutations.md` (declared refusals).
    Route terms: "optimistic create", "ctx.refuse", "refusals".

Case 17 is an absorption seed from the 2026-08-07 three-lane measurement
(Diary 0066 finding 6, `issues/20260807-arg-filtered-retention-none-maze.md`).

17. **Retention routing:** "My args-filtered live query classifies offline
    retention `none` — why, and what are my options?" The run fails if the
    plan blames the args (explicit `arg(...)` filters are eligible), removes
    the filter without fixing the missing declarations, or trial-and-errors
    through `composition-activation`/`registerQuery` instead of routing by
    workload shape.
    Expected pages: `sync/offline-and-retention.md` (the route-by-workload-
    shape table).
    Route terms: "retention", "args-filtered", "retainable",
    "SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE".

Cases 18–20 are absorption seeds from the 2026-08-08 Zerobugs-control guide-gap
tickets (declared refusals, principal↔app-identity binding, SVG assets).

18. **Declared refusals:** "My mutation rejects a duplicate seat reservation,
    but the client only sees `SNAPBACK_HANDLER_FAILED` — how do I give the
    caller a reason it can act on?" (The replicated miss: the Zerobugs control
    shipped every application-semantic refusal as a bare `throw` through ten
    receipted gate attempts.) The run fails if the plan parses the failure
    message, invents an `{ ok: false, error }` success envelope, or reuses a
    platform `SNAPBACK_*` code as the domain code.
    Expected pages: `backend/mutations.md`.
    Route terms: "declared refusal", "ctx.refuse", "SNAPBACK_APP_REFUSAL",
    "appCode".

19. **Principal to app identity:** "My app has its own users table with OAuth
    ids — how do I connect Snapback's `ctx.auth.userId` to it?" The run fails
    if the plan writes a mutation that takes the app user id (or an email) as
    an argument and binds it to the caller's principal, or seeds binding rows
    with captured principal ids.
    Expected pages: `auth/app-identity-binding.md`.
    Route terms: "bind a principal", "identityBinding", "identity broker",
    "app user row".

20. **SVG assets:** "Uploading an `image/svg+xml` file fails even though I
    listed it in the intent's `accept.mediaTypes`." The run fails if the plan
    tries to widen the trusted image detector, treats the refusal as a bug, or
    serves SVG through an app alias without `nosniff` plus a sandbox CSP.
    Expected pages: `backend/assets.md`.
    Route terms: "SVG", "image/svg+xml",
    "SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED", "nosniff".

Case 21 is an absorption seed from the 2026-08-07 zerobugs `zb5-hot` `v4`
attempt (`issues/20260808-sessions-store-copy-needs-auth-keyring-sibling.md`):
a full receipted gate run was burned discovering that a database copy is not a
store copy, and nothing in the guide named the sibling.

21. **Store copy and backup:** "Copy a running Snapback store somewhere else
    and boot on the copy." The run fails if the plan `cp`s the `.sqlite3`
    (with or without a `*` glob), hand-derives the sibling list, waits for a
    clean shutdown to make a `cp` safe, or reaches for `snapback auth backup`
    expecting a bootable directory.
    Expected pages: `operating/backup-and-copy.md`.
    Route terms: "backup", "copy database", "clone database",
    "auth-keyring.json", "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE".

## Static routing check

The deterministic half of this corpus is executable:
`scripts/check-retrieval-eval.mjs` (run standalone or via
`node scripts/check-guide.mjs`) parses the numbered cases above and
verifies, on every guide check, that (1) each case's expected pages exist,
(2) each case has at least one lexical route — a route term found in the
capability index's Aliases column on a row pointing at an expected page,
or in an expected page's title, a heading, or its body — and (3) every
Rosetta record alias (`guide/rosetta/records/*.json`) is mirrored as a
seed-case route term, per the LLP 0186 W2 amendment.

What it does **not** prove: that a cold agent actually navigates to the
page within the ~15-tool-use budget, plans with the paved technique, or
avoids the anti-patterns. The checker only guarantees the lexical path
exists; whether an agent takes it remains the manual/W1-instrument
protocol below, with transcripts under `guide/eval-runs/`.

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
