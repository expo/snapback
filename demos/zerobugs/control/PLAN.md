# Zerobugs Stage 0.5 current-surface control plan

Status: Lanes 1–3 complete and live-verified; Lane 4 authoritative corpus implemented with in-sandbox validation passing and its fresh-server live gate awaiting the supervising session
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

The current state provides the plan, ten source tables plus support schema,
deterministic normal/policy fixture compiler, bounded authenticated loader,
five-actor local identity binding, principal-derived role/ownership helpers,
all 19 frozen typed live-query names, the complete 16-mutator authoritative
server corpus, transaction-coupled durable notification intent for all eight
triggers, independent query/mutation oracles, generated-artifact inputs, and a
minimal React boot. It does **not** claim Lane 6 client reducers/pending UI,
notification delivery, the composition gateway, pinned UI, or ZB gate lanes
are implemented. Lane 4's fresh-server parity gate remains awaiting an
outside-sandbox run. This control does not claim a hosted target, production
OAuth, durable notification product capability beyond committed local intent,
or large-fixture qualification.

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
| Snapback definition | `snapback/schema.mjs`, `snapback/functions.mjs`, `snapback/routes.mjs`; no `snapback/seed.json` for the 3,758-row acceptance fixture |
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
are used where they fit. Wider shapes were predeclared as registered query
groups plus a counted client merge; Lane 3's route-argument probe instead
required generated route identities around a counted typed server merge, as
recorded under `W-QGROUP`/`W-MANUALSET`. List membership/order uses declared
read models. Search
was planned to use shipped `backend.text-search` over `issueSearchDocument`.
Lane 3 codegen proved that an opaque handler cannot compose a search plan and
that exporting a public search plan cannot safely select the crew-only
partition. The admitted control therefore scans only the maintained,
role-partitioned search documents under a 1,024-row proof ceiling and returns
`refreshing` with no rows on a boundary hit. `searchEpoch` is still consulted
as the synced invalidation fact. This exact-corpus lowering is counted under
`W-SEARCH-EPOCH`; it is not a first-class live-search claim and it does not
silently return a bounded prefix.

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

Lane 4 implements only the authoritative server clauses below. Every reducer
or pending clause is a Lane 6 client/UI disposition, not a claim that local
prediction or its presentation exists in this lane.

| # | Frozen mutator | Inventory class | Control lowering and fallback |
| ---: | --- | --- | --- |
| 1 | `issue.create` | new verb: Upsert/Branch | Inline authoritative handler inserts source/read-model rows, subscribes creator, and enqueues durable intent. Reducer inserts the visible draft with client correlation id; subscription/effect branch is server-only pending. |
| 2 | `issue.update` | new verb: Branch + Upsert | Inline handler reads old row, guards creator/crew, patches, maintains projections, branches subscription intents. Reducer patches only supplied visible fields; assignee/subscription branches are pending. |
| 3 | `issue.delete` | new verb: Delete | Inline guarded delete plus explicit dependent cleanup/read-model repair. Reducer removes visible issue and owned window entries; cascade outcome settles authoritatively. |
| 4 | `issue.addLabel` | **current IR** Get/Guard/Insert | Inventory classification remains current-IR for the source-row write alone. The complete control program stays on the authoritative JS/Ibex tier: generated `Get` addresses a physical `_id`, while this frozen contract receives a source id; `AuthUserId` is the session principal, not the bound source-user id; and current IR cannot append the recipient-snapshot intent. Lane 6 may add a visible join reducer, otherwise honest pending. |
| 5 | `issue.removeLabel` | new verb: Delete | Inline guarded join delete and generic update intent. Reducer removes the visible membership. |
| 6 | `notification.update` | new verb: Upsert/Branch | Inline unique read then insert-or-patch for the session user. Reducer capture-and-sets `subscribed`; hidden absence branch remains pending until settlement. |
| 7 | `emoji.addToIssue` | new verb: Upsert/Branch beyond Insert | Inline parent/user guard, authoritative id/time, insert, subscription branch, projection repair, intent enqueue. Reducer adds the visible reaction with correlation id; hidden subscription/effect stays pending. |
| 8 | `emoji.addToComment` | explicit value or Lane Q: Get/Guard/Insert | Authoritative JS resolves the source comment and bound actor, proves parent mutation visibility, preserves the client source id, replaces time, repairs issue list state, and emits intent. Lane 6 may add the visible reaction after visible parent proof, else pending. |
| 9 | `emoji.remove` | new verb: Delete | Inline creator/crew guard and delete. Reducer removes an owned visible reaction. |
| 10 | `comment.add` | new verb: Upsert/Branch beyond Insert | Inline parent/user guard, authoritative id/time, insert, issue/read-model update, subscription branch, intent enqueue. Reducer inserts the visible comment and adjusts its window; hidden branches stay pending. |
| 11 | `comment.edit` | **current IR** Get/Guard/Patch | Inventory classification remains current-IR for the source-row patch alone. The complete control program stays on the authoritative JS/Ibex tier because the source-id lookup/identity binding cannot be expressed as physical `Get`/`AuthUserId`, and search-document repair, epoch bump, body policy, and recipient-snapshot intent are outside the current declaration. Lane 6 may capture-and-set a visible body, otherwise honest pending. |
| 12 | `comment.remove` | new verb: Delete/dependent cleanup | Inline guarded delete, emoji cleanup, read-model/search repair. Reducer removes visible comment/reactions; search settlement is pending. |
| 13 | `label.create` | explicit value or Lane Q: Guard/Insert | Authoritative JS applies the bound-source crew guard and inserts the caller's source id under a server-minted physical id. No pinned UI call site: Lane 6 remains server-only pending unless a gate invokes it. |
| 14 | `label.createAndAddToIssue` | explicit value or Lane Q: bounded two-Insert | Authoritative JS applies the bound-source crew/project guard, performs both inserts, and maintains `issueLabelRead` in one transaction. Lane 6 may insert visible label/membership prediction only when both collections are complete; otherwise pending. |
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
4. Compile the selected pair deterministically to the versioned normalized
   table files plus `tests/fixtures/fixture-digests.json`; refuse
   unknown/missing/duplicate ids or broken typed references. The complete
   fixture is not a versioned seed: LLP 0109 counts direct plus maintained
   effects and caps one seed installation at 1,024, while this fixture has
   3,758 rows. `snapback/seed.json` is therefore absent rather than truncated.
5. Load the compiled rows through the logical acceptance-only mutation
   `fixture.ingestBatch` (identifier-safe Snapback export
   `fixtureIngestBatch`) in deterministic parent-first batches of at most 900:
   user, project, label, issue, issueLabel, comment, emoji, viewState,
   userPref, issueNotifications, then the six support tables. The loader maps
   deterministic compiled placeholder ids to server-owned runtime ids and
   reverses that mapping before comparing every table and the overall digest.
6. Defer `large-seed-v1` and hot mutation/fanout data to a later Stage 0.5 job.
   Until that job lands, large-scale ZB5 rows are `GAP/deferred`; normal data
   cannot stand in for them and no performance/scale claim is allowed.

The fixture compiler is a provider-specific transformation and appears in the
workaround register. A fixture digest change creates a new receipt identity;
it never mutates prior attempt evidence.

### Bounded-ingest auth posture

This is a `sessions` app, but the fixture creates the source `user` rows that
an `identityBinding` can later connect to server-minted principals. Requiring a
pre-existing crew binding would therefore be circular. The loader follows the
guide's operator path exactly: `snapback session mint --email ... --ready-file
...` consumes the owned ready descriptor's admin token and process-bound
impersonation capability, then `createExternalSessionClient` presents the
resulting ordinary session bearer. The mutation also checks `ctx.auth.userId`.

The second gate is an acceptance-bootstrap window, not a reusable import role.
Before every batch the mutation requires `searchEpoch` to be empty and verifies
that every existing source user belongs to the frozen 14-user role/id set.
`searchEpoch` is last in the deterministic load order; inserting it closes the
window, so all later ingest calls refuse. Unknown tables, batches over 900,
system-authored fields, foreign source users, and out-of-domain `role` or
`visibility` values also refuse before storage. This narrow empty/in-progress
posture is justified only for an isolated acceptance server owned by the
harness.

The versioned composition gateway never includes `fixtureIngestBatch` or
`fixtureInspectTable` in its function allowlist, so neither is a product route.
ZB0 and ZB4 must directly assert that ingestion refuses after fixture
completion. Together with the session requirement, frozen-user check, and
last-table sentinel, those gates keep this workaround from becoming a
production write hole; any future production import needs a separately
designed authority and resumable protocol.

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

Rows not yet used retain `TBD-before-use`. Each implementing job must replace
that marker with measured source/provider line ranges before its first ZB0
attempt. Using a row before that update fails ZB0.

| ID / class | Reason and owner | Planned files / lines | Status and lifecycle | Security boundary | Removed by |
| --- | --- | --- | --- | --- | --- |
| `W-QGROUP` / manual query-group graph join | Current relational capability is bounded two-source, while issue/list shapes span up to 22 relations. Owner: control data lane. | Parent-authorized bounded graph loaders and manual projection assembly `snapback/functions.mjs:2322-2439,2552-2736,2922-3379`; route-absence/contract witness `tests/lane3-list-engine.test.mts:153-175` | Lane 3's attempted route manifest was removed after runtime admission proved that opaque JS-query arguments cannot supply the schema-derived route bindings. Implemented as parent-authorized typed JS graph loaders called individually by the client; retained through control and explicitly re-evaluated in Lane 6. | Every child query starts only after parent authorization; a bounded child contributes its own completeness fact and no merge infers completeness. | D2 graph/query workstream. |
| `W-READMODEL` / denormalized projection | All-label membership, project-user existence, wide list order, and comment-derived search do not fit one current live query. Owner: control server lane. | `snapback/schema.mjs:158-233`; `scripts/build-fixture.mts:511-643`; generated rows in `fixtures/normal-seed-v1/{projectUserRead,issueListRead,issueLabelRead,issueSearchDocument}.json` (complete files); Lane 4 transactional repair `snapback/functions.mjs:600-732,882-1672`; shared read-model predicate and graph hydration `snapback/functions.mjs:2322-2736,2999-3674`; independent raw-source oracle `tests/lane3-oracle.mts:1-164`; generated-handler witness `tests/lane3-list-engine.test.mts:1-354`; live parity harness `tests/acceptance/lane3-live.mts:1-781` | Implemented as bounded, rebuildable maintained projections plus source-row hydration. Every exact-bound hit refuses or returns no plausible prefix; all affected Lane 4 mutations repair projections transactionally; query result contracts remain source-shaped. Retained through control. | Visibility is applied before releasing `examined`/`total`; all-label membership is intersection; private rows resolve through the Lane 2 principal binding; per-mutation digest audit covers the projections. | D2 and D6. |
| `W-MANUALSET` / app join/filter/sort | Adapter intersects bounded list/search/label ids and assembles rich rows. Owner: control data lane. | Bounded joins/comparators/cursors `snapback/functions.mjs:2255-2439`; set intersection and shared list engine `snapback/functions.mjs:2441-2736`; all 19 typed entry points `snapback/functions.mjs:2760-3674`; independent oracle/cursor witnesses `tests/lane3-oracle.mts:1-164`, `tests/lane3-list-engine.test.mts:1-354`; live source-parity witness `tests/acceptance/lane3-live.mts:1-781` | Implemented as typed server-side manual merge for Lane 3; never broad/unbounded, and retained through control. The route-argument limitation recorded under `W-QGROUP` prevents moving the rich merge into a multi-child generated group without changing the frozen query arguments. | Inputs are role-partitioned before counts or joins; protected child roots prove the parent first; no protected key or partial prefix crosses the actor boundary. | D2/D3/D6. |
| `W-SEARCH-EPOCH` / manual invalidation | Shipped text search is not live, and current opaque handlers cannot invoke/compose a search plan. Owner: control search lane. | `snapback/schema.mjs:235-245`; `scripts/build-fixture.mts:625-635`; generated rows in `fixtures/normal-seed-v1/searchEpoch.json:1-14`; transactional repair/bump `snapback/functions.mjs:622-666,882-1672`; role-partitioned maintained-document scan and shared consumer `snapback/functions.mjs:2505-2736,3394-3469`; independent raw title/description/comment oracle `tests/lane3-oracle.mts:91-149`; pure/live search checks `tests/lane3-list-engine.test.mts:176-258`, `tests/acceptance/lane3-live.mts:359-422` | Implemented exact-corpus workaround: consult the epoch, scan only admitted visibility partitions, and return `refreshing` with no rows when any partition reaches 1,024. Affected mutations repair the document and bump its visibility partition in the source transaction. This is not advertised as shipped live search. Retained through control pending D6. | Epoch reveals no query text/result membership; documents are partitioned by public/internal; non-crew never query the internal partition; no boundary prefix is released. | D6 derived search. |
| `W-MUTATION-IR` / complete-program JS fallback | Inventory classifies `issue.addLabel` and `comment.edit` as current-IR from their base database verbs, but the current authoring surface cannot declare the complete authoritative program. Owner: control server lane. | Source-id/identity/intent helpers `snapback/functions.mjs:443-839`; JS-tier current-IR rows `snapback/functions.mjs:1172-1213,1476-1509`; generated-tier assertion `tests/acceptance/lane4-live.mts:456-475` | Implemented as JS/Ibex while retaining the inventory's **current-ir** classification for the base Get/Guard/Insert or Get/Guard/Patch. Generated `Get` accepts physical `_id`, not the frozen source id; `AuthUserId` is the principal, not its app-owned source-user binding; and current IR cannot include recipient-snapshot intent, read-model repair, or the full body policy. | The same server handler derives the bound actor, rechecks ownership, repairs projections, and commits intent; no client authority is inferred from the preliminary inventory class. | D5 source-key/identity bindings plus transaction-coupled intent/read-model composition. |
| `W-REDUCER` / duplicate handwritten reducer | Current generated optimism cannot express 11 new-verb and some branch/upsert/delete shapes. Owner: Lane 6 control UI lane. | Lane 4 authoritative baseline only: `snapback/functions.mjs:443-1672`, `tests/acceptance/lane4-live.mts:1-588`; client target `src/data/mutations.ts` / TBD-before-use in Lane 6 | **Not used in Lane 4.** Lane 4 implements and tests the authoritative corpus; any visible-fact capture-and-set reducer lands with the pinned UI in Lane 6 and must replace its TBD span before use. | Visible facts only; never predicts authority, hidden recipients, or delivery. | D5 lowering/admission. |
| `W-PENDING` / server-only pending | Hidden branch/subscription/effect state is not safely locally evaluable. Owner: Lane 6 control UI lane. | Lane 4 settlement facts: `snapback/functions.mjs:840-1672`, `tests/acceptance/lane4-live.mts:1-588`; client target `src/data/mutations.ts`, UI pending components / TBD-before-use in Lane 6 | **Not used in Lane 4 UI because that UI has not landed.** The authoritative result and replay surface are implemented; honest client pending presentation lands in Lane 6 and must replace its TBD span before use. | No speculative protected fact or false settlement. | D5. |
| `W-WINDOW` / app-owned window controller | No current source-equivalent `useZeroVirtualizer` primitive. Owner: control UI lane. | `src/windowing/*`, list/comments pages / TBD-before-use | Bespoke controller over supported bounded queries; retained through control. | Generation-fenced requests; parent policy on comments; honest completeness. | D4 window workstream. |
| `W-IDENTITY` / identity binding table | Snapback principals and frozen source user ids are distinct namespaces. Owner: auth composition. | `snapback/schema.mjs:144-156`; closed actor map and reusable guards `snapback/functions.mjs:56-152`; loaded-fixture proof and acceptance surfaces `snapback/functions.mjs:212-440`; receipt harness `scripts/bind-actors.mts:9-235`; runtime-independent witnesses `tests/lane2-functions.test.mts:123-254`; live seven-actor/transition gate `tests/acceptance/lane2-live.mts:46-222`; actor metadata in `fixtures/normal-seed-v1/fixture.json:7-33` and `tests/fixtures/fixture-digests.json:20-46` | Implemented as an acceptance-only, frozen-five, one-to-one binding bootstrap over supported dev sessions. Rebinding, unknown source users, role mismatches, sixth actors, and binding after closure refuse. `fixtureInspectTable` closes after the first binding. Retained through control; live gate awaits the supervising session. The adopted-bearer harness ends the server session through the shipped `/auth/logout` route (`authLogout` correctly refuses without browser `AuthCoordinator` custody); external user switch uses `replaceBearerToken`, which blanks predecessor state before refetch. | The stored principal is always `ctx.auth.userId`; every private helper resolves principal → binding → source row and accepts no caller user id. The acceptance actor selector is trusted only inside this fixture-gated bootstrap: current handler auth does not expose the verified mint email, so the mutation additionally requires the complete frozen fixture, exact actor/source/role map, one-to-one rows, five-row closure, and gateway omission. | D7 auth profile. |
| `C-GATEWAY` / versioned composition gateway | Native Snapback does not own all nine frozen arbitrary routes or GitHub OAuth. Owner: composition lane. | `composition/zerobugs-control-composition.v1.json`, `composition/server.mts`, `composition/routes/*` / TBD-before-use | Formally versioned bespoke D7 companion; local supported control component; no native claim. | Narrow route/function allowlist, session custody, redirect/token/secret policy, owned cleanup. | D7 routes/auth. |
| `C-NOTIFY` / durable app ledger and worker | `backend.notifications` is an explicit GAP; current jobs are local experimental. Owner: effect composition. | Intent/attempt schema `snapback/schema.mjs:247-291`; snapshot/idempotency helpers and eight trigger writers `snapback/functions.mjs:449-839,882-1050,1172-1251,1296-1405,1422-1509`; independent oracle/pure/live witnesses `tests/lane4-oracle.mts:1-722`, `tests/lane4-domain.test.mts:1-125`, `tests/acceptance/lane4-live.mts:1-588`; Lane 5 worker target `composition/effects/*` (span assigned before Lane 5 use) | Lane 4 local partial implemented: every trigger commits exactly one pending intent with payload/recipient snapshots in the source mutation transaction; every non-trigger and refusal commits none; replay settles without duplication. `notificationAttempt` is declared but deliberately empty. Delivery, retries, fencing, ambiguity, and capture remain Lane 5, and hosted remains GAP. | Mutation transaction owns intent; protocol settlement plus replay-stable runtime id owns logical idempotency; no provider call or secret use occurs in Lane 4. | D7 effects; first-class notification capability. |
| `C-ASSET` / source URL adapter and attachment metadata | Native local asset lifecycle differs from S3 presign/Markdown URL source shape. Owner: asset composition. | `snapback/schema.mjs`, `snapback/functions.mjs`, `composition/routes/upload.mts`, `src/assets/upload.ts` / TBD-before-use | Supported local asset capability + bespoke response/Markdown adapter; hosted GAP. | Server MIME/size/checksum, typed attachment, declared delivery/CORS, GC, no credential logging. | D7 assets/routes. |
| `W-FIXTURE` / fixture transformation and bounded loader | Frozen relational source ids must become typed prefixed placeholder references and support read models, while handlers may only create server-owned runtime ids and LLP 0109 caps a seed at 1,024 effects. Owner: fixture lane. | Compiler `scripts/build-fixture.mts:1-1115`; batch planning/id remap/digest verification `scripts/load-fixture.mts:14-342`; closed mutation and inspection allowlists `snapback/functions.mjs:12-274`; runtime-table-selected batch/result `v.json()` carrier `snapback/functions.mjs:239-256`; runtime-table-selected inspector with no expressible single-table document contract `snapback/functions.mjs:258-275`; focused witness `tests/fixture-loader.test.mts:1-153`; generated normalized rows in `fixtures/normal-seed-v1/*.json` (complete files); `fixtures/policy-extension-v1.json:1-162`; `tests/fixtures/fixture-digests.json:1-181` | Bespoke deterministic compiler plus 16 bounded ordinary mutation batches; retained for control reproducibility. No `seed.json` is authored. These two Lane 1 fixture-only dynamic-table boundaries are the only generated unknown shapes; every Lane 3 query uses a precise `results.records(v.object(...))` contract. | Dev-minted ordinary session; empty/in-progress frozen-user gate; final `searchEpoch` sentinel closes ingestion; gateway omission; exact ids/counts/digests after inverse remap. | D8 fixture/import profile may standardize a resumable authenticated bulk loader. |
| `W-ENUM` / duplicate closed-domain guard | Shipped table field validators do not admit literal unions for the source `role` and `visibility` varchar enums. Owner: schema/mutation lane. | Compiler guards `scripts/build-fixture.mts:190-203,645-742,758-784,811-865`; ingest guard `snapback/functions.mjs:62-90`; authoritative visibility/subscription/intent guards `snapback/functions.mjs:449-481`; guarded writers `snapback/functions.mjs:560-590,600-632,652-666,812-839,882-1541`; source varchar declarations remain `snapback/schema.mjs:16-20,51-54` | Bespoke closed-domain guards cover fixture ingestion and every Lane 4 write that authors or propagates role/visibility/subscription/intent state; schema remains `v.string()`. | Fail closed before storage; query auth never treats an unknown role as crew or visibility as public; no invalid trigger/kind/state pair reaches the ledger. | D5, if generated validation/lowering is extended to portable stored enum domains. |
| `W-SHORTID` / bounded source identity allocation | The pinned PostgreSQL issue table assigns `shortID` from an identity sequence starting at 3000, while current Snapback tables have no numeric identity/default declaration and the mutation arguments correctly omit that field. Owner: control server lane. | Bounded first-unused allocator and authoritative insert `snapback/functions.mjs:493-509,882-941`; independent oracle `tests/lane4-oracle.mts:131-138,353-361`; production-helper witness `tests/lane4-domain.test.mts:106-125` | Implemented for the admitted <1,024 control corpus. It chooses the first unused integer from 3000, so explicit high policy-fixture values do not advance the emulated sequence, and commits that value with the issue/intent. Refuses at the corpus proof boundary; large/hot qualification remains GAP. | Server-only allocation; caller cannot select a permalink id; the surrounding transaction owns the bounded read and insert. | Portable numeric identity/default support. |

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

- **2026-08-05 — acceptance fixture over 1,024 effects.** The guide correctly
  documents the versioned-seed effect ceiling and the general bounded mutation
  rule, but has no intent-indexed page or recipe for loading a deterministic
  acceptance fixture whose direct plus maintained rows exceed 1,024. The
  ≤900-row `ingestFixtureBatch` pattern exists only as demo folklore in
  `demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs`; finding
  and adapting it required repository search outside `guide/`.

- **2026-08-05 — binding a session principal to an app-owned source identity.**
  The sessions guide clearly documents `ctx.auth.userId`, dev-session minting,
  logout, and external bearer replacement, but has no intent-indexed recipe
  for securely populating an app-owned principal-to-source-user table. Handler
  auth exposes the verified principal but not the verified email supplied to
  `session mint`, so an in-handler actor/email claim cannot independently prove
  which frozen source row the principal should own. Lane 2 confines that claim
  to an acceptance-only mutation over the exact loaded fixture, a closed
  actor/source/role map, one-to-one refusal, five-row closure, and gateway
  omission. A production external broker still needs a trusted identity claim
  or privileged provisioning path; this harness is not presented as that
  product-auth design.

- **2026-08-05 — composing role-partitioned text search inside a typed live
  query.** The text-search guide documents standalone generated search plans,
  result typing, and the fact that search is not live. It does not document an
  admitted way for an opaque JS live-query handler to invoke a search plan, or
  a pattern for one public query whose search source must be selected from
  `public` versus `public + internal` only after server-side principal
  resolution. Exporting the internal plan as public would widen disclosure;
  accepting a caller role would violate Lane 2 identity custody. Lane 3 uses
  the maintained document only under a 1,024-row role-partitioned scan, checks
  `searchEpoch`, and refuses with `refreshing` at the proof boundary. This is
  recorded as `W-SEARCH-EPOCH`, not described as first-class search.

- **2026-08-05 — generated route-group arguments for structured query
  contexts.** The snapshot-bundle and query-group pages clearly cover
  primitive `routeParam()` bindings and literal arguments, but do not state
  that route lowering rejects a route parameter nested in an object and cannot
  express the null/union literal members required by the frozen list context.
  Lane 3's attempted rich list/detail bundle failed generation with
  `ROUTES_ARGS_INVALID`. It retained generated register-eligible list/detail
  identities using primitive wrapper arguments and kept the bounded graph
  merge inside the typed live handler. This limitation and the resulting
  single-child groups are counted under `W-QGROUP`/`W-MANUALSET` rather than
  presented as the planned multi-child merge.

- **2026-08-06 — current mutation IR cannot express the complete source-id
  program.** The mutation guide explains physical-id `Get`, `AuthUserId`, and
  Insert/Get/Guard/Patch lowering, but gives no pattern for a source-shaped
  mutation whose public id must first be resolved through an indexed lookup
  and whose principal must then be resolved through an app-owned identity
  binding. For `issue.addLabel` and `comment.edit`, the base source mutation
  still has the inventory's current-IR verb class, but the control's complete
  authoritative program also repairs read models and commits a recipient-
  snapshot intent. Both declarations therefore stay on the JS/Ibex tier and
  are counted under `W-MUTATION-IR`; the control does not relabel them as a new
  verb merely because the app-shaped binding/composition surface is absent.

- **2026-08-06 — JS mutation handlers cannot name their protocol settlement
  identity.** The offline/replay guide and client API document caller-supplied
  `clientMutationId`, and the server correctly returns the retained result
  without re-entering a handler on duplicate delivery. The JS handler context,
  however, does not expose that identity for a transaction-coupled downstream
  intent key. Lane 4 uses a namespaced replay-stable `ctx.runtime.id()` answer
  as the intent's unique logical key and proves same-`clientMutationId` replay
  does not duplicate it. Exposing a read-only settlement identity would let a
  future effect worker correlate client settlement and provider idempotency
  without this extra app-owned identity.

- **2026-08-06 — numeric identity/default columns.** The schema and mutation
  guides document server-owned physical `_id` values and runtime-generated
  answers, but not a portable table declaration for PostgreSQL's numeric
  `GENERATED BY DEFAULT AS IDENTITY START 3000` source field. That field is not
  cosmetic here: a newly created issue's notification and permalink require
  it, while the caller correctly supplies only the separate source `id`.
  `W-SHORTID` uses a server-only bounded first-unused allocation for the
  admitted control corpus and refuses at 1,024 rather than treating an
  explicit high policy-fixture sentinel as sequence progress. A first-class
  numeric identity/default would remove that scan and its large-corpus GAP.

## Lane 1 validation

Run on 2026-08-05 against the frozen `apps/zbugs` pin named by the lane task.
No runtime bootstrap or readiness repair was attempted.

| Command | Result |
| --- | --- |
| `ZBUGS_PIN=<frozen apps/zbugs> bun scripts/build-fixture.mts` | PASS, exit 0. Base counts matched the manifest exactly: 14 users (7 crew/7 user), one migration project, 516 public issues (155 open/361 closed), 924 comments, 30 labels, and 603 issue-label rows. The policy extension added the exact frozen issue/comment/emoji ids plus five rows in each principal overlay table. Compiled source counts are user 14, project 1, issue 517, viewState 5, comment 925, label 30, issueLabel 603, emoji 2, userPref 5, issueNotifications 5. Support counts are identityBinding 0 (principals are minted and bound in Lane 2), projectUserRead 12, issueListRead 517, issueLabelRead 603, issueSearchDocument 517, and searchEpoch 2. |
| fixture compiler, immediate second run | PASS; every generated fixture/seed/digest byte was identical. Combined generated-file SHA-256: `e7f5f86ab10a136b18f9637cd60ea29249c3d38c2b5a1dacf0bdca58c973346a`. Fixture overall digest: `sha256:be2eb1f31fe95e0a5c46a5230d98b18d762449e330691cb73e33d578fec276bd`. Read-model rebuild digest: `sha256:c43287c46d0188499aad41f52aaafd6e1f3ec63a651be75bc7b6d09f8a52010d`. |
| `bun scripts/build-fixture.mts` without `ZBUGS_PIN` | Expected refusal, exit 1: `ZBUGS_FIXTURE_REFUSED: ZBUGS_PIN must name the pinned apps/zbugs directory`. |
| `bun run generate` before local package links were installed | Exit 127: `/bin/bash: snapback: command not found`. |
| `bun install --offline` | PASS, exit 0; Bun 1.3.12 restored the lockfile-pinned repository-local packages. |
| `bun run generate` after install | **BLOCKED, exit 1.** The sole diagnostic is `SNAPBACK_SEED_EFFECT_LIMIT`: `versioned seed exceeds the 1024-effect ceiling`, reported at cumulative `rowCount: 1462`, `limit: 1024`. The complete compiled fixture has 3,758 direct rows after read models. Current codegen applies the same `validateTables` ceiling to legacy and versioned seed declarations, so changing seed syntax cannot admit the frozen fixture. No row was omitted, packed into an undeclared staging table, or truncated to manufacture a pass. |
| `bun run typecheck` | BLOCKED downstream of codegen, exit 2: the failed generator did not materialize `capability.manifest.json`, `functions.manifest.json`, or `schema.manifest.json`, so the existing imports in `src/main.tsx` cannot resolve. |
| `bun run build` | BLOCKED downstream of codegen, exit 1 with `SNAPBACK_CODEGEN_CACHE_INVALID`; the Vite plugin correctly refused the absent cache and instructed `snapback generate snapback`. |
| `SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback ./node_modules/.bin/snapback verify snapback --json` | Exit 1 at artifact freshness with `SNAPBACK_CODEGEN_CACHE_INVALID`; runtime readiness and seed/admission stages were reported `blocked`, so no seed-load claim is made. No bootstrap repair was attempted. |

The discrepancy above records the first Lane 1 attempt. The continuation task
authorized the repository-precedented bounded multi-transaction resolution:
the complete fixture stays in normalized versioned files, `seed.json` is
absent, and `fixtureIngestBatch` loads all 3,758 rows in 16 ordinary commits of
at most 900 rows. No fixture row was truncated and no seed/write limit was
raised.

### Lane 1 continuation — bounded fixture ingestion

Run on 2026-08-05 from `demos/zerobugs/control`. No runtime bootstrap,
readiness-receipt repair, port-policy repair, or fixture truncation was
attempted.

| Command | Result |
| --- | --- |
| `bun run generate` | PASS, exit 0: 16 tables and two acceptance-only operations (`fixtureIngestBatch`, `fixtureInspectTable`). The two warnings are explicit `v.json()`/unknown-result degradation facts for this fixture-only surface; no seed-effect diagnostic remains. |
| `bun run test:fixture` | PASS, exit 0: four Bun/Node-test cases prove deterministic load planning and inverse-id digest recovery, ≤900 batches, unknown-table refusal, W-ENUM role/visibility refusal, completion-sentinel refusal, and foreign-user refusal against the generated handler bundle. |
| `bun run typecheck` | PASS, exit 0. |
| `bun run build` | PASS, exit 0; Vite 8 built the client. The only output outside the build inventory was the upstream `optimizeDeps.rollupOptions` deprecation warning. |
| `SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback ./node_modules/.bin/snapback dev snapback --db /private/tmp/zerobugs-lane1.7ososc/zerobugs.sqlite --ready-file /private/tmp/zerobugs-lane1.7ososc/dev.ready.json --json` | **ENVIRONMENT BLOCKED, exit 1:** exact code `SNAPBACK_DEV_SERVER_START_FAILED`; nested server stderr was `failed to bind Snapback server to 127.0.0.1:4287: Operation not permitted (os error 1)`. Per task instruction, runtime work stopped here: `scripts/load-fixture.mts` was not invoked, so no live loaded-count or live digest-verification result is claimed. The child had exited, the owned temp directory was deleted, and `lsof` reported no listener on 4287. Process-table inspection itself was sandbox-refused. |

The runtime-independent contract remains: source counts user 14, project 1,
label 30, issue 517, issueLabel 603, comment 925, emoji 2, viewState 5,
userPref 5, issueNotifications 5; support counts identityBinding 0,
projectUserRead 12, issueListRead 517, issueLabelRead 603,
issueSearchDocument 517, searchEpoch 2; overall rows 3,758 and expected digest
`sha256:be2eb1f31fe95e0a5c46a5230d98b18d762449e330691cb73e33d578fec276bd`.
These values passed the focused compiler-output/loader normalization test, but
the environmental runtime refusal prevents calling them live-load evidence.

### Lane 1 continuation — live load outside the sandbox

Run on 2026-08-05 by the supervising session (outside the codex sandbox,
which cannot bind loopback). Server: `snapback dev` with
`SNAPBACK_RUNTIME_BINARY=<repo>/target/debug/snapback` against a scratch
database; loader: `scripts/load-fixture.mts`.

Loader defects found and fixed during this run:

1. **Session mint used the wrong credential path.** The loader invoked
   `session mint` and got `SNAPBACK_ADMIN_TOKEN_REQUIRED`: mint is an
   admin-gated host-op. The loader now reads the managed admin-token carrier
   named by the readiness descriptor (`adminTokenFile`) and passes it as
   `SNAPBACK_ADMIN_TOKEN` in the mint environment only.
2. **Digest mismatches were undiagnosable.** On mismatch the verifier now
   reports the first differing row (observed vs compiled canonical JSON).
3. **Null canonicalization.** The runtime returns unset optional fields as
   explicit `null`; the compiled fixture omits them. The query surface does
   not distinguish null from absent, so observed-row normalization now drops
   null-valued fields before digesting. First observed on the single
   `project` row (`issueCountEstimate`/`markURL`/`logoURL`).

Result: **BLOCKED by a runtime defect, not by the fixture.** All 16 batches
ingested; per-table counts matched; the `comment` digest failed at row index
886: the pinned 44,084-char body is stored intact (verified in raw SQLite)
but the JS query handler read it back silently clipped to exactly 16,384
chars. Filed as
`issues/20260805-js-handler-string-reads-silently-truncate-16kib.md`; fix in
progress. Until the rebuilt runtime lands, the live digest verification is
recorded BLOCKED-on-runtime; fixture bytes, counts, and the loader pipeline
are complete and deterministic.

### Lane 1 completion — live load PASS on the repaired runtime

The truncation defect was fixed (successful JS results were serialized
through the bounded failure-metadata replacer; see
`issues/closed/20260805-js-handler-string-reads-silently-truncate-16kib.md`).
On the rebuilt runtime the full live load passed on 2026-08-05:

```json
{"status":"ok","counts":{"user":14,"project":1,"label":30,"issue":517,
"issueLabel":603,"comment":925,"emoji":2,"viewState":5,"userPref":5,
"issueNotifications":5,"identityBinding":0,"projectUserRead":12,
"issueListRead":517,"issueLabelRead":603,"issueSearchDocument":517,
"searchEpoch":2},
"overallDigest":"sha256:be2eb1f31fe95e0a5c46a5230d98b18d762449e330691cb73e33d578fec276bd",
"batches":16}
```

The observed overall digest equals the compiled contract digest exactly.
Lane 1's completion check (sequencing row 1) is met: counts/ids/digests pass,
typed refs and the read-model rebuild digest pass, and `snapback generate`
passes. Lane 2 (local auth/identity composition) is next.

## Lane 2 validation

Run on 2026-08-05 from `demos/zerobugs/control`. The Codex sandbox cannot bind
loopback, so every runtime-independent check ran here and the live server gate
is explicitly left for the supervising session.

| Command | Result |
| --- | --- |
| `bun run generate` | PASS, exit 0: 16 tables and seven acceptance-only operations (five queries, two mutations), 38 generated files. The only two warnings remain the declared fixture-only `v.json()`/unknown-result degradation facts. |
| `bun run test:lane2` | PASS, exit 0: generation plus eight Bun tests. The four Lane 2 tests exercise explicit session gates, identity-free private args, all five frozen bindings and every rebind refusal, sixth/unknown actor refusal, missing and role-mismatched source refusal, unbound-principal refusal, crew and internal-visibility refusal for an ordinary user, creator admission and assignee ownership refusal, principal-owned overlay selection, and closure of the broad fixture inspector after identity bootstrap begins. The four Lane 1 loader tests also remain green. |
| `bun run typecheck` | PASS, exit 0. |
| `bun run build` | PASS, exit 0; Vite 8 built the client. The only extra output was the upstream `optimizeDeps.rollupOptions` deprecation warning. |
| `bun build tests/acceptance/lane2-live.mts --target=bun --outfile=/private/tmp/zerobugs-lane2-live-check.mjs` | PASS, exit 0: the live harness and its 51-module dependency graph parse and bundle for Bun. |
| `./ref-check --verbose` (repository root) | PASS, exit 0: 188 LLP documents, 3,155 refs in 7,801 files, 0 errors, 0 unchecked. |
| `node scripts/check-guide.mjs` (repository root) | **BLOCKED OUTSIDE LANE SCOPE, exit 1:** 56 pages, 174 snippets, 111 routes + 37 host-ops joined, with 43 drift warnings. The errors are pre-existing/missing generated examples under `demos/competitive-checkpoint` and `demos/todo-v2`, plus a stale root `guide/guide-manifest.generated.json`. Lane 2 changes no `guide/` file, and its write boundary is `demos/zerobugs/control/`, so no out-of-scope regeneration or example repair was attempted. |
| `git diff --check` | PASS, exit 0. |
| `SNAPBACK_READY_FILE=<ready-file> SNAPBACK_RUNTIME_BINARY=<runtime-binary> bun tests/acceptance/lane2-live.mts` | **AWAITING SUPERVISING LIVE RUN.** Against the already Lane-1-loaded scratch database, this emits the deterministic `zerobugs-actor-bindings.v1` receipt and a `zerobugs-lane2-live.v1` receipt, or exits nonzero. It covers the five authenticated actors plus anonymous and forged-bearer attacker semantics; deterministic distinct-email minting; exact source bindings; rebind and actor-set closure; unbound, crew, ownership, anonymous, and attacker refusals; `/auth/logout` invalidation of the current and copied stale adopted bearer; `replaceBearerToken` transition to removed-member without predecessor overlay exposure; caller-selected private-id rejection; and post-bind fixture-inspector closure. Principals are recorded as returned by session mint but are not incorporated into a digest. |

The shipped auth surface does have explicit transition primitives, so Lane 2
does not record a logout/invalidation product gap. Browser coordinator custody
uses `authLogout()`; this adopted-bearer harness drives the shipped
`/auth/logout` endpoint directly because `authLogout()` intentionally refuses
without an `AuthCoordinator`. `replaceBearerToken()` then provides the
documented external user-switch barrier. Completion row 2 is not marked met
until the final command passes on a live server.

### Lane 2 completion — live actor harness PASS

Run on 2026-08-05 by the supervising session (outside the codex sandbox)
against a fresh server + full Lane 1 fixture load. All nine expected checks
executed and passed: five frozen actors bind deterministically with rebinding
refused; unbound principals, anonymous callers, and forged/expired bearers are
refused on principal-bound paths; the crew guard admits crew-admin and refuses
ordinary; ownership admits creator and refuses assignee; the logout route and
user switching retire the predecessor's private overlay; and no private
overlay path accepts a caller-selected identity. Receipt schema
`zerobugs-lane2-live.v1` (expectedChecks 9 / executedChecks 9 / status ok).
Sequencing row 2's completion check is met; Lane 3 (query/read-model corpus)
is next.

## Lane 3 validation

Run on 2026-08-05 from `demos/zerobugs/control`. The sandbox cannot bind
loopback, so the runtime-independent implementation and oracle checks ran here
and the fresh-server parity receipt is explicitly left for the supervising
session. No live result is claimed below.

| Command | Result |
| --- | --- |
| `bun run generate` | PASS, exit 0: 16 tables and 27 operations (five Lane 1/2 queries, 20 live queries comprising the 19 frozen names plus the primitive-argument detail route wrapper, and two mutations), 99 generated files. Both routes are `registerGroupEligible`. The only two warnings are the pre-existing `W-FIXTURE` dynamic-table `v.json()`/unknown shapes; all 19 Lane 3 results generate precise record contracts. |
| `bun run test:lane3` | PASS, exit 0: generation plus 13 Bun tests across the Lane 1 loader, Lane 2 identity/guards, and Lane 3 query corpus. Lane 3 executes the generated handler against compiled fixture tables while its expected membership comes independently from raw source issue/comment/label/user rows. It proves all filter classes (including all-label intersection and three search sources), all four sort modes, full forward/backward walks without skips/duplicates, deprecated neighbor parity, protected counts, exact route-group identities, nullable-limit refusal, and explicit small-window incompleteness. |
| `bun run typecheck` | PASS, exit 0. |
| `bun run build` | PASS, exit 0; Vite 8 built the client. Output contained the upstream `optimizeDeps.rollupOptions` deprecation and the existing chunk-size advisory only. |
| `bun build tests/acceptance/lane3-live.mts --target=bun --outfile=/private/tmp/zerobugs-lane3-live-check.mjs` | PASS, exit 0: the live parity harness and its 52-module dependency graph parse and bundle for Bun. |
| `./ref-check --verbose` (repository root) | PASS, exit 0: 188 LLP documents, 3,334 refs in 8,389 files, 0 errors, 0 unchecked. |
| `git diff --check -- demos/zerobugs/control` | PASS, exit 0. |
| `SNAPBACK_READY_FILE=<fresh-server-ready-file> SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback bun tests/acceptance/lane3-live.mts` | **AWAITING SUPERVISING LIVE RUN.** Run from `demos/zerobugs/control` against an empty fresh server. The harness performs the complete Lane 1 fixture load and Lane 2 five-actor bindings itself, then emits one `zerobugs-lane3-live.v1` receipt with `expectedChecks: 16`, `executedChecks: 16`, and a pass/fail record for every check; any failure exits nonzero after emitting the complete receipt. |

The live oracle reads only the ten compiled source fixture tables and derives
list membership, text matches (title, description, and comment body), relation
membership, visibility, and private overlay expectations in test code. It does
not inspect or reuse the server's `issueListRead`, `issueLabelRead`,
`issueSearchDocument`, `projectUserRead`, or query output to calculate expected
results. The 16 checks non-vacuously exercise every frozen query name; all
single and combined list filters; both ordered fields and directions; forward
and backward issue/comment cursors; deprecated query parity; inside/outside
window permalinks; missing-versus-invisible non-oracular not-found shapes;
crew versus ordinary/anonymous/creator/assignee policy (including counts and
child roots); principal-bound preferences/view state/notifications; bounded
preload/detail graphs; and explicit small-page incompleteness.

The creator/assignee mismatch is intentionally pinned: they may own or be
assigned the policy-extension issue for mutation policy but remain non-crew,
so query visibility returns the same authoritative not-found shape as a
missing issue. Their stored issue overlays are consequently not released;
the oracle expects only principal-owned rows whose parent is visible. Crew
actors receive exactly their own internal view/notification overlays, while
all five actors receive exactly their own `userPref` row.

### Lane 3 amendment — route-cut query groups unavailable to JS queries

The runtime refused the Lane 3 routes manifest at boot
(`SNAPBACK_ROUTES_MANIFEST_INVALID`): `routeParam` bindings require
schema-derived scalar arg types, which only generated declarative queries
(`defineLiveQuery`) carry. All Lane 3 graph queries are `defineJsLiveQuery`
handlers, so none can join a route-cut group. `snapback/routes.mjs` is
removed; the client assembles screens from individual query calls. This is
recorded under W-QGROUP as measured control burden: a D2 successor graph
whose plans are generated (not JS-authored) would restore route-cut group
identity for these screens.

### Lane 3 completion — live parity harness PASS

Run on 2026-08-06 by the supervising session against a fresh server. All 16
checks executed and passed (receipt `zerobugs-lane3-live.v1`, expectedChecks
16 / executedChecks 16): catalog/point parity, label ordering, project-user
membership and deprecated picker branches, every list filter and combined
case, four sort modes with bidirectional keyset walks (no duplicates/skips),
deprecated list/prevNext oracle sharing, permalinks inside/outside the window
with authoritative not-found, issue-detail and public comment-graph parity,
gated child roots proving parent visibility first, internal-issue visibility
(crew-only across list/detail/preload), principal-overlay isolation,
small-window incompleteness declaration, bounded preload child facts, and
all-19-names exercised. Two environment findings during the run: the dev
server's mint surface settles slightly after the ready file appears (harness
callers should wait for the impersonation capability file), and the live run
surfaced a client defect — anonymous-public custody sent legacy auth body
fields (fixed in packages/snapback-client, see
issues/closed/20260805-anonymous-public-query-body-carries-legacy-auth.md).
Sequencing row 3's completion check is met; Lane 4 (mutation corpus) is next.

## Lane 4 validation

Run on 2026-08-06 from `demos/zerobugs/control`. The sandbox cannot bind
loopback, so the runtime-independent corpus/oracle checks ran here and the
fresh-server live receipt is explicitly left for the supervising session. No
live result or Lane 4 completion claim is made below.

| Command | Result |
| --- | --- |
| `bun run generate` | PASS, exit 0: 18 tables and 44 operations (six queries, 20 live queries, 18 mutations), 149 generated files. The only two warnings remain the pre-existing `W-FIXTURE` dynamic-table argument/result degradations; all 16 product mutations have precise result contracts. |
| `bun run test:lane4` | PASS, exit 0: generation plus 17 Bun tests across the deterministic fixture loader, Lane 2 identity/guards, Lane 3 query/read-model engine, and Lane 4 pure domain helpers. The four Lane 4 tests import the production intent, cleanup, and short-id helpers; prove internal/public recipient selection and payload determinism; prove issue/comment dependent-cleanup plans; preserve the source identity sequence despite an explicit high sentinel; and independently rebuild all four maintained read models from raw fixture state. |
| `bun run typecheck` | PASS, exit 0. |
| `bun run build` | PASS, exit 0; Vite 8 built the client. Output contained the upstream `optimizeDeps.rollupOptions` deprecation and existing chunk-size advisory only. |
| `bun build tests/acceptance/lane4-live.mts --target=bun --outfile=/private/tmp/zerobugs-lane4-live-check.mjs` | PASS, exit 0: the live corpus harness and its 52-module dependency graph parse and bundle for Bun. |
| `./ref-check --verbose` (repository root) | PASS, exit 0: 188 LLP documents, 3,907 refs in 10,238 files, 0 errors, 0 unchecked. |
| `git diff --check -- demos/zerobugs/control` | PASS, exit 0. |
| `SNAPBACK_READY_FILE=<fresh-server-ready-file> SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback bun tests/acceptance/lane4-live.mts` | **AWAITING SUPERVISING LIVE RUN.** Run from `demos/zerobugs/control` against an empty fresh server. The harness waits for both the stable ready descriptor and its advertised `.impersonation` capability before minting, performs the complete Lane 1 load and Lane 2 bindings, and emits one `zerobugs-lane4-live.v1` receipt with `expectedChecks: 18`; any incomplete or failing run exits nonzero. |

All 16 frozen mutators now have authoritative JS handlers. Each resolves the
principal through `requireSourceUser`, preserves the source contract's caller
id while Snapback mints the physical prefixed `_id`, assigns the source's
server-owned numeric issue `shortID`, applies the pinned
timestamp override or caller-value policy, rechecks creator/crew or mutation-
visibility policy, maintains affected Lane 3 projections in the same
transaction, and performs explicit dependent cleanup. `issue.addLabel` and
`comment.edit` retain their preliminary **current-ir** classification for the
base database program, while `W-MUTATION-IR` records why the complete
source-id/identity/read-model/intent program is JS-tier on the current surface.

The live oracle starts only from the raw fixture JSON and independently applies
each declared mutation effect. Every one of the 16 mutator checks first proves
that a wrong or unbound actor produces no source, projection, or intent change;
then proves the authorized result through a separate crew observer; compares
the entire source/projection state with the oracle; recomputes the read-model
rebuild digest; checks its trigger/non-trigger intent delta and exact parsed
payload/recipient snapshot; and re-sends the identical operation with the same
`clientMutationId` to prove the retained result does not double-apply. The
eight trigger rows must create exactly one pending durable intent each, the
eight non-trigger rows must create none, and `notificationAttempt` must remain
empty because Lane 5 owns delivery and capture.

`W-REDUCER` and `W-PENDING` are not silently claimed by this lane: they are
Lane 6 browser/UI concerns and retain their before-use markers. Lane 4 supplies
the authoritative mutation and replay baseline against which any later local
prediction or honest pending presentation must settle.

### Lane 4 completion — live mutation corpus PASS

Run on 2026-08-06 by the supervising session against a fresh server. All 18
checks executed and passed (receipt `zerobugs-lane4-live.v1`): the frozen
lowering inventory (all 16 mutators generated, JS/Ibex tier, no current-IR
declaration admitted for the two current-IR-classified programs — recorded in
the register), and per-mutator positive parity against the independent
oracle, authorization refusals with no partial write and no intent row,
read-model rebuild-digest parity after every write, independent-observer
convergence, durable-intent creation for exactly the eight trigger
operations, none for non-triggers or refusals, and same-client-mutation-id
replay without double-apply.

Two supervisor corrections to the harness during the live run (not to the
corpus): physical row ids and intent ids mint the runtime's generic `id_`
prefix — the shipped surface has no per-table prefix declaration (LLP 0148
reserves named prefixes for built-ins like `usr_`), so expectations of
`issue_`/`notificationIntent_`-style prefixes were wrong; and the generated
functions manifest omits the `ir` field rather than carrying `ir: null`.
Sequencing row 4's completion check is met; Lane 5 (routes/assets/effect
delivery) is next.
