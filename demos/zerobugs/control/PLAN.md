# Zerobugs Stage 0.5 current-surface control plan

Status: scaffolded; implementation lanes not started  
Governing contract: `demos/zerobugs/manifest/acceptance.v1.md`  
Source inventory: `demos/zerobugs/stage0/inventory.v1.md`  
Source pin: `rocicorp/mono@25c2c7308d3eb674d2d895022c9da11ef0c742fb`, `apps/zbugs`  
Provider target: Snapback `local-dev-sqlite-ibex`, plus the versioned composition declared below

## Scope and nonclaims

This directory will become the LLP 0183 D1 control: the complete pinned
Zerobugs surface built only from capabilities advertised in the current
Snapback guide, plus the declared `zerobugs-control-composition.v1` companion.
It is a source-faithful port, not a smaller showcase. The ten source tables,
22 relationships, 19 named queries, 16 named mutators, nine route demands,
eight notification triggers, auth roles, asset flow, and amended defect policy
all remain in scope.

This first job provides only the plan, ten-table schema, generated-artifact
inputs, and a minimal React boot. It does **not** claim that the query,
mutation, composition, fixture, pinned UI, or ZB gate lanes are implemented.
It also does not claim a hosted target, production OAuth, durable notification
product capability, or large-fixture qualification.

The control may improve the four source defects frozen in manifest §8, but it
may not reproduce them: child roots are parent-gated, notification intent is
durable and idempotent, unsubscribe mutation is a token-authorized `POST`, and
asset policy is server-enforced. Each is labeled as an intentional improvement
in receipts rather than silently changing the comparator.

## Representation fixed by the scaffold

- `snapback/schema.mjs` declares the exact ten source tables and exact source
  fields. Snapback's server-owned `_id`, `_version`, `_createdAt`, and
  `_updatedAt` remain separate from the pinned source's public `id` fields.
- Foreign keys use `v.id(table)`. Fixture `_id` values use the generated
  table-specific prefix (`user_`, `project_`, `issue_`, and so on), while each
  source `id` field retains its frozen value. Adapters expose source `id`
  values to URLs and pinned component props and never confuse them with typed
  physical ids.
- All ten source tables are `.sync()`. Optionality follows the source schema,
  not PostgreSQL's looser trigger/default representation. The source
  `role: crew|user` and `visibility: internal|public` domains use their exact
  varchar storage representation (`v.string()`), because shipped Snapback table
  fields reject literal unions. Fixture ingestion and every authoritative
  writer apply the closed-domain guard; that duplicate validation is
  predeclared as `W-ENUM` below.
- The source indexes in inventory §Schema demand are represented, with stable
  `id` tie-breakers added to list/comment windows. Snapback's implicit `_id`
  remains the final physical tie-breaker.
- Auth mode is `sessions`; principal identity always comes from the server
  session. Because the frozen source user ids cannot be rewritten into
  Snapback principals, the fixture/auth lane adds an explicit, counted
  `identityBinding` support table rather than accepting caller-supplied user
  ids.
- Later control-only support tables remain visibly separate from the ten
  source tables: `identityBinding`, `projectUserRead`, `issueListRead`,
  `issueLabelRead`, `issueSearchDocument`, `searchEpoch`,
  `notificationIntent`, `notificationAttempt`, and `assetAttachment`. Their
  schemas, writers, rebuilds, and custody are provider-specific code counted
  under manifest §9.

## Planned file surface

The implementation jobs are constrained to this directory unless a later job
explicitly authorizes evidence emission to `demos/zerobugs/evidence/`.

| Area | Concrete files |
| --- | --- |
| Snapback definition | `snapback/schema.mjs`, `snapback/functions.mjs`, `snapback/routes.mjs`, `snapback/seed.json` |
| Fixture compiler | `fixtures/normal-seed-v1/`, `fixtures/policy-extension-v1.json`, `scripts/build-fixture.mts`, `tests/fixtures/fixture-digests.json` |
| Generated boundary | `snapback/generated/*` (generated and ignored; never hand-edited) |
| Typed data adapter | `src/data/snapback.ts`, `src/data/types.ts`, `src/data/queries.ts`, `src/data/mutations.ts`, `src/data/completeness.ts` |
| Auth | `src/auth/session.tsx`, `composition/auth.mts`, `composition/identity-binding.mts` |
| Windowing | `src/windowing/controller.ts`, `src/windowing/use-window.ts`, `src/windowing/history-state.ts` |
| Routes/effects/assets | `composition/zerobugs-control-composition.v1.json`, `composition/server.mts`, `composition/routes/*.mts`, `composition/effects/*.mts`, `src/assets/upload.ts` |
| Source-faithful UI | pinned `src/assets/**`, `src/components/**`, `src/hooks/**`, `src/pages/**`, `src/root.tsx`, `src/routes.tsx`, and adapted `src/main.tsx` |
| Acceptance | `tests/acceptance/zbgate.mjs`, `tests/acceptance/gates/zb0.mjs` through `zb7.mjs`, `tests/acceptance/actors.mjs`, `tests/acceptance/browser.mjs`, `tests/acceptance/receipt.mjs` |

## Lane A — schema, read models, and all 19 queries

### Ordering inside the lane

1. Extend `snapback/schema.mjs` with the separately named support tables above
   and their bounded indexes. Do not change or hide the ten source tables.
2. Add principal-to-source-user resolution and reusable parent visibility
   guards in `snapback/functions.mjs`.
3. Add authoritative writers/rebuilders for `projectUserRead`,
   `issueListRead`, `issueLabelRead`, and `issueSearchDocument`. Every source
   mutation updates source rows and dependent read rows in one Snapback
   transaction; a fixture rebuild produces the same digest.
4. Define the 19 exact exported query names. Every collect has an admitted
   positive ceiling at or below 1,024; results larger than a page use stable
   `(ordered fields, id)` cursors.
5. Declare route bundles in `snapback/routes.mjs` for initial list and issue
   detail cuts. Use generated query-group references and
   `prepareQueryGroup`; do not issue ad hoc client query ASTs.
6. Assemble source-shaped graphs in `src/data/queries.ts`. The adapter exposes
   explicit `pending`, `refreshing`, `complete`, `incomplete`, `retained`,
   `current`, `not-found`, and error states. It never presents a truncated
   prefix as complete.

The current relational surface is a bounded two-source equi-join/projection
surface, not the pinned 22-relation graph. Two-source maintained projections
are used where they fit. Wider shapes use registered query groups plus a
counted client merge; list membership/order uses declared read models. Search
uses shipped `backend.text-search` over `issueSearchDocument`. Since current
text search is read-only rather than live, `searchEpoch` is a synced
invalidation fact that triggers a bounded refetch; this is a declared manual
invalidation workaround, not simulated live search.

### Query lowering plan

| # | Frozen query | Current-surface implementation | Predeclared composition/workaround | Acceptance check |
| ---: | --- | --- | --- | --- |
| 1 | `allLabels` | Paged `label` query ordered by `(projectID,name,id)`; adapter concatenates pages. | Manual page assembly only when a fixture exceeds one page. | Exact label set, no duplicates, explicit completeness. |
| 2 | `allUsers` | Paged `user` query ordered by `(login,id)`. | Manual page assembly. | Exact users and source fields for normal and policy fixtures. |
| 3 | `allProjects` | Paged `project` query ordered by `(lowerCaseName,id)`. | Manual page assembly. | Exact project rows and stable order. |
| 4 | `user` | Unique `by_source_id` lookup and `.first()`. | Source-id to `_id` adapter. | Existing id returns one row; missing id returns authoritative not-found. |
| 5 | `crewUser` | Unique source-id lookup plus `role === "crew"` guard. | None beyond identity representation. | Ordinary users and missing ids reveal no crew row. |
| 6 | `labels` | Resolve project by `lowerCaseName`, then bounded/paged `label` query by project. | Two-query group and merge. | Project existence and complete membership match source. |
| 7 | `labelsOrderByName` | Same membership, ordered by `(name,id)` in requested direction. | Adds the stable id tie-breaker absent in source. | Asc/desc exact inverse with deterministic ties. |
| 8 | `issuePreloadV2` | Live `issueListRead` prefix of 1,000 ordered `(modified,id)` plus grouped users, memberships, emoji, newest ten comments, and private view rows. | Denormalized list rows, bounded child pages, query group, manual graph merge. | Exact public/crew membership, 1,000 ceiling, ten newest comments with stable ties, and honest child completeness. |
| 9 | `userPref` | Server resolves session principal through `identityBinding`, then unique `(key,userID)` lookup. | Identity-binding support table. | Caller cannot select another user's preference; auth transition wipes old private facts. |
| 10 | `usersForProject` | Query `projectUserRead` membership, then bounded `user` rows; login and fuzzy filter branches are explicit server args with ceilings. | Denormalized membership and manual result join. | Creator/assignee membership, crew/not-`rocibot`, login, disabled, and filter branches match the inventory. |
| 11 | `commentsPage` | Prove parent issue visibility first; query `(issueID,created,id)` forward/backward with bounded positive limit; group creator and emoji pages. | Query group and manual rich-row merge. Intentional parent-gate improvement. | Bidirectional/permalink windows have no skips/duplicates and leak no protected row, order, existence, or completeness fact. |
| 12 | `comment` | Resolve comment, prove its parent issue, then group creator and bounded emoji. | Manual rich-row merge. Intentional parent-gate improvement. | Exact permalink row or non-oracular not-found for every actor. |
| 13 | `issueDetail` | Resolve by `id` or `shortID`, apply crew-or-public policy, then use one generated group for project, creator, assignee, labels, issue emoji, session-private rows, and 50 newest comments. | Query group, bounded pages, manual 22-relation projection merge. | Required source graph is exact; private overlays are principal-exact; comment child completeness is explicit. |
| 14 | `issueListV2` | `issueListRead` supplies project/open/creator/assignee/visibility/order facts; `issueLabelRead` supplies all-label membership; `issueSearchDocument` supplies title/description/comment search ids; private view rows are grouped separately. | Denormalized read models, manual set intersection, read-only search plus `searchEpoch`, query-group merge, app-owned cursor controller. | Every filter combination, direction, stable cursor, all-label semantics, search membership, visibility, and private view state matches source. |
| 15 | `listIssueByID` | Run the same admitted membership predicate as `issueListV2`, narrowed by source id. | Shared list predicate/read model; no broad fetch. | Permalink returns only an issue that belongs to the exact list context. |
| 16 | `emojiChange` | Resolve subject as issue or comment-to-issue, prove parent visibility, then return bounded subject emoji plus creators. | Polymorphic subject resolver and manual merge. Intentional parent-gate improvement. | Guessed internal issue/comment ids disclose nothing; visible reactions converge. |
| 17 | `prevNext` | Deprecated API implemented by the same list engine with a one-row predecessor/successor window. | Shared list predicate/read model. | Neighbor matches canonical list order at both boundaries. |
| 18 | `issueList` | Deprecated bounded forward prefix over the same list engine; reject zero, absent, or over-ceiling limits. | Shared list predicate/read model. | Prefix equals `issueListV2` and never reports an unbounded result. |
| 19 | `userPicker` | Deprecated bounded user-membership query using `projectUserRead`/creator existence and explicit filter logic. | Denormalized membership; record a not-reached fact if pinned UI never calls it. | Branch parity when called; a not-reached receipt is evidence, not deletion from the inventory. |

## Lane B — all 16 mutators and current generated IR

All authoritative handlers live in `snapback/functions.mjs`; generated refs are
wrapped by `src/data/mutations.ts`. The server derives principal, authoritative
time, generated ids, visibility, and notification intent. The eight pinned
server overrides remain explicit: `issue.create`, `issue.update`,
`issue.addLabel`, `issue.removeLabel`, `emoji.addToIssue`,
`emoji.addToComment`, `comment.add`, and `comment.edit`.

The preliminary class below is copied from the inventory. “Handwritten
reducer” means a small typed capture-and-set reducer over visible facts only,
duplicated and counted in the control. A branch that depends on hidden
subscription, visibility, recipient, or old-row state stays server-only and
renders an honest pending state. No reducer predicts notification delivery or
authorization success.

| # | Frozen mutator | Inventory class | Control lowering and fallback |
| ---: | --- | --- | --- |
| 1 | `issue.create` | new verb: Upsert/Branch | Inline authoritative handler inserts source/read-model rows, subscribes creator, and enqueues durable intent. Reducer inserts the visible draft with client correlation id; subscription/effect branch is server-only pending. |
| 2 | `issue.update` | new verb: Branch + Upsert | Inline handler reads old row, guards creator/crew, patches, maintains projections, branches subscription intents. Reducer patches only supplied visible fields; assignee/subscription branches are pending. |
| 3 | `issue.delete` | new verb: Delete | Inline guarded delete plus explicit dependent cleanup/read-model repair. Reducer removes visible issue and owned window entries; cascade outcome settles authoritatively. |
| 4 | `issue.addLabel` | **current IR** Get/Guard/Insert | Generated Get/Guard/Insert with authoritative generic update intent. Handwritten reducer adds the join only when both visible rows are present; otherwise server-only pending. |
| 5 | `issue.removeLabel` | new verb: Delete | Inline guarded join delete and generic update intent. Reducer removes the visible membership. |
| 6 | `notification.update` | new verb: Upsert/Branch | Inline unique read then insert-or-patch for the session user. Reducer capture-and-sets `subscribed`; hidden absence branch remains pending until settlement. |
| 7 | `emoji.addToIssue` | new verb: Upsert/Branch beyond Insert | Inline parent/user guard, authoritative id/time, insert, subscription branch, projection repair, intent enqueue. Reducer adds the visible reaction with correlation id; hidden subscription/effect stays pending. |
| 8 | `emoji.addToComment` | explicit value or Lane Q: Get/Guard/Insert | Generated Get/Guard/Insert with explicit client id only where admitted; server replaces time and emits intent. Reducer adds the visible reaction after visible parent proof, else pending. |
| 9 | `emoji.remove` | new verb: Delete | Inline creator/crew guard and delete. Reducer removes an owned visible reaction. |
| 10 | `comment.add` | new verb: Upsert/Branch beyond Insert | Inline parent/user guard, authoritative id/time, insert, issue/read-model update, subscription branch, intent enqueue. Reducer inserts the visible comment and adjusts its window; hidden branches stay pending. |
| 11 | `comment.edit` | **current IR** Get/Guard/Patch | Generated Get/Guard/Patch plus authoritative intent and length guard. Reducer capture-and-sets visible body only. |
| 12 | `comment.remove` | new verb: Delete/dependent cleanup | Inline guarded delete, emoji cleanup, read-model/search repair. Reducer removes visible comment/reactions; search settlement is pending. |
| 13 | `label.create` | explicit value or Lane Q: Guard/Insert | Generated Guard/Insert with caller id admitted by the frozen contract. No pinned UI call site: server-only pending unless a gate invokes it. |
| 14 | `label.createAndAddToIssue` | explicit value or Lane Q: bounded two-Insert | Generated bounded two-Insert with crew guard and one transaction. Reducer inserts label and membership only when both target collections are complete; otherwise pending. |
| 15 | `viewState.set` | new verb: Upsert | Inline server-principal insert-or-patch. Reducer capture-and-sets the current principal's visible `viewed` fact; never accepts a user id argument. |
| 16 | `userPref.set` | new verb: Upsert | Inline server-principal insert-or-patch. Reducer capture-and-sets the visible preference key/value. |

Lane acceptance requires an independent observer for every mutation, actor
paint/authoritative-result/observer-convergence as three separate events,
generated result contract validation, replay/idempotency, conflict/refusal
tests, projection digest parity after each write, and proof that the eight
effect triggers create intent while every inventory non-trigger creates none.

## Lane C — source-faithful UI and app-owned windowing

### Port nearly as-is

Copy from the pinned `src/` with source path preserved where practical:

- `assets/**`, `index.css`, CSS modules, icons, fonts, and images;
- pure utilities such as `avatar-url-with-size.ts`, `comment-permalink.ts`,
  `is-primary-mouse-button.ts`, `limits.ts`, `lru-cache.ts`, and presentation
  timing helpers;
- presentation-only components (`button`, `combobox`, `confirm`,
  `gigabugs-promo`, `link`, `loading-spinner`, `markdown`, `modal`, onboarding,
  relative time, tooltip) and data-independent hooks;
- route/page visual structure once data imports are redirected through the
  adapter.

Add the pinned UI dependencies from the pinned app's `package.json` in this
lane, preserving its exact versions. The scaffold intentionally does not add
them early or invent substitutes.

### Port through the Snapback adapter

The Zero-coupled files remain recognizably source-shaped but import from
`src/data/*` and `src/auth/*`: `main.tsx`, `root.tsx`, `routes.tsx`,
`zero-init.tsx`, `zero-preload.ts`, auth/login hooks, offline/user-pref hooks,
avatar/emoji/filter/label/nav/project/user-picker components,
`pages/list/list-page.tsx`, and the issue/comment/composer page family.
`zero-init.tsx` becomes `src/data/snapback.ts`; compatibility re-exports are
allowed only if they reduce port churn and remain counted. Generated Snapback
refs are the sole data entry points.

`login-provider.tsx` consumes session snapshots and the auth transition
barrier. Logout invokes the session endpoint and waits for private store wipe;
it does not merely remove a readable JWT cookie. `use-is-offline` maps exact
Snapback connection/freshness facts. `use-user-pref` maps the principal-bound
query/mutator pair. Debug pages render capability/refusal and completeness
facts rather than exposing a free-form query surface.

The component-level port split is fixed as follows; an implementing job may
move a file to a stricter adapter category, but may not silently call an
adapter file “as-is.”

| Port treatment | Pinned `src/` files |
| --- | --- |
| Byte/near-byte presentation port | `components/button.tsx`, `combobox.tsx`, `confirm.tsx`, `fuzzy-search.ts`, `gigabugs-promo.tsx`, `link.tsx`, `loading-spinner.tsx`, `markdown-internal.tsx`, `markdown.tsx`, `modal.tsx`, `onboarding-modal.tsx`, `relative-time.tsx`, `tooltip.tsx`; their CSS modules; `pages/error/error-page.tsx`, `pages/issue/get-id.tsx`, `is-ctrl-enter.ts`, `toast-content.tsx`; all `assets/**`; pure root utilities and data-independent hooks. Only import paths/build typing may change. |
| Same JSX, injected Snapback/auth/asset state | `components/avatar-image.tsx`, `button-with-login-check.tsx`, `can-edit.tsx`, `emoji-data-source.ts`, `emoji-picker.tsx`, `image-upload-area.tsx`, `issue-link.tsx`, `not-logged-in-modal.tsx`; `hooks/use-can-edit.ts`, `use-emoji-data-source-preload.ts`, `use-is-offline.ts`, `use-login.tsx`, `use-user-pref.ts`; `server/upload.ts` is replaced by `src/assets/upload.ts`. |
| Query/mutation adapter required | `components/emoji-panel.tsx`, `emoji-pill.tsx`, `filter.tsx`, `label-picker.tsx`, `nav.tsx`, `project-picker.tsx`, `user-picker.tsx`; `debug/**`; `pages/issue/comment-composer.tsx`, `comment.tsx`, `issue-composer.tsx`, `issue-page.tsx`; `root.tsx`, `routes.tsx`, `zero-init.tsx`, `zero-preload.ts`. |
| Window-controller port | `pages/list/list-page.tsx`, `pages/issue/comments.tsx`, and `hooks/use-wouter-scroll-state.ts`. |
| Retire with explicit replacement | `jwt.ts` is replaced by server-custodied session state; the replacement and auth-transition proof live in `src/auth/session.tsx`. No client-readable bearer implementation is copied. |

### `useZeroVirtualizer` mapping

The two pinned usages are replaced, not emulated with an unshipped Snapback
primitive:

- `pages/list/list-page.tsx` uses `src/windowing/use-window.ts` over the exact
  `issueListV2`/`listIssueByID` adapter.
- `pages/issue/comments.tsx` uses the same controller over
  `commentsPage`/`comment`.
- `hooks/use-wouter-scroll-state.ts` keeps route/history scroll state, but the
  controller owns requested forward/backward cursors, loaded intervals,
  stable row keys, estimated/known totals, before/after spacers, target-row
  permalink loads, cancellation, and completeness.
- The controller does not fetch a broad collection and slice it locally.
  Crossing a boundary requests the next bounded authoritative page. It
  de-duplicates by source id, checks cursor adjacency/order, and refuses a
  contradictory or incomplete frame.
- List filters/order form the window identity. A change retires the old
  controller generation. Comment windows keep natural-height measurement and
  newest-row watching as explicit controller inputs.

This app-owned controller is a D4 workaround. It is tested for forward/back
windows, dynamic heights, prepends, deletes, permalink jumps, scroll restore,
filter changes, disconnect/reconnect, no duplicates/skips, and honest
unknown-total behavior.

## Lane D — declared composition for OAuth, routes, effects, and assets

The versioned component is
`composition/zerobugs-control-composition.v1.json`, implemented by a Bun HTTP
gateway in `composition/server.mts`. It is a supported **control
composition**, not a claim that arbitrary routes, GitHub OAuth, email, or
webhooks are native Snapback capabilities. The manifest pins runtime/version,
routes, schemas, timeouts, ownership, secrets-by-name, health, cleanup, and
the exact Snapback release it fronts. All bespoke lines count.

| Demand | Component and status | Boundary and checks |
| --- | --- | --- |
| GitHub OAuth start/callback | Gateway implements `GET /api/login/github` and callback, then uses Snapback's external identity broker/session mint path. **Local/dev partial**; real public-TLS OAuth is a required ZB7 GAP until a hosted supported target and dedicated acceptance identity are frozen. | State/PKCE/redirect allowlist, no readable bearer cookie, GitHub `githubID` → `identityBinding` → server session, role read from source user. |
| Four Zero data aliases | Gateway exposes `POST /api/push`, `/api/mutate`, `/api/get-queries`, and `/api/query` as frozen-envelope compatibility adapters to generated Snapback refs/native protocol. **Bespoke versioned D7 adapter.** The ported SPA uses native refs; gates still exercise all aliases. | Closed allowlist of 19 queries/16 mutators, strict envelope/arg/result validation, session custody, invalid bearer 401, no arbitrary function or auth fields. |
| Machine Markdown | Gateway implements `GET /p/:projectName/issue/:id.md` over one parent-gated Snapback query. **Bespoke versioned D7 adapter.** | Numeric/string id, 308 canonical redirect, Markdown errors, max 1,000 comments, internal crew gate, authenticated `no-store`, no child oracle. |
| Safe unsubscribe | `GET /api/unsubscribe` is read-only confirmation; a separate `POST /api/unsubscribe` consumes a signed, purpose/user/issue-bound expiring token and idempotently sets false. **Intentional improvement and bespoke D7 adapter.** | No email+short-id mutation, no existence oracle, key rotation/expiry/replay tests, CSRF-safe POST. |
| Notification delivery | The authoritative mutation writes `notificationIntent` and enqueues an experimental one-off job in the same transaction. A declared action uses `ctx.fetch` to deterministic local capture or pinned sandbox email/webhook adapters; attempts have stable idempotency, fenced retries, terminal/ambiguous receipts. **App ledger over shipped actions + local experimental jobs; `backend.notifications` remains GAP.** | Never before commit, no lost intent, no claimed duplicate, internal recipient policy, eight triggers/non-trigger corpus, fault-before/after-send tests. Hosted durable-background support remains ZB7 GAP. |
| Image upload | Use shipped local Snapback assets with a typed `v.assetRef`, stock Vite relay, private upload intent, and declared public-immutable delivery. Gateway keeps the source-shaped `POST /api/upload/presigned-url` response adapter. **Local partial; hosted object policy GAP.** | Five MIME types, server-enforced 10 MiB bound, checksum/finalize, PUT result checked, owned `assetAttachment`, Markdown URL projection, CORS/delivery declaration, GC/cleanup, no secret logging. |

The composition never proxies `/_snapback/*` as an arbitrary public surface.
It receives only the narrow capabilities in its versioned manifest and emits a
health/identity receipt that ZB0 and ZB7 bind to the attempt.

## Lane E — fixtures

Fixture work precedes behavioral implementation so every lane develops against
the frozen rows, not convenient substitutes.

1. `normal-seed-v1`: copy/normalize the pinned ordinary source bytes to one
   project, 14 users (7 crew/7 ordinary), 516 public issues (155 open/361
   closed), 924 comments, 30 labels, and 603 issue-label rows. Preserve source
   strings and timestamps. Emit deterministic, table-prefixed Snapback `_id`
   mappings and all typed foreign ids.
2. `policy-extension-v1`: append the manifest companion's exact fixed ids and
   rows for internal visibility, private overlays, emoji, auth actors, negative
   child probes, effects, safe unsubscribe, and asset cases. Do not synthesize
   replacement ids.
3. Build read models from source rows and prove a rebuild digest equals the
   incrementally maintained digest. Fixture output includes source counts,
   support-table counts, row digests, actor bindings, and manifest digest.
4. Compile the selected pair deterministically to `snapback/seed.json` and
   refuse unknown/missing/duplicate ids or broken typed references.
5. Defer `large-seed-v1` and hot mutation/fanout data to a later Stage 0.5 job.
   Until that job lands, large-scale ZB5 rows are `GAP/deferred`; normal data
   cannot stand in for them and no performance/scale claim is allowed.

The fixture compiler is a provider-specific transformation and appears in the
workaround register. A fixture digest change creates a new receipt identity;
it never mutates prior attempt evidence.

## Lane F — ZB harness and immutable receipts

`tests/acceptance/zbgate.mjs` uses the guide's `demos/_kit/harness.mjs` lifecycle
(`createSuite`, generated refs, owned server namespace, non-vacuous expected
check counts) plus the pinned browser driver for visual interactions. It uses
separate actor and observer clients and deterministic network-profile seams;
it does not use sleeps as convergence proof.

Gate files cover:

| Gate | Control checks in this stage |
| --- | --- |
| ZB0 | Source pin/inventory coverage; exact 10/22/19/16/9/8 accounting; static route/UI inventory; declared workaround/component register; generated identities; zero-check refusal. |
| ZB1 | All query rows, relations, order, bounds, cursors, query-group cut, permalink and app-window correctness, including protected child parent gates. |
| ZB2 | Retainable queries only; retained/current labels; offline read/queued-intent matrix; auth transition invalidation; no widened retention. |
| ZB3 | All 16 mutations; three timing marks; conflict/replay; generated IR/admission fact; reducers or honest pending; eight durable intents and non-triggers. |
| ZB4 | Full actor matrix and negative fact delivery across query, retained, queued, route, effect, unsubscribe, and asset paths. |
| ZB5 | Raw normal/cold/optimistic measurements and custody counters. Large/hot rows remain GAP until the deferred fixture job; no composite score or unfrozen margin. |
| ZB6 | Chronological assistance, failed paths, source/provider line counts, guide use, stable diagnostics, capability/refusal facts, and cleanup. |
| ZB7 | Local route/effect/asset fault and recovery slices plus cleanup. Public TLS, real OAuth, production providers, backup/restore/release, and hosted support remain required GAP until a target is frozen and proven. |

`tests/acceptance/receipt.mjs` writes exactly one new
`<arm>.<gate>.<attempt>.json` per executed attempt, for example
`snapback-control.zb1.v1.json`, under `demos/zerobugs/evidence/`. It refuses an
existing path. Each receipt contains the manifest id/digest, exact generated
and component release identities, fixture/actor/browser/machine/network/target
identities, expected/executed check counts, PASS/GAP/FAIL/missing rows, raw
artifact digests, capability/refusal facts, assistance/workarounds, source and
custody accounting, cleanup, and redacted diagnostics. It rejects secrets,
bearers, credential material, unsafe absolute cleanup targets, and zero-check
attempts. Remediation increments the attempt; it never edits `v1`.

## Workaround and component register (predeclared)

Line spans are `TBD-before-use` because those files do not exist in this
scaffold job. The implementing job must replace that marker with measured
source/provider line ranges before its first ZB0 attempt. Using a row before
that update fails ZB0.

| ID / class | Reason and owner | Planned files / lines | Status and lifecycle | Security boundary | Removed by |
| --- | --- | --- | --- | --- | --- |
| `W-QGROUP` / manual query-group graph join | Current relational capability is bounded two-source, while issue/list shapes span up to 22 relations. Owner: control data lane. | `snapback/routes.mjs`, `src/data/queries.ts` / TBD-before-use | Supported generated groups + bespoke merge; retained through control. | Merge only parent-authorized closed projections; never infer completeness. | D2 graph/query workstream. |
| `W-READMODEL` / denormalized projection | All-label membership, project-user existence, wide list order, and comment-derived search do not fit one current live query. Owner: control server lane. | `snapback/schema.mjs`, `snapback/functions.mjs` / TBD-before-use | Supported maintained projection where available plus app-authored rows; rebuildable; retained through control. | Same-transaction writers, explicit public/private fields, digest audit. | D2 and D6. |
| `W-MANUALSET` / app join/filter/sort | Adapter intersects bounded list/search/label ids and assembles rich rows. Owner: control data lane. | `src/data/queries.ts` / TBD-before-use | Bespoke; never broad/unbounded; retained through control. | Inputs carry visibility/completeness; no protected join key crosses actor boundary. | D2/D3/D6. |
| `W-SEARCH-EPOCH` / manual invalidation | Shipped text search is not live. Owner: control search lane. | `snapback/schema.mjs`, `snapback/functions.mjs`, `src/data/queries.ts` / TBD-before-use | Supported search + bespoke synced epoch/refetch; explicit refreshing state. | Epoch reveals no query text/result membership and is partitioned by visibility class. | D6 derived search. |
| `W-REDUCER` / duplicate handwritten reducer | Current generated optimism cannot express 11 new-verb and some branch/upsert/delete shapes. Owner: control mutation lane. | `src/data/mutations.ts` / TBD-before-use | Bespoke typed capture-and-set; removed when generated admission exists. | Visible facts only; never predicts authority, hidden recipients, or delivery. | D5 lowering/admission. |
| `W-PENDING` / server-only pending | Hidden branch/subscription/effect state is not safely locally evaluable. Owner: control mutation lane. | `src/data/mutations.ts`, UI pending components / TBD-before-use | Supported authoritative mutation with honest pending; retained until admitted carrier exists. | No speculative protected fact or false settlement. | D5. |
| `W-WINDOW` / app-owned window controller | No current source-equivalent `useZeroVirtualizer` primitive. Owner: control UI lane. | `src/windowing/*`, list/comments pages / TBD-before-use | Bespoke controller over supported bounded queries; retained through control. | Generation-fenced requests; parent policy on comments; honest completeness. | D4 window workstream. |
| `W-IDENTITY` / identity binding table | Snapback principals and frozen source user ids are distinct namespaces. Owner: auth composition. | `snapback/schema.mjs`, `snapback/functions.mjs`, `composition/identity-binding.mts` / TBD-before-use | App-owned table over supported sessions/external broker; retained through control. | Only server-derived principal writes/reads binding; no caller user-id authority. | D7 auth profile. |
| `C-GATEWAY` / versioned composition gateway | Native Snapback does not own all nine frozen arbitrary routes or GitHub OAuth. Owner: composition lane. | `composition/zerobugs-control-composition.v1.json`, `composition/server.mts`, `composition/routes/*` / TBD-before-use | Formally versioned bespoke D7 companion; local supported control component; no native claim. | Narrow route/function allowlist, session custody, redirect/token/secret policy, owned cleanup. | D7 routes/auth. |
| `C-NOTIFY` / durable app ledger and worker | `backend.notifications` is an explicit GAP; current jobs are local experimental. Owner: effect composition. | `snapback/schema.mjs`, `snapback/functions.mjs`, `composition/effects/*` / TBD-before-use | Supported actions + experimental jobs + bespoke ledger; local partial, hosted GAP. | Intent in mutation transaction; idempotency/fencing; explicit ambiguous outcomes; secrets by name. | D7 effects; first-class notification capability. |
| `C-ASSET` / source URL adapter and attachment metadata | Native local asset lifecycle differs from S3 presign/Markdown URL source shape. Owner: asset composition. | `snapback/schema.mjs`, `snapback/functions.mjs`, `composition/routes/upload.mts`, `src/assets/upload.ts` / TBD-before-use | Supported local asset capability + bespoke response/Markdown adapter; hosted GAP. | Server MIME/size/checksum, typed attachment, declared delivery/CORS, GC, no credential logging. | D7 assets/routes. |
| `W-FIXTURE` / fixture transformation | Frozen relational source ids must become typed prefixed `_id` references and support read models. Owner: fixture lane. | `scripts/build-fixture.mts`, `fixtures/*` / TBD-before-use | Bespoke deterministic compiler; retained for control reproducibility. | No credential input; exact ids/counts/digests; refuses broken references. | D8 fixture/profile workstream may standardize it. |
| `W-ENUM` / duplicate closed-domain guard | Shipped table field validators do not admit literal unions for the source `role` and `visibility` varchar enums. Owner: schema/mutation lane. | `scripts/build-fixture.mts`, `snapback/functions.mjs` / TBD-before-use | Bespoke two-value guards at every ingestion/write boundary; schema remains `v.string()`. | Fail closed before storage; query auth never treats an unknown role as crew or visibility as public. | D5, if generated validation/lowering is extended to portable stored enum domains. |

## Later-job sequencing and lane acceptance

| Order | Job/lane | Depends on | Completion check before the next lane |
| ---: | --- | --- | --- |
| 0 | This scaffold | Frozen LLP/manifest/inventory/guide | Ten tables generate; React typecheck/build pass; validation record below is current. |
| 1 | Fixtures + support schema | 0 | Normal and policy-extension counts/ids/digests pass; typed refs and read-model rebuild digest pass; `snapback generate` passes. |
| 2 | Local auth/identity composition | 1 | Deterministic actors bind server-derived principals; role/owner guards and logout transition barrier pass; no caller-selected private id. |
| 3 | Query/read-model corpus | 1–2 | All 19 names are generated and non-vacuously exercised; query parity, protected-child negatives, cursor/window primitives, group identities, and completeness checks pass on normal+policy. |
| 4 | Mutation/reducer/effect-intent corpus | 3 | All 16 refs and preliminary classes are accounted; actor/observer convergence, reducer/pending disposition, projection repair, eight intent triggers/non-triggers, replay/refusal pass. |
| 5 | Versioned routes/assets/effect delivery | 2–4 | Nine route demands, safe POST unsubscribe amendment, five MIME/size asset policy, deterministic capture delivery, retry/idempotency/ambiguity, health/cleanup all pass locally or emit named GAP. |
| 6 | Pinned UI + window controller | 3–5 | Static source file inventory has no unexplained omission; list/detail/filter/search/composer/auth/asset routes render; both virtual windows and all critical interaction marks pass in Chrome. |
| 7 | ZB0–ZB7 normal/policy receipts | 1–6 | Each gate has nonzero expected/executed checks, immutable per-gate receipt, raw links/digests, cleanup result, and honest PASS/GAP/FAIL. No unsupported whole-product claim. |
| 8 | Deferred large/hot qualification | 7 and a frozen large fixture/profile | Large completeness, hot mutation/fanout, custody, and raw performance trials run under the same gate definitions; this job cannot backfill or overwrite earlier GAP receipts. |

After substantive UI/demo work, the implementing job must also satisfy the
repository diary and LLP-maintain cadence. This scaffold job cannot create a
diary because its explicit write scope is `demos/zerobugs/control/` only.

## Validation record for this scaffold

Run on 2026-08-05 from the repository/workspace shown in the frozen task.

| Command | Result |
| --- | --- |
| `bun install --offline` (first attempt, from `demos/zerobugs/control`) | Exit 1 after writing the lockfile: Bun reported transient `EEXIST` link failures for four local `@expo/snapback-*` packages. No network or repair/bootstrap action was taken. |
| `bun install --offline` (second attempt) | PASS, exit 0; Bun 1.3.12 resolved the repo-local package set. |
| `bun run generate` (first attempt, before the second install) | Exit 1, `CODEGEN_CONTRACT_CAPABILITY_SOURCE_OUTSIDE_ROOT`, caused by the incomplete Bun local link. This is not a `SNAPBACK_*` runtime code. |
| `node ../../../packages/snapback-codegen/index.mjs snapback` | PASS, exit 0: 10 tables, 0 operations (intentional scaffold), 13 files, 0 warnings. This is the guide-documented source-checkout codegen path. |
| `bun run generate` (after the second install) | PASS, exit 0: 10 tables, 0 operations, 13 files, 0 warnings. |
| `bun run generate` (closed-domain probe) | Exit 1 with two `SCHEMA_INVALID_VALIDATOR` diagnostics: stored table fields do not support `v.union`/literal-enum validators. The final schema uses the exact varchar representation and predeclares the fail-closed fixture/writer guard as `W-ENUM`; final generation passes. |
| `bun run typecheck` (first attempt) | Exit 2 because the Vite plugin's `virtual:snapback/dev` module had no ambient declaration in this new app. Added the repo-conventional `src/snapback-dev.d.ts`; no runtime API was invented. |
| `bun run typecheck` | PASS, exit 0. |
| `bun run build` | PASS, exit 0; Vite 8 built the minimal client. The Snapback Vite plugin emitted only its upstream `optimizeDeps.rollupOptions` deprecation warning. |
| `node scripts/check-guide.mjs` (repository root) | PASS, exit 0: 56 pages, 172 snippets, 111 routes + 37 host-ops joined; 45 existing freshness/drift warnings. |
| `./ref-check --verbose` (repository root) | PASS, exit 0: 188 LLP documents, 6,020 refs, 0 errors, 0 unchecked. |
| `node ../../../packages/snapback-cli/cli.mjs verify snapback --json` | Artifact freshness PASS, then exit 1 at runtime readiness with `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` (`reason: absent`) for the packaged binary. Per task instructions, no bootstrap or qualification repair was attempted. |
| `node ../../../packages/snapback-cli/cli.mjs verify snapback --runtime-binary ../../../target/debug/snapback --runtime-receipt ../../../target/debug/snapback.runtime-readiness.json --json` | Artifact freshness PASS, then exit 1 with `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` (`reason: binary-drift`; receipt digest did not match the existing binary). No repair was attempted. Admission/schema load and acceptance stages therefore remain blocked, not passed. |

The schema source and generated graph are valid and fresh. Runtime-backed
schema admission is deliberately recorded as blocked; this plan does not turn
artifact freshness into a live-load claim.

## Guide gaps encountered

<!-- Append dated, concrete guide gaps here; keep capability/product GAPs in the workaround/component register. -->
