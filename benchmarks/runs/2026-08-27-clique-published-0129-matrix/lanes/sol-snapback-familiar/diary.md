# Clique build diary

## M1 — Accounts and profiles (green, 1787853647)

Built password signup/sign-in/logout on Snapback sessions, durable Expo-web custody, public profiles with server-enforced unique email/handle indexes, live profile queries, full profile editing, fixture-avatar rendering, and an idempotent 16-action M1 replay through the password and mutation paths. The frozen AuthForm and ProfileForm made the browser contract straightforward.

The familiar profile saved substantial declaration ceremony: the model, unique indexes, live queries, and mutations read like ordinary TypeScript, and `ctx.auth.userId` kept profile ownership on the server. Snapback-specific work remained around explicit read/write sets, result validators, generated binding rotation, the separate application-ready receipt, and projecting app refusal codes.

What fought me was setup rather than product logic: the policy record needed more fields than the lane prompt named, familiar custody is fixed to durable-required, the relational take ceiling is 1,024, and the first supervised Metro process raced Snapback's transient generation directory. The served Guide correctly resolved all of these except the Metro/codegen watch race; that failure needed a resolver exclusion inferred from Metro behavior. Diagnostics were generally specific, but `CODEGEN_POLICY_INVALID` lacked a working exact diagnostic page and the transient-directory crash offered no product-aware remediation.
# M2 — Feeds, media, and social graph

I built the additive follows/posts/likes/reposts model, ordered starter replay, live Global and Following projections, set-state like/repost/follow mutations, replies and thread ordering, media composition, and 20-item UI pagination. The final suite covered all 22 suite-owned atoms and the frozen two-client run passed all nine live checks.

What felt easy was the core familiar authoring loop: add flat tables, write `query`/`mutation` handlers, import generated references, and consume them with live React hooks. The generated closed result validators and schema-derived IDs made the UI/backend boundary legible, and the running lifecycle reported the exact additive schema identity and continuity facts without a separate migration command.

What fought me was the boundary around that familiar surface. Inline handlers rejected dynamic array indexing; `ctx.refuse` did not narrow TypeScript nullability; headless query-before-mutate collided with outbox writer custody; and a recorded transport intent survived a client-side refusal, so fixture idempotency and transport idempotency had to be separated. I also planned media as strings before discovering the 32 KiB structured-field ceiling. The served asset Guide gave the right design—typed assets—but only after the single M1→M2 schema successor was already active, so this web fixture uses the supervised Expo asset projection and carries typed media as a candid gap.

The frozen UI kit exposed another integration edge: React Native Web dropped `accessibilityValue` from the DOM even though the kit supplied it. A small web-only semantic projection bridge restored the existing contracts without editing the kit. The frozen route choreography also expected feed tabs to persist on profiles, which screens.md did not make obvious enough during the first UI pass.

The familiar profile saved substantial declaration ceremony and made live queries pleasant. What remained distinctly Snapback-specific was generated artifact custody, the inline-handler dialect, auth/outbox identity, structured storage ceilings, lifecycle-issued bindings, asset custody, and diagnosing which client-level refusal might still have reached durable intent recording. A diagnostic connecting the headless client’s writer state to the exact query/mutation call, and a renderer-compatibility warning for dropped accessibility values, would have shortened this milestone materially.

## M3 — Messaging core (instrument abort)

I built unique-pair DMs, distinct same-member groups, membership roles and history cutoffs, message recipient snapshots, delivered/read aggregates, typing leases, quoted replies, group settings, sender identity semantics, and the complete M3 starter replay. The final suite passed every suite-owned atom, including duplicate-DM prevention, distinct groups, non-admin refusal, quote rendering/jump, and two-pass replay of all installed starter segments. The frozen two-client run eventually proved bidirectional DM delivery and the typing appearance/expiry window.

The familiar profile made the data model and most transactional invariants readable. Unique indexes expressed DM and fixture identity cleanly; handlers could take membership snapshots and enforce roles beside the writes; generated IDs kept conversation/message joins honest; and the React surface remained compact. It felt close to a Convex-style workflow until realtime and custody behavior became the dominant problem.

What fought me was cross-client freshness. A mutation could settle, remain absent from an existing live hook, and then appear on a fresh load. Adding a returned conversation revision fixed initiating-client refresh but not cross-client fanout. Attempted nonce refreshes hit subscription churn and connection limits, while background receipt writes collided with the authorization barrier. The served auth-transition recipe explained the custody failure precisely, but nothing diagnosed why a declared live query that read the mutated tables remained stale for another client. The bounded web fallback uses fresh document loads after interaction quiet periods; it is candidly a workaround, not a realtime success story.

The milestone is terminal because the frozen instrument contradicts itself. The starter log adds Dave to Weekend Plans before choreography begins. The group receipt check then opens only Bob and Carol and requires Alice's message to become aggregate-read, even though the brief says the aggregate must wait for every send-time recipient. The next check also requires Dave to be an addable member. Honoring the product invariant therefore makes the harness's read expectation impossible. I preserved the exact log and harness locations instead of excluding Dave from the recipient snapshot or relabeling the check.

The most important missing diagnostic would join a mutation commit, each affected live subscription, and the reason no cross-client revision was published. A second useful diagnostic would surface foreground/background writer contention at the hook call site before an unhandled authorization suspension poisons a route. The familiar surface saved syntax; it did not save the investigation into Snapback's realtime and authority machinery.

## M4 — Advanced messaging (blocked-by-M3, 1787858806)

No M4 product work or proof ran because the prerequisite M3 milestone ended in a frozen-instrument abort. The easy/fighting/profile assessment is therefore unchanged from M3: Familiar TypeScript had made the domain model approachable, while realtime and authority behavior remained Snapback-specific. The missing diagnostic is an instrument preflight that validates starter state against choreography preconditions before a dependent milestone consumes build time.

## M5 — Search and scale replay (blocked-by-M3, 1787858806)

No search implementation, M5 suite/choreography, or O5 scale replay ran. Dependency blocking was applied rather than manufacturing performance evidence against an app that could not cross the M3 gate. This boundary adds no valid ergonomics observation; a machine-readable dependency verdict from the harness would have made the stop condition clearer.

## M6 — Offline and push (blocked-by-M3; native environment-null, 1787858806)

No offline, push, web, or choreography proof ran. The iOS Simulator/Xcode/Hermes leg is separately environment-null on this Linux x86_64 lane, as required, rather than a product failure. No Familiar-profile conclusion can be drawn for offline authoring; the absent proof is recorded as absent.

## M8 — Insights and durable restart (blocked-by-M3; native environment-null, 1787858806)

M8 was not implemented or tested because M3 blocked the continuous prerequisite chain; M7 was intentionally outside this lane. The native restart/export leg is environment-null. No aggregate-model, scheduler, or durable restart ergonomics were exercised, so this boundary deliberately adds no backend score evidence.
