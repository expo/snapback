# Party Wall round-2 Snapback arm — build log

Builder: fresh-context agent (Claude Fable 5), 2026-08-01. Surface allowed:
`guide/` + pages/files it links, the packages the guide names,
`demos/upload-bakeoff/party-wall/README.md`,
`demos/upload-bakeoff/_shared/gps-jpeg.mjs`. Forbidden dirs not read:
`diaries/`, `issues/`, `llp/` (no page forced me into one),
`demos/party-wall/`, `demos/upload-bakeoff/party-wall/snapback/`,
`demos/upload-bakeoff/reports/`.

Interpretation note (logged, not smoothed): the guide teaches
`demos/_kit/server-process.mjs` / `harness.mjs` as "the only way a suite
should obtain a server" and transcludes
`demos/card-game/tests/acceptance/authority-scope.mjs` (sessions page),
`demos/rbac/*` and `demos/shindig/snapback/*` (scoped-roles page). I treated
those guide-named files as in-surface and read them; nothing else in `demos/`
was opened.

## Package surface used

Workspace source checkout — `demos/_kit/define.mjs` shim over
`packages/snapback-codegen`, plus `packages/snapback-client` (index + assets
entries) and `packages/snapback-contract` (AuthCoordinator) imported by
relative path; codegen via `node packages/snapback-codegen/index.mjs`.
Server: source-tree `cargo run` rung — the resolver skipped the prebuilt
binary ("this checkout is dirty or has no committed identity to verify it
against"). Not the published 0.1.8 closure.

## Wall clock (from empty arm dir)

| clock | +elapsed | milestone |
| --- | --- | --- |
| 15:35:03 | 0:00 | arm dir created; clock starts |
| 15:35–15:39 | | read guide pages (index, first-backend, authoring-loop, assets, sessions, scoped-roles, live-queries, headless, acceptance) + verified package surfaces (define.mjs, assets.d.mts/assets.mjs, contract exports, card-game/shindig/rbac transcluded sources) |
| 15:39:45 | 4:42 | **first codegen — succeeded on the first attempt** (3 tables, 6 operations, 0 warnings) |
| 15:42:29 | 7:26 | first driver run starts; **first boot** 33.1s (cargo rung compile+launch included) |
| ~15:43:30 | ~8:30 | **first full-checklist green — 8/8 on the first driver attempt**; first live photo served during this run (upload→visible 53ms) |
| 15:43:48 | 8:45 | scratch experiment: attach-before-ready → accepted at task status 'uploading' |
| 15:44:28 | 9:25 | final driver run (realistic pre-ready burst flow); boot 7.4s (warm target) |
| ~15:45:00 | ~9:57 | **completion**: 8/8 green with live thumbnail-readiness observation; evidence table final |

Zero failed codegen runs; zero failed driver runs; zero product diagnostics
hit in anger. Every stumble below is a documentation/discovery friction, not
an error the system emitted.

## Stumbles (verbatim, as hit — never smoothed)

1. **`client.assets` does not exist.** `guide/backend/assets.md` says "the
   framework-neutral upload task is `client.assets.start` in
   `@expo/snapback-client`", but grepping
   `packages/snapback-client/index.mjs` for `assets` matches only the
   reserved live-function name (`_snapback.assetRecord`, line 10673) — there
   is no `.assets` accessor on `SnapbackClient`. The real surface is
   `createAssetClient(client)` / `new SnapbackAssetClient(client)` from the
   `assets.mjs` entry. Same for "subscribe via the headless client's
   `watch`/`watchStore`" — those methods live on the asset client object,
   not the headless client. Cost: one grep detour; a cold packaged consumer
   would look for `client.assets` first.
2. **The guide's sessions provisioning path is the hard way; the easy way is
   only in a transcluded demo.** `sessions-and-principals.md` and
   `headless.md` teach `ensureApp({ intent: 'provision', requestedMode:
   'sessions', ... })` with "a fresh `dev → sessions` provision stages the
   sessions deployment and closes app data until the required process
   restart consumes it" — i.e. provision + restart choreography for a suite.
   The `startServer({ startupArtifacts: carrier,
   captureImpersonationCapability: true })` form — write
   `{ formatVersion: 1, schema, functions }` to a file, boot straight into a
   settled sessions deployment, no restart — appears on no guide page I
   read; I found it only inside
   `demos/card-game/tests/acceptance/authority-scope.mjs`, which the guide
   transcludes for *other* snippets. Without that example I would have built
   the provision→restart dance.
3. **Burst dedup hazard.** `assets.md`: finalization "dedups within the app"
   by SHA-256. Five identical burst JPEGs would collapse into one asset —
   the checklist's five-photo burst silently becomes one photo with five
   references. I had to synthesize byte-distinct files (unique JPEG COM
   segments spliced after SOI). The guide never warns that "N uploads of the
   same bytes = 1 asset" changes feed/deletion semantics.
4. **Live update `meta.kind` vocabulary mismatch.** `live-queries.md`
   documents `live_replace` / `live_delta` / `resync_required` /
   `authorization_invalidation`. What the membership-gated feed actually
   delivered was `meta.kind: "authorization_snapshot"` on every arrival and
   `"authorization_quarantine"` on revocation/deletion — kinds absent from
   the page. Harmless at runtime, confusing when writing evidence
   assertions; I asserted on row contents instead of kinds.
5. **Signed-out byte fetch is HTTP 400, not 401/403.** An unauthenticated
   `GET /assets/records/{id}/bytes/thumb` (no headers at all) returns 400
   (missing protocol offer is a malformed request before it is an authz
   denial), while the authenticated outsider gets 403. Recorded verbatim;
   worth knowing before asserting `401`.
6. **Prebuilt-binary skip on a dirty checkout.** First boot printed:
   `prebuilt /Users/ccheever/projects/snapback-0044-l1/target/debug/snapback
   skipped: this checkout is dirty or has no committed identity to verify it
   against; using the source-tree `cargo run` rung (LLP 0030 ladder)` —
   first boot cost 33.1s (subsequent warm boots 7.4s). Honest ladder
   behavior, but a cold builder pays it without being told how to avoid it.
7. **(Non-stumble, recorded as a discovery)** attach-before-ready is
   accepted: `createPost` with an asset whose task status was `'uploading'`
   committed fine, and B's entry then preceded thumbnail readiness on the
   live watch — the realistic burst UX. No guide page says whether
   `ctx.assets.attach` admits a not-yet-ready asset; I had to run an
   experiment to find out (it does).

## Ceremony ledger — distinct concepts learned/performed

To check 2's first live photo (concepts 1–17); 18–19 needed for the rest of
the checklist:

1. `defineSchema`/`defineTable`/`v` validators and `.index()`/`.sync()`
2. sessions auth mode declaration (`{ auth: { mode: 'sessions' } }`)
3. membership declaration grammar (roles, `bootstrapRole`, `lastHolder`,
   closed transitions matrix)
4. membership predicate on a live query
   (`eventMembers.memberOf(membershipResource.arg('eventId'))`)
5. generated membership commands (`ctx.membership.*.bootstrap/insert/removeSelf`;
   one-command-per-mutation rule; `authorityCreating` marker)
6. `ctx.permissions.*.requireRole` (deny) vs declarative membership filter
   (empty) as distinct outsider contracts
7. `defineAssetUpload` intent (accept/delivery/access/image/authorize)
8. `.assetSharing({ kind: 'membership', membership })` table declaration
9. `v.assetRef({ upload })` restricted field + `ctx.assets.attach`
10. inline JS handler subset (no imports/captures, declared writes, result
    contracts)
11. codegen invocation + generated artifacts (api refs, manifests,
    artifacts.json custody)
12. `startServer` + sessions startup-artifacts carrier +
    `captureImpersonationCapability`
13. persona mint loop (authRequestCode → admin+impersonation-gated mailbox →
    authExchange) + `AuthCoordinator` construction
14. `SnapbackClient` protocol-option constellation (authInvalidationProtocol,
    authorityDescriptorProtocol, authorizedLeaseProtocol, clientStoreId)
15. `liveQuery` handle (transport 'stream', `fallbackToPoll: false`,
    onUpdate, dispose)
16. asset upload client (`createAssetClient`, FileLike shape, task lifecycle
    with stable pre-ready assetId)
17. `_snapback.assetRecord` `watchStore` live readiness projection
18. private-strict byte routes + raw-fetch custody headers
    (`authorization: Bearer` + `x-snapback-auth-client-protocol: 1`)
19. acceptance harness (`createSuite`/`runAcceptance`, `expectedChecks`,
    cleanups stack)

**Ceremony count: 19 distinct concepts** (17 to first live photo).

## Custody note

`snapback/generated/` is committed in full (not just `artifacts.json`) so
the verifier can run `run.mjs` without a codegen step; the
`.snapback/codegen-cache/` input-hash cache is deliberately not committed.
This deviates from the guide's commit-the-review-manifest-only custody rule
and is a bakeoff-runnability choice, recorded here.

## Checklist verdicts (from the final green run; full detail in the driver's evidence table)

| item | verdict | one-line evidence |
| --- | --- | --- |
| 1 identities | PASS | email-code sessions; three distinct server-issued principals |
| 2 live burst | PASS | B first; WebSocket push (SubscriptionReceipt.transport=push), fallbackToPoll:false; posts attach pre-ready; per-photo upload→visible 43–48ms, upload→thumb-ready 46–49ms |
| 3 outsider | PASS | subscription empty (no denial oracle); outsider bytes 403; signed-out 400 |
| 4 revocation | PASS | removeSelf → live blank pushed in 19ms (authorization_quarantine); bytes 200→403 next request |
| 5 deletion | PASS | deletePost → left B's feed in 14ms; member bytes 403 after; owner bytes still 200 (asset outlives post, owner-only) |
| 6 GPS | PASS | strip policy: GPS-tagged upload; served thumb+primary GPS-free (byte-checked) |
| 7 authz model | PASS | private membership roster + posts.assetSharing membership semi-join re-checked per byte request; no capability URLs |
| 8 ceremony/clock | PASS | this log: ~9m57s empty-dir→completion, first green at ~8m30s, 19 ceremony concepts |
