---
title: Retrieval eval protocol
id: meta.retrieval-eval
order: 91
audience: agent-first
capabilities: []
authorities: [llp/0061-agent-first-snapback-guide.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, scripts/check-retrieval-eval.mjs]
examples: []
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-25
reviewed-authorities-digest: sha256:618b1f3684f3287ede366e0a617fc708ba31b9d7bc2261a9c1a111fc8b1fa90c
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
   Exact diagnostic target: `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` ->
   `/_snapback/guide/clients/react-expo.md#diagnose-a-binding-identity-mismatch`.

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
    Diagnostic pin disposition: `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED` ->
    `shared/per-operation` — The refusal covers seed-effect ceilings generally;
    its primary target remains the versioned-seed refusal guide, while this
    case's intent-specific route is the large-fixtures page.

16. **Domain errors and optimistic create:** "Show 'card is locked' copy when
    a mutation is rejected, and optimistically create a row whose ID the
    server mints." The run fails if the plan parses `SNAPBACK_HANDLER_FAILED`
    message text, forges a provisional generated row ID, or claims the
    lower-level optimistic mutation view is a first-class provider hook.
    Expected pages: `clients/react.md`, `recipes/optimistic-create.md`, and
    `backend/mutations.md` (declared refusals).
    Route terms: "optimistic create", "server-minted ID", "ctx.refuse",
    "refusals".

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
    Exact diagnostic target: `SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE` ->
    `/_snapback/guide/sync/offline-and-retention.md#retain-public-viewer-facts-by-argument-not-authority`.

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
    Diagnostic pin disposition: `SNAPBACK_APP_REFUSAL` ->
    `shared/per-operation` — The application-refusal envelope spans authored
    operations; its primary target remains declarative plans, while this case
    routes mutation authors to the mutations page.

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
    Exact diagnostic target: `SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED` ->
    `/_snapback/guide/backend/assets.md#svg-why-the-image-intent-refuses-it-and-the-safe-adapter`.

Case 21 is an absorption seed from the 2026-08-07 zerobugs `zb5-hot` `v4`
attempt (`issues/closed/20260808-sessions-store-copy-needs-auth-keyring-sibling.md`):
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
    Diagnostic pin disposition: `SNAPBACK_AUTH_PROVIDER_UNAVAILABLE` ->
    `shared/per-operation` — The code spans auth-provider lifecycle and host
    operations; its primary target remains the capability index, while this
    case's missing-keyring symptom routes to backup and copy.

Case 22 absorbs the replicated mutation-authoring miss recorded in
`issues/closed/20260808-ctx-db-verbs-undocumented.md`.

22. **Mutation database verbs:** "Inside a JS mutation, query a declared
    index, collect at most 500 rows, and delete one matched row." The run fails
    if the plan invents raw SQL, scans without a bound, or cannot name the
    `query` → `withIndex` → `eq` → `take` → `collect` builder chain and the
    `ctx.db.delete(table, id)` write.
    Expected pages: `backend/mutations.md`.
    Route terms: "ctx.db", "withIndex", "bounded collection", "delete row".

Case 23 absorbs the repeated headless-call-shape miss recorded in
`issues/closed/20260808-headless-args-shape-guide-snippet.md`.

23. **Headless argument nesting:** "Call a generated headless query with an
    `owner` argument, then subscribe to the same query live." The run fails if
    either call places `owner` beside `args` instead of inside
    `{ args: { owner } }`, or confuses `connectionId` with a function argument.
    Expected pages: `clients/headless.md`.
    Route terms: "args nesting", "nested args",
    "SNAPBACK_ARGUMENT_VALIDATION_FAILED", "liveQuery args".
    Diagnostic pin disposition: `SNAPBACK_ARGUMENT_VALIDATION_FAILED` ->
    `shared/per-operation` — Argument validation is shared across generated
    operations; its primary target remains trusted runtime values, while this
    case teaches the headless call shape.

Case 24 absorbs the repeated verifier-config source-reading detour recorded in
`issues/closed/20260808-verify-config-authoring-guide-anchor.md`.

24. **Verify config authoring:** "Register my headless acceptance suite with
    `snapback verify`, including its execution identities and read/write
    conformance evidence." The run fails if it reaches into an unpublished
    source file instead of a package export, omits the profile's test bytes or
    paths, or returns no target/data/authority/seed context.
    Expected pages: `testing/verify.md`.
    Route terms: "snapback.verify.config.mjs", "defineVerifyConfig",
    "@expo/snapback-cli/verify", "acceptance profile".

Case 25 absorbs the repeated bare-Metro cold-offline source excavation
recorded in `issues/closed/20260808-offline-supervisor-origin-guide-anchor.md`.

25. **Expo supervised cold offline boot:** "After warming an Expo app through
    `snapback dev --expo`, stop the supervisor and prove a cold launch from the
    cached binding and retained receipt using bare Metro." The run fails if it
    omits the bundle-time supervisor-origin environment, invents a new dead
    URL instead of capturing the supervised exchange origin, or claims
    protected reads work offline.
    Expected pages: `clients/react-expo.md`.
    Route terms: "EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN", "bare Metro",
    "cold offline", "persisted-receipt".

Case 26 absorbs the duplicated native-lane simulator setup recorded in
`issues/closed/20260808-headless-simulator-proof-recipe.md`.

26. **Headless iOS simulator proof:** "Drive an Expo iOS proof without opening
    Simulator.app: install and launch the app, dismiss Expo Go onboarding,
    send a custom-scheme command, and capture a screenshot." The run fails if
    it uses `plutil` for the dotted scheme-approval key, expects `simctl` to
    answer the first-open confirmation, or treats URL delivery alone as the
    product witness.
    Expected pages: `clients/react-expo.md`.
    Route terms: "headless simulator", "plistlib", "Expo Go onboarding",
    "simctl openurl", "deep-link drive channel".

Cases 27–31 absorb the paged-list, server-minted optimistic-create,
structured route-argument, and mutation-settlement guide gaps closed or
narrowed on 2026-08-08.

27. **React load-more list:** "Build an infinite-scroll React feed whose
    live queries replace whole page results, survives equal timestamps at the
    boundary, and explains what is actually retained after reload." The run
    fails if the plan paginates on `createdAt`, appends every replacement,
    claims the assembled archive is durable, or feeds a raw key into a
    standard-pattern opaque cursor.
    Expected pages: `recipes/paged-list.md`.
    Route terms: "load more", "infinite scroll", "whole-result replacement",
    "retained pages", "pageKey".

28. **Server-minted optimistic ID under response loss:** "Show a provisional
    create in the same filter/order/count projection as canonical rows, then
    lose the response after commit and settle one intent to one server ID."
    The run fails if the plan forges `Id<Table>`, authors a second reducer,
    retries with a fresh intent, guesses the mapping by content/call order, or
    claims a first-class `useSnapbackMutation` insert API exists.
    Expected pages: `recipes/optimistic-create.md`.
    Route terms: "createOptimisticMutationView", "logical mint", "idMap",
    "ambiguous retry", "response loss".

29. **Structured route arguments:** "Bundle `/projects/:projectId` into a
    query taking `{ context: { projectId, cursor: null, sort: 'asc', tags:
    ['open'] } }`." The run fails if the plan flattens `context`, adds a
    server-side merge, puts `routeParam()` inside an array, or invents
    transforms or defaults.
    Expected pages: `realtime/snapshot-bundles.md`.
    Route terms: "structured route arguments", "nested routeParam",
    "query context", "route group args".

30. **Replay-stable effect intent:** "A client mutation writes a notification
    intent; retries must reuse one provider idempotency key even if the handler
    threw before commit." The run fails if the plan uses `ctx.runtime.id()`,
    parses or hashes the raw `clientMutationId`, calls the settlement surface
    from a query or action, or performs external I/O inside the mutation.
    Expected pages: `backend/mutations.md`,
    `backend/trusted-runtime-values.md`.
    Route terms: "ctx.mutation.settlement", "settlementId",
    "replay-stable effect", "provider idempotency key".

Case 31 absorbs the browser-custody and real-sign-in recipe gaps recorded in
`issues/closed/20260806-guide-gap-browser-auth-custody-indexeddb-adapter.md`
and LLP 0196 T4.

31. **Browser external sign-in and reload:** "Connect my browser app's
    existing external identity to Snapback, bind it to my users table, keep
    protected data signed in across a full reload, and log out safely." The
    run fails if it uses memory custody, gives mailbox/admin/impersonation
    material to page code, exposes a caller-selectable binding mutation,
    keys identity by email, hands a raw external bearer to page state and
    calls that coordinator custody, or claims the local fixture is hosted
    production/OIDC support.
    Expected pages: `recipes/browser-auth.md` and
    `auth/app-identity-binding.md`.
    Route terms: "browser auth reload", "IndexedDB auth custody",
    "createIndexedDbAuthCustodyStorage", "issuer subject".

Cases 32–39 absorb the diary-friction routing misses re-verified by LLP 0202:
job contention and retry observability, Expo filesystem setup, system-field
indexes, the Vite virtual module, headless transport defaults, dev-auth persona
composition, packaged codegen, and existing-app composition.

32. **Retryable durable job and DLQ inspection:** "Enqueue a notification job
    that can race foreground writes, then tell whether it succeeded only after
    a retry or exhausted into the DLQ." The run fails if it accepts the
    one-attempt default for routine contention, promises a separate dead-letter
    queue, or infers first-try success from `lastErrorCode: null`.
    Expected pages: `backend/jobs.md`.
    Route terms: "retryable by design", "SNAPBACK_AUTH_RESERVATION_STALE",
    "dead-letter", "DLQ", "succeeded after retry".
    Exact diagnostic target: `SNAPBACK_AUTH_RESERVATION_STALE` ->
    `/_snapback/guide/backend/jobs.md#budget-retries-for-expected-contention`.

33. **Expo durable-store registration:** "Register Expo file persistence in a
    universal iOS/Android/web app without white-screening web." The run fails
    if it calls `registerExpoFileSystemRqsFiles` on web or hand-writes an
    `expo-file-system` version instead of using Expo's installer.
    Expected pages: `clients/react-expo.md`.
    Route terms: "registerExpoFileSystemRqsFiles", "Platform.OS",
    "white-screening", "npx expo install", "expo-file-system".

34. **System-field index boundary:** "Page a player's rows by `_version` and
    decide whether `.index('by_player_version', ['playerId', '_version'])` is
    legal." The run fails if it declares a system-field index or fails to name
    the authored-partition-index plus system-field range/order path.
    Expected pages: `getting-started/your-first-backend.md` or
    `backend/queries.md`.
    Route terms: "system fields", "SCHEMA_UNKNOWN_FIELD", "_version",
    "composite system-field index".

35. **Vite development virtual module:** "A hand-built Vite app cannot type
    the `virtual:snapback/dev` import used by the Snapback templates." The run
    fails if it invents a physical module or omits the ambient declaration.
    Expected pages: `getting-started/the-authoring-loop.md`.
    Route terms: "virtual:snapback/dev", "snapback-dev.d.ts",
    "snapbackBasePath", "ambient declaration".

36. **Headless live transport default:** "Subscribe with headless `liveQuery`
    and receive updates without manually polling." The run fails if it omits
    `transport: 'stream'` while claiming push updates.
    Expected pages: `clients/headless.md`.
    Route terms: "manual polling", "transport default", "transport: 'stream'",
    "poll()".

37. **Expo multi-persona auth:** "Switch between two acting users in an Expo
    demo using the packaged provider." The run fails if it passes `userId` per
    hook call or claims dev auth composes with the provider's single custody
    identity.
    Expected pages: `clients/react-expo.md`.
    Route terms: "dev-auth, multi-persona", "SnapbackExpoProvider",
    "per-call userId", "one custody identity".

38. **Packaged codegen command:** "Generate a newly scaffolded backend from an
    installed Snapback CLI rather than a Snapback source checkout." The run
    fails if it invokes `node packages/snapback-codegen/index.mjs`.
    Expected pages: `getting-started/your-first-backend.md`.
    Route terms: "snapback generate", "Generate and load", "packaged".

39. **Compose into an existing app:** "Add a Snapback backend to an existing
    `create-expo-app` project." The run fails if it invents `snapback init` or
    hides the current sibling-scaffold/copy workaround and capability GAP.
    Expected pages: `clients/react-expo.md`.
    Route terms: "existing standalone Expo", "backend-only initializer",
    "sibling directory", "compose into existing app".

Case 40 absorbs the control-MCP cold-discovery miss recorded in
`issues/closed/20260808-mcp-control-funnel-invisible.md` and LLP 0202 theme 3.

40. **Agent control MCP setup:** "Give my coding agent access to Snapback's
    local control tools over MCP, and preview the project configuration before
    installing it." The run fails if it discovers only the resource-only
    Guide server, omits the control server's local-admin authority, or edits a
    harness configuration without first using the setup preview.
    Expected pages: `operating/agent-controls.md`.
    Route terms: "mcp-control", "control mcp", "agent setup", "control tools".

Case 41 closes the retrieval regression recorded in
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` and executed by
LLP 0223 ticket 3: the pilot's Snapback lane learned the `auth.mintSession`
HTTP request shape by observation after every documented guess refused with
`SNAPBACK_AUTH_REQUEST_INVALID`. It complements case 19 (which binds an app
identity model to principals); this case is the session-issuing broker
itself.

41. **Session-mint identity broker:** "Implement a trusted server-side
    identity broker: authenticate users at your own front door, invoke
    `auth.mintSession` over HTTP, and hand each user their Snapback session
    bearer." The run fails if the plan guesses request bodies until the
    refusal stops, shells out to `snapback session mint` for every login,
    omits an authority carrier (the AdminWrite token plus the impersonation
    capability), or places operator credentials in an app bundle.
    Expected pages: `operating/host-ops.md`, `auth/native-apps.md`.
    Route terms: "auth.mintSession", "session mint HTTP",
    "SNAPBACK_AUTH_REQUEST_INVALID", "identity broker".
    Exact diagnostic target: `SNAPBACK_AUTH_REQUEST_INVALID` ->
    `/_snapback/guide/operating/host-ops.md#mint-a-session-over-http`.

Case 42 absorbs the supervised Expo-web launcher-boundary miss recorded in
`issues/closed/20260809-guide-gap-supervised-expo-web-launcher-boundary.md`.

42. **Supervised Expo web selection:** "Run an Expo web app through Snapback's
    supervised bootstrap on a dynamically selected backend port, or compose a
    custom session broker without losing that selected origin." The run fails
    if it routes `expo start --web` through `--client-command`, treats that as
    equivalent to `--expo`, or retains a fixed fallback beside a dynamic
    target.
    Expected pages: `clients/react-expo.md`.
    Route terms: "--expo-platform web", "--client-command",
    "SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED", "custom broker origin".
    Exact diagnostic target: `SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED` ->
    `/_snapback/guide/clients/react-expo.md#know-what-the-supervisor-owns`.

Cases 43–46 absorb the Diary 0074 pointing-room guide-gap tickets, fixed
2026-08-10 — the replicated instances of the sophisticated-variant-only
anti-pattern named in LLP 0061's reachability amendment: each page taught
only the advanced variant of a capability, so the probe concluded the
ordinary variant was unsupported and built host glue around a paved path.

43. **Contract presence publishing:** "Publish ordinary `{ name, picking }`
    presence from a Contract surface and keep the entry alive with a
    heartbeat." The run fails if the plan adds a DOM-event/timer bridge in
    host code, drives the generated publish link imperatively from
    `main.ts`, or claims channel publishing is pointer-only.
    Expected pages: `recipes/presence-cursors.md`.
    Route terms: "publish ordinary presence", "pointerChannel",
    "heartbeat", "Collection publishing is not pointer-only".

44. **Contract/Vite local sign-in code:** "Boot sign-in for a non-React
    Contract/Vite surface in local development: obtain the one-time mailbox
    code without privileged material reaching the browser." The run fails
    if the admin token, impersonation capability, mailbox-reader, or
    private-origin material reaches page code, or if the dev middleware
    proxies arbitrary Snapback routes instead of relaying only the code.
    Expected pages: `recipes/browser-auth.md` and
    `auth/sessions-and-principals.md`.
    Route terms: "serve-only dev mailbox relay", "sign-in code",
    "authRequestCode", "authExchange".

45. **Disclosure-claim ceiling:** "State 'no participant sees another's
    vote until the round is revealed' as a Contract invariant." The run
    fails if it treats a count-partition invariant as proof of
    rendered-text equality, per-row provenance, or wire bytes, or if it
    does not pair the contract block with a two-principal wire-level
    acceptance test at the data boundary.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "Contract invariant", "disclosure claim",
    "wire-level acceptance test".

46. **Keyed scopes with presence:** "Re-key a Contract surface's durable
    live queries and its presence scope from one piece of component state
    (switching rooms)." The run fails if the plan merges a companion
    ephemeral-only surface into the keyed links (required before the
    2026-08-10 keyed-ephemeral fix, obsolete since), omits the generated
    publish link, or claims a keyed `forceEphemeralState` exists.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "keyedQueryScopes",
    "SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED", "forceEphemeralState".
    Exact diagnostic target: `SNAPBACK_CONTRACT_EPHEMERAL_UNSUPPORTED` ->
    `/_snapback/guide/clients/contract-adapter.md#boot-one-surface-one-idempotent-ensure`.

Case 47 absorbs the npm-only generated-typecheck gap recorded in
`issues/closed/20260811-guide-gap-npm-generated-contract-typecheck.md`.

47. **Npm-only generated Contract imports:** "Codegen succeeds in my React or
    Expo app, but broad strict `tsc --noEmit` cannot resolve
    `@exact/contract/exports` from generated `.contract-meta.ts` files." The
    run fails if the plan installs a private/unavailable Exact package, probes
    package presence to select output, permanently excludes all generated
    Contract files on a current release, or omits the committed
    `contractMetadata: "exact"` opt-in for a real Contract project.
    Expected pages: `getting-started/generated-artifacts.md` or
    `clients/contract-adapter.md`.
    Route terms: "@exact/contract unavailable", "npm-only typecheck",
    "contractMetadata", "contract-meta".

Case 48 absorbs the replicated 2026-08-12 sweep miss
(`issues/closed/20260812-guide-gap-auth-client-surface-and-whoami.md`):
three lanes reverse-engineered `coordinator.settledView()` /
`session.authority.userId` because no page named the blessed whoami.

48. **Signed-in principal whoami:** "After boot, am I signed in, and as
    whom? Use `settledView` / `currentAuthorizationScope` / who am I."
    The run fails if it enumerates coordinator prototypes, treats
    `authSession()` as the identity read, or tells a TypeScript app to
    cast the client for these methods.
    Expected pages: `auth/sessions-and-principals.md`.
    Route terms: "who am I", "am I signed in", "settledView",
    "currentAuthorizationScope", "whoami".

Cases 49–52 exercise LLP 0237 rollout 1's cold path from familiar module and
Node vocabulary, plus both new definition-attribution codes, to the generated
restriction profile.

49. **Handler helper import:** "Can I import a helper into a Snapback handler?"
    The run fails if it claims relative imports are already admitted, adds a
    bundler alias, or misses the current same-file function-declaration path.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "Can I import a helper?", "BUNDLE_UNSUPPORTED_IMPORT",
    "same-file helper".

50. **Node crypto in handlers:** "Can I use Node crypto in a Snapback
    handler?" The run fails if it treats an engine ambient as Node
    compatibility or omits the generated profile's per-operation capability
    answer.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "Can I use Node crypto?", "node:crypto",
    "BUNDLE_UNSUPPORTED_PROCESS".

51. **Unexported definition:** "Generation reports
    `SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED`; what exactly should I export?"
    The run must use the structured binding/span/remediation and must not edit
    a generated manifest.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED",
    "unexported top-level operation", "definition path".
    Exact diagnostic target: `SNAPBACK_CODEGEN_DEFINITION_NOT_EXPORTED` ->
    `/_snapback/guide/backend/handler-runtime.md#diagnostic-attribution`.

52. **Unserializable definition value:** "Generation reports
    `SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE`; how do I find the bad
    option?" The run must follow the exported binding and nested property path
    to the authored span rather than inspecting evaluator internals.
    Expected pages: `backend/handler-runtime.md`.
    Route terms: "SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE",
    "nested property path", "definition path".
    Exact diagnostic target: `SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE` ->
    `/_snapback/guide/backend/handler-runtime.md#diagnostic-attribution`.

53. **Declaration suggestions:** "How do I get Snapback to write my result
    contract?" The run fails if the plan invents bounds or table identity,
    treats suggestion provenance as runtime authority, bulk-applies operations,
    or claims a manually pasted patch received the stale-safe apply check.
    Expected pages: `getting-started/the-authoring-loop.md` or
    `backend/queries.md`.
    Route terms: "infer result", "suggest contract",
    "write my result contract", "convex-style inference".

Cases 54–56 absorb the 2026-08-15 multi-profile sweep's asset-authoring,
sessions-evolution, and familiar-profile discovery misses.

54. **Store media from explicit authoring:** "Add a photo field while writing
    my Snapback schema and functions." The run fails if the plan stores a
    base64/data URL in `v.string()` or `v.json()` instead of routing through a
    generated asset intent, trusted finalization, and typed reference.
    Expected pages: `backend/assets.md` or
    `getting-started/your-first-backend.md` or `backend/handler-runtime.md`.
    Route terms: "storing media", "data URL media", "base64 image".

55. **Sessions schema evolution:** "A schema edit rotated deployment identity;
    `expectedDeployment` and `observedDeployment` differ, but I need to keep
    rows already written by a partial load." The run fails if it deletes the
    database, hand-edits hashes, or treats a field retype as additive. It must
    boot the exact predecessor carrier and use the packaged successor or
    reviewed-migration path.
    Expected pages: `backend/schema-evolution.md`.
    Route terms: "sessions schema change", "expectedDeployment",
    "partial load", "successor activation".

56. **Familiar profile end-to-end:** "Build an Expo Router app with Snapback's
    familiar TypeScript handlers, persistent native login, and a photo upload."
    The run fails if it presents familiar as the default/stable profile, keeps
    native custody in memory, omits per-handler membership checks, uses inline
    hook argument objects, or stores the photo as a data URL.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "Familiar TypeScript", "Expo Router familiar",
    "SecureStore custody".

Cases 57–58 absorb the 2026-08-16 Coterie guide gaps for sessions fixture
installation and inverse provider-neutral Contract adaptation.

57. **Sessions fixture install:** "Install deterministic password accounts,
    principal-owned profile rows, and typed avatar media in a sessions-mode
    app; rerunning must sign in and report a match without an asset upload or
    application-data write." The run
    fails if it seeds captured principal ids, treats
    `SNAPBACK_AUTH_PASSWORD_EXISTS` alone as a match, skips the fixture-source
    digest check, or uploads before the matched-repeat branch exits.
    Expected pages: `recipes/sessions-fixture-install.md`.
    Route terms: "install sessions fixtures", "fixture-source digest",
    "SNAPBACK_AUTH_PASSWORD_EXISTS", "matched repeat".
    Diagnostic pin disposition: `SNAPBACK_AUTH_PASSWORD_EXISTS` ->
    `shared/per-operation` — Password-existence is a reusable auth refusal;
    its primary target remains error translation, while this case requires the
    matched-repeat fixture proof.

58. **Frozen provider-neutral Contract adapter:** "Implement an already-frozen
    provider-neutral `ContractDataProvider` over Snapback without changing the
    foreign declaration digest." The run fails if it generates a
    provider-specific manifest, reports an unprobed whole-manifest behavioral
    claim, polls above the seam, silently accepts future operations, or leaks
    Snapback diagnostic/app refusal codes instead of declared serialized error
    names.
    Expected pages: `clients/contract-adapter.md`.
    Route terms: "frozen provider-neutral declaration",
    "ContractDataProvider adapter", "foreign declaration digest",
    "no polling above the seam".

Cases 59–70 absorb the Phase 1C high-value route misses reproduced in diaries
0092–0105 and tracked by LLP 0295. Their route terms deliberately preserve the
familiar-looking or failure-shaped vocabulary the builders actually used.

59. **Fixed-origin development:** "Attach Expo web to an already-running
    fixed-origin Snapback server, keep its pinned port, and hot-load generated
    artifacts." The run fails if it composes ordinary authoring from
    `snapback start --startup-artifacts`, parses logs instead of the
    application receipt, omits the lifecycle-owned sessions carrier rewrite,
    passes a raw origin to `SnapbackExpoProvider`, or treats port occupancy as
    listener identity.
    Expected pages: `recipes/fixed-origin-development.md`.
    Route terms: "fixed-profile development loop", "--external-client-origin", "receipt-verified attach", "startup carrier".
    Required guidance: "The lifecycle owner writes the complete sessions startup carrier before first bind and rewrites it on every successful regenerate before hot-load", "snapback start --startup-artifacts ... remains available for lower-level diagnosis and lifecycle acceptance harnesses".
    Rejected guidance: "Attached regeneration does not rewrite the startup carrier", "Only managed start/restart/reset paths refresh startup-artifacts.json".

60. **Node multi-persona custody:** "Several app clients run as different
    people in one Node acceptance process, but every persona wrote as Henry."
    The run fails if it assumes separate client objects imply separate durable
    custody or omits one stable `storagePartition` per actor.
    Expected pages: `recipes/multi-persona-clients.md`, `clients/headless.md`.
    Route terms: "every persona wrote as Henry", "multiple clients same session", "personas share login", "storagePartition", "process-global in Node", "multi-persona harness".
    Required guidance: "one stable explicit storagePartition per persona or worker", "DEFAULT_AUTH_STORAGE_PARTITION".

61. **Background writes during auth transitions:** "An eager route-entry
    receipt or feed write fails with
    `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` while login changes." The run
    fails if it creates an unbounded effect/retry loop, treats suspension as a
    content refusal, or declares a queued mutation settled.
    Expected pages: `recipes/auth-transition-writes.md`.
    Route terms: "SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED", "eager route-entry receipt", "background writes during auth transitions", "authorization-suspended foreground".
    Required guidance: "declare `{ key, idempotent: true, successorValid: true }` only for latest-wins housekeeping", "`blockedReason: auth-barrier` means zero transport", "foreground admission is independent of suspended housekeeping", "observe `SNAPBACK_HOUSEKEEPING_SUPERSEDED` through mutation status".
    Rejected guidance: "mark foreground gestures as housekeeping", "retry on a timer while auth changes".
    Diagnostic pin disposition: `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` ->
    `shared/per-operation` — Authorization suspension is a shared outbox
    transition state; its primary target remains the headless authority
    lifecycle, while this case routes background-write policy to the recipe.

62. **Presence heartbeat versus bound value:** "My typing indicator is stuck
    and presence is not expiring under the five-second ceiling. I passed
    `useSurface({ typing: value })`; what is the Supabase `track()` equivalent,
    and should I add a presence heartbeat?" The run fails if it omits
    touch-on-keystroke plus delete-on-idle, uses TTL as the ordinary withdrawal
    path, or adds a second timer around `useSnapbackActivityPresence`.
    Expected pages: `recipes/activity-presence.md`.
    Route terms: "typing indicator stuck", "presence not expiring", "track() equivalent", "supabase track", "presence heartbeat", "surface presence value is a continuous publish".
    Required guidance: "touch-on-keystroke and delete-on-idle", "TTL is the crash/disconnect backstop".

63. **Familiar dynamic array access:** "Use `array[i]` inside a Familiar
    handler." The run fails if it claims dynamic computed access is admitted
    or omits the iterate/static-literal rewrite.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "array[i]", "dynamic computed access".

64. **Familiar imported helper:** "Use an imported helper in a Familiar
    handler." The run fails if it adds an import/bundler alias instead of a
    reachable same-file named function declaration.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "imported helper", "same-file function declaration".

65. **Familiar captured constant:** "Reference a top-level const from a
    Familiar handler." The run fails if it claims the value is captured into
    executable bytes rather than moving it local or passing validated args.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "top-level const", "captured constants".

66. **Familiar trusted time:** "Call `Date.now()` in a Familiar mutation."
    The run fails if it admits ambient time instead of `ctx.runtime.now()`.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "Date.now", "ctx.runtime.now".

67. **Familiar mutation document arrays:** "Return mutation document arrays
    with `v.array(v.doc('todos'))`." The run fails if it promises that result
    carrier for a mutation or action, or misses that queries may return bare,
    nullable, and array document shapes after the landed parity fix.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "mutation document arrays", "v.array(v.doc".
    Required guidance: "mutation/action document arrays refuse before generation publishes activation output".

68. **Familiar monotonic counter:** "I need a monotonic counter in a Familiar
    mutation, but its `sequences` key is rejected." The run fails if it
    endorses the app-level read/current-maximum/increment workaround or claims
    `sequences` is admitted in the Familiar surface rather than routing the
    backend to Explicit.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "monotonic counter", "sequences".
    Required guidance: "Dense scoped sequence allocation is required".

69. **Private authority plus product roster:** "Render a chat display roster
    with join dates and keep send-time recipients, but the membership roster is
    private." The run fails if it makes membership backing public, treats an
    ordinary projection as authority, uses Familiar
    `resourceField: \"_id\"`, or rewrites old receipt membership after a leave.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "private membership roster", "product-visible roster projection", "display roster", "send-time recipient set".
    Required guidance: "Do not make the membership table public", "Snapback captures declared product facts".

70. **Provider connection lifecycle:** "My Contract provider creates a
    connection per subscription; N cells imply N transport connections and
    teardown leaks timers." The run fails if it mints connection ids per
    mount, subscribes before authority settles, nests reads in callbacks,
    omits owner-scoped inspection, treats the provisional warning as a hard
    correctness boundary, or requires relational consolidation below 64.
    Expected pages: `recipes/provider-lifecycle.md`.
    Route terms: "connection per subscription", "N cells imply N transport connections", "provider lifecycle budget", "active connections and subscriptions by owner", "one connection per query", "too many websockets".
    Required guidance: "The provider adapter pattern is one manager above the cells it serves", "never add a timeout or poll a client object to guess when authority settled", "supports independent subscriptions through the 64-per-connection hard ceiling".

71. **Familiar point-read carrier:** "Return zero or one document from a
    Familiar point read that may also carry membership admission." The run
    fails if it adds `{ maxItems: 1 }` to the document array or presents a
    value carrier as an empty-capable relational row-set.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "point read", "bounded document arrays", "results.value".
    Required guidance: "bounded document arrays lower to results.value", "returns: v.array(v.doc".

Case 72 absorbs the 2026-08-21 asset-client accessor mismatch that sent a
packed-package author to a nonexistent raw-client namespace.

72. **Asset client accessor correction:** "I tried
    `client.assets.start(...)`, but the raw `SnapbackClient` has no `assets`
    property. What is the public upload entry point?" The run fails if it adds
    or casts in a `.assets` facade instead of wrapping the client with the
    published `createAssetClient(client)` export.
    Expected pages: `backend/assets.md`.
    Route terms: "client.assets.start", "createAssetClient(client)",
    "raw SnapbackClient assets".

Cases 73–74 extend the provider-lifecycle repair with the remaining exact
wrong vocabulary from the source diaries and review evidence.

73. **Provider WebSocket fan-out:** "My adapter opens one connection per query
    and now has too many websockets. Should I add a connection pool?" The run
    fails if it pools across authority/storage partitions, mints per-cell
    connection ids, or omits the N-cells/one-connection regression route.
    Expected pages: `recipes/provider-lifecycle.md`.
    Route terms: "one connection per query", "too many websockets", "connection pool".
    Required guidance: "one manager above the cells it serves", "Every query cell under that tuple reuses the id".

74. **Provider auth rebuild:** "I need a provider adapter pattern that can
    rebuild stream on auth without a timeout." The run fails if it polls for
    authority, retries a stable blocked state, rebinds the predecessor
    sessions connection, or starts the successor before teardown settles.
    Expected pages: `recipes/provider-lifecycle.md`.
    Route terms: "provider adapter pattern", "rebuild stream on auth".
    Required guidance: "authentication-not-settled", "transitionOwner", "teardown-before-rebuild".

75. **List chat members:** "list chat members without exposing the private
    authority rows." The run fails if it queries membership backing directly,
    copies its row ids, or authorizes from the product projection.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "list chat members".
    Required guidance: "membership row remains the current authorization source", "list remains the bounded, redacted current roster".

76. **Show roster:** "show roster with roles and join dates for a chat room."
    The run fails if it reads history through `list`, invents facts before the
    reported horizon, or reuses an incarnation across leave and rejoin.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "show roster".
    Required guidance: "eventMembers.list and eventMembers.myRole are unchanged", "A leave closes one incarnation".

77. **Who is in the room:** "who is in the room now, and who received a
    message before someone left?" The run fails if it recomputes an old
    recipient set from current membership or drops departed receipt subjects.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "who is in the room".
    Required guidance: "The host writes `recipientIds` onto that row in the same transaction and returns `null`", "Later membership changes do not rewrite the frozen product row".

78. **Membership table public:** "Should I make the membership table public
    so the client can render members?" The run fails if it weakens private-row
    non-enumerability instead of using an ordinary product projection.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "membership table public".
    Required guidance: "Do not make the membership table public".

79. **Enumerate members:** "enumerate members for a room settings screen and
    support add, promote, remove, and leave retries." The run fails if it
    bypasses generated profile operations, makes absent targets enumerable, or
    leaves retry/idempotent branches implicit.
    Expected pages: `recipes/membership-roster-projection.md`.
    Route terms: "enumerate members".
    Required guidance: "manifest publishes the closed three-class matrix", "Clients may retry, but must not convert a denial into existence evidence".

Case 80 absorbs the Messtimate 0.1.24 field-masking miss recorded in
`issues/20260821-0235-field-masking-productization.md`.

80. **Sensitive field split:** "A consumer-visible profile includes a private
    phone number. How do I hide one field or mask the phone number?" The run
    fails if it keeps the value in the wider table and nulls it in a projection,
    makes a private join public, invents a masking flag/helper, or claims the
    workaround provides class-M field masking.
    Expected pages: `recipes/split-sensitive-fields.md`.
    Route terms: "maskField", "mask a field", "hide one field",
    "mask phone number", "private column", "field level security",
    "column visibility".
    Required guidance: "Snapback does not currently provide field masking",
    "The protection comes from row visibility on the second table".

Cases 81–85 absorb the Messtimate 0.1.24 capability-link workflow miss from
LLP 0294 W7.2. The five route terms are the exact plausible wrong vocabulary
recorded in the guide-gap ticket; each must reach the same shipped-slice
decision table before an author invents a token table or assumes identity
authority.

81. **Invite link:** "Should I build an invite link with a token table, or use
    Snapback capability links?" The run fails if it uses an anonymous-set link
    to grant membership, protected data, principal creation, or identity, or
    if it omits the app-owned invitation-row option for product workflow state.
    Expected pages: `recipes/capability-links.md`.
    Route terms: "invite link".

82. **Capture link:** "Open a capture link, let the person continue as a guest,
    then claim the draft after signup." The run fails if it presents a
    capability URL as guest-session authority, omits the separately generated
    guest entry route, or lets the caller choose guest identity/lifetime facts.
    Expected pages: `recipes/capability-links.md`, `auth/sessions-and-principals.md`.
    Route terms: "capture link".
    Required guidance: "First-party guest entry is separate", "The public POST /auth/guest request body is exactly {}".

83. **Claim link:** "Use a claim link to turn an anonymous draft into the
    signed-in user's account." The run fails if it treats capability-link
    possession as account or principal authority rather than routing to an
    app-owned identity ceremony or the shipped guest-to-password transition;
    either path must refuse identity collisions.
    Expected pages: `recipes/capability-links.md`, `auth/sessions-and-principals.md`.
    Route terms: "claim link".
    Required guidance: "A capability link cannot claim an account", "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION".

84. **Single-use token:** "Make a share-to-view URL a single-use token and
    explain what replay returns." The run must choose `uses: 1`, invoke only
    after an explicit action, and render the non-enumerating terminal state;
    it fails if `GET` consumes the use or replay reissues the POST.
    Expected pages: `recipes/capability-links.md`.
    Route terms: "single-use token".

85. **Deep link grant:** "Pass a deep link grant into Expo and use it as the
    recipient's session." The run fails unless it rejects that authority model,
    keeps the `sbl_` URL in volatile closure state only, and uses Expo Linking
    plus explicit capability-link POST without `Authorization`.
    Expected pages: `recipes/capability-links.md`.
    Route terms: "deep link grant".

Case 87 preserves the second-client symptom vocabulary from the same diary
miss and binds it to the runtime warning rather than prose alone.

87. **Second client adopted the same user:** "Why does my second client have
    the same user after another persona signed in?" The run fails if it treats
    the warning as a refusal, proposes clearing shared custody as the default
    repair, or omits the stable per-persona partition.
    Expected pages: `recipes/multi-persona-clients.md`, `clients/headless.md`.
    Route terms: "second client same user", "multiple clients same session",
    "personas share login", "SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE".
    Required guidance: "one stable explicit storagePartition per persona or worker",
    "storagePartition".
    Exact diagnostic target: `SNAPBACK_AUTH_STORAGE_PARTITION_IMPLICIT_REUSE` ->
    `/_snapback/guide/clients/headless.md#construct-one-client-per-backend-and-custody-context`.

Cases 88–89 absorb the Coterie membership-feed miss recorded in Diary 0086
and LLP 0277 F3. Their route terms preserve the run's wrong vocabulary so an
author reaches the checked interim recipe before inventing an unbounded query
or assuming LLP 0278 D3 shipped.

88. **Five-hundred-follow feed:** "Build Following for a 500-follow probe
    without exceeding the `in()` operand bound, then paginate it with one
    global cursor." The run fails if it puts 500 actor IDs beside the cursor
    predicate, scans all matching events, keeps per-chunk cursors, or claims a
    first-class semi-join ships.
    Expected pages: `recipes/chunked-semijoin-feed.md`.
    Route terms: "500-follow probe", "followingFeed", "chunked semi-join",
    "SNAPBACK_QUERY_IN_ITEMS_EXCEEDED".
    Required guidance: "at most 499 actor IDs per chunk",
    "LLP 0278 D3 remains design-only".
    Diagnostic pin disposition: `SNAPBACK_QUERY_IN_ITEMS_EXCEEDED` ->
    `shared/per-operation` — The operand ceiling applies to all relational
    queries; its primary target remains the query-builder bounds, while this
    case routes the feed workaround to the chunked semi-join recipe.

89. **Force the membership-feed chunk seam:** "Prove a membership feed's
    top 20 merge across multiple actor chunks without creating 500 fixture
    accounts." The run fails if the acceptance only exercises one chunk,
    lets product behavior depend on the test seam, or asserts rows without an
    independent ordered result.
    Expected pages: `recipes/chunked-semijoin-feed.md`.
    Route terms: "actorChunkSize", "multi-chunk path", "indexed top-20 per chunk".
    Required guidance: "temporary backend",
    "compares the complete sequence against an independently filtered global feed".

Cases 90–91 absorb the optional-unique-index authoring miss in which the
derived manifest fact looked like a public schema option.

90. **whereApplicable index option:** "Add `whereApplicable: true` to an
    index declaration so uniqueness applies only when an optional component
    is present." The run fails if it passes `whereApplicable` to `.index(...)`
    instead of declaring the component with `v.optional(...)` and passing
    only `{ unique: true }`.
    Expected pages: `backend/queries.md`.
    Route terms: "whereApplicable index option".
    Required guidance: "whereApplicable is not an .index(...) authoring option",
    "If any optional component is absent, that row does not participate".

91. **Unique index optional field:** "Declare a unique compound index that
    includes an optional field." The run fails if it invents a second index
    option or says partially populated rows participate in uniqueness.
    Expected pages: `backend/queries.md`.
    Route terms: "unique index optional field".
    Required guidance: "Use the ordinary public index option { unique: true }",
    "A row participates in uniqueness only when all index components are present".

Case 92 absorbs the first-party guest-session entry closure from LLP 0294 W6.1.

92. **Guest entry and claim:** "Let someone enter as a guest, keep working
    after a browser reload, then claim the same account with a password or log
    out." The run fails if it invents an Expo-only auth owner, supplies ids,
    expiry, or cleanup from the client, weakens custody, or merges into an
    existing password identity.
    Expected pages: `auth/sessions-and-principals.md`, `auth/passwords.md`.
    Route terms: "enterAsGuest", "claimGuestWithPassword", "guest entry".
    Required guidance: "A caller never supplies the principal id, session id, expiry, or cleanup policy", "An existing password identity refuses", "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION".

Cases 93–96 absorb the 2026-08-24 Familiar auth-entrypoint and volatile
activity-presence guide gaps. Their route terms preserve the vocabulary used
before the paved spelling was discoverable.

93. **Familiar defineAuth:** "Where do I import familiar defineAuth while
    declaring a sessions auth program?" The run fails if it reaches through
    `@expo/snapback-codegen/define` or moves auth construction into a function
    module.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "familiar defineAuth".
    Required guidance: "Import `defineAuth` from the same generated server module as `defineSchema`".

94. **Auth in generated server:** "Can auth in generated server define the
    Familiar authProgram, or do I need a cross-package import?" The run fails
    if it claims the constructor is unreachable or recommends source
    inspection.
    Expected pages: `backend/familiar-profile.md`.
    Route terms: "auth in generated server".
    Required guidance: "`defineAuth` is shared schema-module vocabulary".

95. **Presence rate limit:** "My activity presence hits the presence rate
    limit when I call touch on every keystroke." The run fails if it adds an
    app heartbeat or only raises TTL/rate bounds instead of removing volatile
    fields from the value thunk.
    Expected pages: `recipes/activity-presence.md`.
    Route terms: "presence rate limit".
    Required guidance: "Volatile values defeat the no-op dedup".

96. **Typing publishes too often:** "My typing indicator has too many
    publishes and reports SNAPBACK_REACT_PRESENCE_VALUE_CHURN." The run fails
    if it memoizes the thunk function while leaving timestamps, counters, or
    draft text in its returned value.
    Expected pages: `recipes/activity-presence.md`.
    Route terms: "typing indicator too many publishes".
    Required guidance: "bind and memoize only the small state peers actually need".

Case 97 absorbs Diary 0106's table-live symptom vocabulary while preserving
the residual: the HostPlan matcher contract is characterized, but Clique's
React/JS product blank is not yet explained.

97. **Table live query blank after insert:** "My thread is stuck on Loading
    thread after an insert, and the trace says live_delta empty. Should I
    replace the table query with defineJsLiveQuery?" The run fails if it says a
    HostPlan point/parent matcher may legitimately lose a matching insert,
    treats a timing, provisional-identity, auth, optimistic-projection, or HMR
    hypothesis as the established fix, puts a provisional id on an `_id`
    query, waits for a pre-subscribe delta after settlement, or accepts an
    empty canonical post-settlement snapshot. It must not fail a page merely
    for recommending `defineJsLiveQuery` plus a local cache as the documented
    application workaround while the Clique path remains unexplained.
    Expected pages: `realtime/live-queries.md`, `backend/queries.md`.
    Route terms: "blank after insert", "Loading thread", "live_delta empty".
    Required guidance: "HostPlan matching inserts are guaranteed",
    "Clique still observed a blank",
    "Never put a provisional id on a point query",
    "Wait for live delivery only when subscribed before the insert",
    "A post-settlement subscribe with the canonical id must snapshot the row",
    "defineJsLiveQuery plus a local cache remains the documented application workaround",
    "defineJsLiveQuery plus a local cache".

Cases 98–101 absorb the published 0.1.27 Clique guide misses recorded in LLP
0310. Their route terms preserve the failed lookup and the wrong package,
platform, and generated-directory assumptions from that run.

98. **Generated directory spelling:** "Should a Familiar or expo-chat app
    import `_generated/`, or is that a compatibility alias for `generated/`?"
    The run fails if it creates the legacy directory or symlink, or teaches two
    watcher-visible paths for one generated graph.
    Expected pages: `backend/familiar-profile.md`, `start/expo-chat.md`.
    Route terms: "refused alias", "generated directory spelling".
    Required guidance: "The `_generated/` spelling is a refused alias".

99. **Stale auth result lookup:** "A mutation reports
    SNAPBACK_AUTH_STALE_RESULT after the signed-in session changes."
    The run fails if the diagnostic routes to an unrelated asset-retention
    section or retries the old client mutation identity under new authority.
    Expected pages: `auth/sessions-and-principals.md`.
    Route terms: "SNAPBACK_AUTH_STALE_RESULT", "stale auth result".
    Required guidance: "Do not reuse a client mutation identity after the session or authority instance changes",
    "Use a fresh client mutation id for a new authenticated attempt".
    Exact diagnostic target: `SNAPBACK_AUTH_STALE_RESULT` ->
    `/_snapback/guide/auth/sessions-and-principals.md#recover-from-snapbackauthstaleresult`.

100. **URL-first activity presence import:** "Which package exports activity
     presence for URL-first Expo web with SnapbackProvider?"
     The run fails if it omits the paved React import, claims the Expo facade
     expects `SnapbackExpoLifecycleContext`, presents the facade as the paved
     bare-provider contract, or hides the shipped facade behavior and its
     ticketed immediate-withdrawal tradeoff.
     Expected pages: `backend/familiar-profile.md`, `realtime/ephemeral-state.md`, `recipes/activity-presence.md`.
     Route terms: "URL-first activity presence", "useSnapbackActivityPresence".
     Required guidance per page:
     `backend/familiar-profile.md`: "For URL-first web under a bare `SnapbackProvider`, import `useSnapbackActivityPresence` from `@expo/snapback-react`", "Under a bare `SnapbackProvider`, the React hook has no AppState-driven background withdrawal", "typing intent expires by the presence deadline rather than being withdrawn immediately".
     `realtime/ephemeral-state.md`: "For URL-first web under a bare `SnapbackProvider`, import `useSnapbackActivityPresence` from `@expo/snapback-react`", "The React hook under a bare `SnapbackProvider` has no AppState-driven background withdrawal", "typing intent expires by the presence deadline rather than being withdrawn immediately", "The shipped facade currently also mounts under a bare `SnapbackProvider`", "That composition is not the paved contract under LLP 0310.000 Ruling 3", "immediate background withdrawal on web today".
     `recipes/activity-presence.md`: "For URL-first web under a bare `SnapbackProvider`, import `useSnapbackActivityPresence` from `@expo/snapback-react`", "Under a bare `SnapbackProvider`, the React hook has no AppState-driven background withdrawal", "typing intent expires by the presence deadline rather than being withdrawn immediately".
     Rejected guidance: "expects SnapbackExpoLifecycleContext",
     "Use the `@expo/snapback-expo` facade under a bare `SnapbackProvider`; that is the paved choice",
     "The Expo facade is the supported bare-provider contract".

101. **Durable custody in Node and Expo Native acceptance:** "Run expo-chat
     acceptance with durable-required custody from Node or Expo Native."
     The run fails if it selects the Node memory client platform, treats an
     in-memory server database as the problem, or invents a second custody
     store instead of using the template helper. It also fails if it applies
     the web helper to a missing or invalid Expo Native custody module.
     Expected pages: `start/expo-chat.md`, `testing/acceptance.md`.
     Route terms: "durable-required", "SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE", "Expo Native acceptance".
     Required guidance per page:
     `start/expo-chat.md`: "Node `memory` refuses durable custody with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`", "`expo-web` with `fake-indexeddb`".
     `testing/acceptance.md`: "Node `memory` refuses durable custody with `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE`", "`expo-web` with `fake-indexeddb` does not repair Expo Native", "Install `@expo/snapback-expo-custody`, list it in the app's Expo `plugins`, and rebuild the native app", "The module is unavailable in Expo Go".
     Exact diagnostic target: `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE` ->
     `/_snapback/guide/testing/acceptance.md#recover-from-snapbackauthcustodydurableunavailable`.

## Static routing check

The deterministic half of this corpus is executable:
`scripts/check-retrieval-eval.mjs` (run standalone or via
`node scripts/check-guide.mjs`) parses the numbered cases above and
verifies, on every guide check, that (1) each case's expected pages exist,
(2) each case has at least one lexical route — a route term found in the
capability index's Aliases column on a row pointing at an expected page,
or in an expected page's title, a heading, or its body — (3) every named page
contains at least one optional required-guidance phrase, every required phrase
appears somewhere in the named page set, and rejected guidance is absent from
that set, (4) every Rosetta record alias
(`guide/rosetta/records/*.json`) is mirrored as a seed-case route term, per the
LLP 0186 W2 amendment, and (5) every `SNAPBACK_*` code extracted from a case's
route terms has its own exact primary Guide target pin on one of the case's
`Expected pages` or its own explicit `shared/per-operation` disposition
explaining why that code's global primary belongs to a different intent page.
Each exception is case-local and visible; it does not weaken or retarget the
diagnostic registry.

What it does **not** prove: that a cold agent actually navigates to the
page within the ~15-tool-use budget, plans with the paved technique, or
avoids the anti-patterns. The checker guarantees the lexical path and any
case-specific static guidance fence; it does not execute the documented
runtime behavior. Whether an agent takes the route and applies the guidance
remains the manual/W1-instrument protocol below, with transcripts under
`guide/eval-runs/`.

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
