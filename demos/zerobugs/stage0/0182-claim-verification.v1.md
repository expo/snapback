# LLP 0182 claim verification v1

**Date:** 2026-08-05  
**Pin commit:** `25c2c7308d3eb674d2d895022c9da11ef0c742fb`  
**Verifier:** Codex gpt-5.6-sol xhigh  
**Method:** I read LLP 0182 in full, verified the supplied checkout with
`git rev-parse HEAD`, and inspected the sparse pin's `apps/zbugs` and
`packages/zero` files directly. Citations below are pin-relative paths with
inclusive line numbers. I did not access the network. For the synthetic
fixture I checked both the prose guide and the executable generator, then
replayed only the generator's deterministic count logic at its default seed;
I did not generate the multi-million-row CSV fixture. External-site and
external-documentation claims are therefore marked `UNVERIFIABLE-FROM-PIN`.
Snapback `[observed]` claims received only the requested header/summary
spot-check.

Verdicts mean:

- **CONFIRMED** — the pinned files directly support the claim.
- **DISCREPANT** — the pinned files contradict or materially narrow the claim.
- **UNVERIFIABLE-FROM-PIN** — the sparse pin cannot establish the claim.

## Pinned-source claims

### Provenance and versions

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| P1 | The inspected source is Rocicorp mono commit `25c2c7308d3eb674d2d895022c9da11ef0c742fb`. | **CONFIRMED** | `git -C <pin> rev-parse HEAD` returned the exact commit. |
| P2 | The workspace Zero package is version `1.10.0`. | **CONFIRMED** | `packages/zero/package.json:1-4`. |
| P3 | Zerobugs depends on `@rocicorp/zero-virtual` `0.6.3`. | **CONFIRMED** | `apps/zbugs/package.json:40-52`. |
| P4 | The README describes Zerobugs as continuously deployed from trunk to AWS and used as Zero dogfood. | **CONFIRMED** | `apps/zbugs/README.md:1-5`. This confirms what the README says, not the state of the live deployment. |
| P5 | The live site was actually available or continuously deployed on 2026-08-05. | **UNVERIFIABLE-FROM-PIN** | The pin contains only the README assertion at `apps/zbugs/README.md:3-5`; no live-site check was permitted. |

### Ten-table schema and relationships

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| S1 | The schema has ten tables. | **CONFIRMED** | The ten table definitions are at `apps/zbugs/shared/schema.ts:14-112`; the schema registers exactly those ten at `apps/zbugs/shared/schema.ts:253-265`. |
| S2 | `user` carries GitHub identity/presentation data. | **CONFIRMED** | The synchronized schema carries id, login, name, avatar, and role at `apps/zbugs/shared/schema.ts:14-22`. The server's GitHub identity mapping/upsert also carries `githubID` and email at `apps/zbugs/api/index.ts:78-105`. |
| S3 | `project` is the issue namespace and carries search capability **and visibility**. | **DISCREPANT** | `project` has id/name/lower-case name, issue-count estimate, `supportsSearch`, and marks/logos at `apps/zbugs/shared/schema.ts:24-34`; it has no visibility field. Visibility is an `issue` field at `apps/zbugs/shared/schema.ts:36-50`. |
| S4 | `issue` carries title, description, status, creator, assignee, visibility, and ordering fields. | **CONFIRMED** | `apps/zbugs/shared/schema.ts:36-50`. |
| S5 | `viewState` is per-user viewed state. | **CONFIRMED** | It has `(userID, issueID)` identity and `viewed` at `apps/zbugs/shared/schema.ts:52-58`. |
| S6 | `comment` represents issue discussion. | **CONFIRMED** | It carries issue, body, creator, and creation time at `apps/zbugs/shared/schema.ts:60-68`. |
| S7 | `label` is project label vocabulary. | **CONFIRMED** | `apps/zbugs/shared/schema.ts:70-76`. |
| S8 | `issueLabel` is issue/label many-to-many membership. | **CONFIRMED** | The junction table is at `apps/zbugs/shared/schema.ts:78-84`; the two-hop issue-to-label relation is at `apps/zbugs/shared/schema.ts:147-163`. |
| S9 | `emoji` represents issue/comment reactions with a creator relation. | **CONFIRMED** | Reaction columns are at `apps/zbugs/shared/schema.ts:86-95`; creator, issue, and comment relations are at `apps/zbugs/shared/schema.ts:235-251`. |
| S10 | `userPref` is per-user preference state. | **CONFIRMED** | `apps/zbugs/shared/schema.ts:97-103`. |
| S11 | `issueNotifications` is per-user issue-subscription state. | **CONFIRMED** | `apps/zbugs/shared/schema.ts:105-112`. |
| S12 | The graph includes to-one, to-many, many-to-many, optional, and per-user relations. | **CONFIRMED** | To-many and to-one relations are declared at `apps/zbugs/shared/schema.ts:115-194`; many-to-many is at `apps/zbugs/shared/schema.ts:147-163`; optional assignee identity is at `apps/zbugs/shared/schema.ts:44-48,174-178`; queries principal-scope `viewState` and notifications at `apps/zbugs/shared/queries.ts:109-111,226-233`. |
| S13 | “The table count is not difficult for Snapback” and the graph operations are the meaningful workload. | **UNVERIFIABLE-FROM-PIN** | These are comparative interpretations, not facts the Rocicorp pin can prove. They should not inherit a `[source]` label. |

### Issue-list, preload, detail, and comments queries

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| Q1 | The issue list restricts issues to one project through relationship existence and applies role-based visibility. | **CONFIRMED** | Project `whereExists` is at `apps/zbugs/shared/queries.ts:413-419`; non-crew callers are restricted to public issues at `apps/zbugs/shared/queries.ts:15-20,482`. |
| Q2 | It relates the current user's `viewState` and issue labels. | **CONFIRMED** | `apps/zbugs/shared/queries.ts:403-407`. |
| Q3 | It filters by open/closed state and by creator and assignee through related users. | **CONFIRMED** | Open filtering is at `apps/zbugs/shared/queries.ts:437-442`; creator/assignee relationship filters are at `apps/zbugs/shared/queries.ts:471-479`. |
| Q4 | Every selected label is required through nested `issueLabel -> label -> project` existence tests. | **CONFIRMED** | The selected-label array is mapped into the enclosing `and`, with both nested relations, at `apps/zbugs/shared/queries.ts:438-469`. |
| Q5 | Text search matches title, description, or related comment body case-insensitively. | **CONFIRMED** | `ILIKE` predicates over all three sources are at `apps/zbugs/shared/queries.ts:442-449`. |
| Q6 | Ordering uses a selectable field and id tie-breaker. | **CONFIRMED** | Sort-field/direction parameters are at `apps/zbugs/shared/queries.ts:25-34`; the two-field ordering is at `apps/zbugs/shared/queries.ts:421-428`. |
| Q7 | The list supports forward and backward keyset windows. | **CONFIRMED** | Direction reverses ordering, `start` supplies the cursor, and `limit` bounds the page at `apps/zbugs/shared/queries.ts:392-435`; the public query carries `start`, `dir`, and `inclusive` at `apps/zbugs/shared/queries.ts:251-262`. |
| Q8 | The list returns a typed, relation-bearing result consumed directly by React. | **CONFIRMED** | The result type is derived from `issueListV2` at `apps/zbugs/shared/queries.ts:485-487`; React imports that type and renders `viewState` and labels directly at `apps/zbugs/src/pages/list/list-page.tsx:22-27,60-125`. |
| Q9 | The preload includes labels, principal-scoped view state, creator, assignee, emoji/creators, and ten newest comments with creators/emoji. | **CONFIRMED** | `apps/zbugs/shared/queries.ts:96-127`, especially relations at lines 108-120. |
| Q10 | Issue detail includes project, creator, assignee, labels, notification state, view state, emoji, and fifty comments. | **CONFIRMED** | `apps/zbugs/shared/queries.ts:212-249`, including the 50-comment bound at lines 235-245. |
| Q11 | A separate comments-page query provides a bidirectional keyset window for long threads, plus a single-comment permalink lookup. | **CONFIRMED** | `commentsPage` is at `apps/zbugs/shared/queries.ts:177-200`; the single-comment query is at `apps/zbugs/shared/queries.ts:202-210`. |
| Q12 | This query graph is an ordinary polished-screen workload rather than exotic analytics. | **UNVERIFIABLE-FROM-PIN** | This is an application-design interpretation, not a source fact. |

### React virtualization and completeness

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| V1 | The issue list uses `useZeroVirtualizer`; comments use `useZeroWindowVirtualizer`. | **CONFIRMED** | `apps/zbugs/src/pages/list/list-page.tsx:1-6,259-308`; `apps/zbugs/src/pages/issue/comments.tsx:1-7,79-97`. |
| V2 | The hooks own viewport-driven page sizing, forward/backward fetch requests, and spacer values at the application boundary. | **CONFIRMED** | The list passes its scroll element and receives hook-selected `limit`/`dir` plus spacer values at `apps/zbugs/src/pages/list/list-page.tsx:246-285,532-555`; comments does the same and sets a 20-row minimum at `apps/zbugs/src/pages/issue/comments.tsx:55-97,101-112`. The sparse pin omits the `zero-virtual` package internals, so this confirms delegation and use, not its internal algorithm. |
| V3 | Permalinks use a target window and single-row lookup, with missing-target handling. | **CONFIRMED** | The issue list passes `permalinkID`, supplies `listIssueByID`, and handles `permalinkNotFound` at `apps/zbugs/src/pages/list/list-page.tsx:268-324`. Comments supplies a single-comment query and permalink id at `apps/zbugs/src/pages/issue/comments.tsx:39-45,79-97`. |
| V4 | Scroll state persists across navigation. | **CONFIRMED** | The app stores virtualizer scroll state in Wouter history at `apps/zbugs/src/hooks/use-wouter-scroll-state.ts:4-22` and passes it to the list hook at `apps/zbugs/src/pages/list/list-page.tsx:255,300-308`. |
| V5 | The UI distinguishes complete results from hydration/incomplete presentation. | **CONFIRMED** | List readiness and recording wait on `complete` at `apps/zbugs/src/pages/list/list-page.tsx:259-268,326-337`, while unresolved rows render skeletons at `apps/zbugs/src/pages/list/list-page.tsx:83-90`; comment rows do likewise at `apps/zbugs/src/pages/issue/comments.tsx:123-139`. |
| V6 | Result `complete` prevents a temporarily absent issue from becoming canonical not-found. | **CONFIRMED** | The detail page returns Not Found only when no row exists **and** `issueResult.type === 'complete'` at `apps/zbugs/src/pages/issue/issue-page.tsx:88-96,309-315`; the redirect route uses the same rule at `apps/zbugs/src/pages/issue/issue-page.tsx:790-810`. |

### Mutations, client values, server values, and offline controls

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| M1 | The shared surface includes issue create/update/delete and label add/remove. | **CONFIRMED** | `apps/zbugs/shared/mutators.ts:70-183`. |
| M2 | It includes notification changes, emoji insert/delete, comment add/edit/delete, label create/create-plus-attach, view-state upsert, and user-preference upsert. | **CONFIRMED** | Notifications: `apps/zbugs/shared/mutators.ts:185-200`; emoji: `202-221`; comments: `223-258`; labels: `260-317`; view state: `319-331`; user preferences: `333-345`. |
| M3 | The operation corpus contains authorization reads, branches, inserts, updates/patches, deletes, upserts, and multi-table writes. | **CONFIRMED** | Representative authority read/branch/update is at `apps/zbugs/shared/mutators.ts:99-149`; insert/delete paths at `152-181,202-257`; the label two-table write at `284-315`; notification read/branch/upserts at `383-424`. |
| M4 | Clients generate ids and timestamps for immediate shared-mutator execution. | **CONFIRMED** | Issue create uses `nanoid()` and `Date.now()` at `apps/zbugs/src/pages/issue/issue-composer.tsx:62-74`; comments do so at `apps/zbugs/src/pages/issue/comment-composer.tsx:33-43`; emoji does so at `apps/zbugs/src/components/emoji-panel.tsx:56-70`. |
| M5 | Server forms re-run shared authorization logic. | **CONFIRMED** | Server overrides invoke the shared mutator functions at `apps/zbugs/server/server-mutators.ts:25-54,57-79,82-130,134-205,209-275`; those shared functions perform the authorization checks cited in M3. |
| M6 | Server forms may replace client-derived timestamps while preserving client ids. | **CONFIRMED** | The scope is narrower than S4 states: issue create/update preserve id and replace created/modified at `apps/zbugs/server/server-mutators.ts:28-46,57-67`; emoji adds preserve id and replace created at `apps/zbugs/server/server-mutators.ts:134-180`; comment add preserves id and replaces created at `apps/zbugs/server/server-mutators.ts:209-226`. |
| M7 | All pinned server mutators replace client timestamps with `Date.now()`. | **DISCREPANT** | There are no server overrides for `viewState.set` or `notification.update`; their shared implementations retain caller-supplied `viewed`/`created` at `apps/zbugs/shared/mutators.ts:185-200,319-331`. The replacement claim is true only for issue create/update, emoji add, and comment add. |
| M8 | Email or Discord work is triggered after commit. | **CONFIRMED** | Notification tasks are enqueued at `apps/zbugs/server/notify.ts:104-140`; the API executes them only after `handleMutateRequest` returns at `apps/zbugs/api/index.ts:168-189`. |
| M9 | Zero applies locally, executes transactionally on the server, and rebases or rolls back on authority return. | **UNVERIFIABLE-FROM-PIN** | This is explicitly a first-party-documentation claim in LLP 0182. The sparse pin does not contain the referenced docs or the `zero-client`/`zero-cache` implementation packages. |
| M10 | Current Zero lacks durable disconnected writes. | **UNVERIFIABLE-FROM-PIN** | This depends on external connection/mutator documentation, which was not fetched. |
| M11 | `useIsOffline` treats disconnected or error connection states as offline. | **CONFIRMED** | `apps/zbugs/src/hooks/use-is-offline.ts:1-8`. |
| M12 | Zerobugs disables write controls while offline. | **CONFIRMED** | Shared Button and Combobox controls disable offline unless explicitly opted in at `apps/zbugs/src/components/button.tsx:25-30,72-81` and `apps/zbugs/src/components/combobox.tsx:35-50,142-150`; issue/comment composers explicitly disable inputs/actions at `apps/zbugs/src/pages/issue/issue-composer.tsx:121-160` and `apps/zbugs/src/pages/issue/comment-composer.tsx:95-103`; issue mutation controls pass `isOffline` at `apps/zbugs/src/pages/issue/issue-page.tsx:472-575`. Automatic view-state code is not a user write control. |

### Application services and production-source shape

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| A1 | The app implements GitHub OAuth, JWT minting, and insert-or-update user handling. | **CONFIRMED** | OAuth setup/callback is at `apps/zbugs/api/index.ts:41-83`; user insert/update is at `84-105`; JWT minting/cookie delivery is at `107-130`. |
| A2 | It exposes Zero mutation and query endpoints. | **CONFIRMED** | Mutation endpoints/handler are at `apps/zbugs/api/index.ts:151-191`; query endpoints/handler are at `193-227`. |
| A3 | It provides authenticated S3-presigned image upload. | **CONFIRMED** | The authenticated API route is at `apps/zbugs/api/index.ts:229-249`; the S3 `PutObjectCommand` and one-hour signed URL are at `apps/zbugs/src/server/upload.ts:27-65`. |
| A4 | It has an unsubscribe endpoint. | **CONFIRMED** | `apps/zbugs/api/index.ts:251-296`. |
| A5 | It serves machine-readable Markdown issue routes. | **CONFIRMED** | The Markdown route and content type are at `apps/zbugs/server/machine-routes.ts:84-108,125-163`; deployment rewrites route Markdown requests to the API at `apps/zbugs/vercel.json:15-60,63-71`. |
| A6 | It sends email and Discord notifications. | **CONFIRMED** | The notification dispatcher schedules both at `apps/zbugs/server/notify.ts:104-140`; email uses the Loops API at `apps/zbugs/server/email.ts:27-78`; Discord uses a webhook at `apps/zbugs/server/discord.ts:1-38`. |
| A7 | The server data provider is PostgreSQL-backed and local setup enables logical WAL. | **CONFIRMED** | `apps/zbugs/server/db.ts:1-7`; `apps/zbugs/docker/docker-compose.yml:1-29`. Combined with the README's AWS deployment assertion at `apps/zbugs/README.md:3-5`, this supports LLP 0182's pinned production-source shape, but not a live operational-health claim. |
| A8 | Omitting these services would measure only a data widget rather than product quality. | **UNVERIFIABLE-FROM-PIN** | This is a benchmark interpretation, not a source fact. |

### Synthetic fixture and UI scale copy

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| F1 | The generator is deterministic. | **DISCREPANT** | It seeds its PRNG at `apps/zbugs/scripts/generate-synthetic.ts:28-40,42-80`, but anchors generated timestamp ranges to `new Date()` at `apps/zbugs/scripts/generate-synthetic.ts:592-598`. It is seeded/reproducible in counts and non-time choices, not fully deterministic across run dates. |
| F2 | The default profile has 1,000,000 issues. | **CONFIRMED** | Guide: `apps/zbugs/SYNTHETIC_DATA.md:42-51`; implementation: `apps/zbugs/scripts/generate-synthetic.ts:28-39,581-600`. |
| F3 | The default profile has roughly 3,000,000 comments. | **DISCREPANT** | The guide claims this at `apps/zbugs/SYNTHETIC_DATA.md:75-80`, but the implementation floors an exponential variate at `apps/zbugs/scripts/generate-synthetic.ts:120-125` and applies it once per issue at `669-690`. Replaying that count path for 1,000,000 issues at seed 42 yields **2,527,886 comments**, not roughly 3,000,000. |
| F4 | The default profile has roughly 1,500,000 `issueLabel` rows. | **DISCREPANT** | Although `LABELS_PER_ISSUE` defaults to 1.5 at `apps/zbugs/scripts/generate-synthetic.ts:33`, generation ignores it: it hard-codes a uniform 1-3 labels at `apps/zbugs/scripts/generate-synthetic.ts:716-765`. Every pinned template supplies at least 48 labels per project, so the three-label ceiling applies. Replaying the default seeded count path yields **2,000,370 issue-label rows**, not roughly 1,500,000. |
| F5 | The default is a roughly 4.5-million-row fixture. | **DISCREPANT** | Even the guide's advertised three large-table counts sum to 5.5M, despite its 4.5M total at `apps/zbugs/SYNTHETIC_DATA.md:75-80`. The executable default count path yields 1,000,000 issues + 2,527,886 comments + 2,000,370 issue labels = **5,528,256** large-table rows, or **5,533,266** rows including the generated users, projects, and labels. Generated table classes are listed at `apps/zbugs/SYNTHETIC_DATA.md:38-40`; generator summary accounting is at `apps/zbugs/scripts/generate-synthetic.ts:768-788`. |
| F6 | The UI says Zero syncs millions of rows to IndexedDB. | **CONFIRMED** | `apps/zbugs/src/root.tsx:97-108`. Gigabugs metadata separately says “2.5 Million Row Sync Demo” at `apps/zbugs/src/root.tsx:23-65`. |
| F7 | These facts prove a deliberate large-data demo/fixture, but do not prove universal browser custody or a latency target. | **CONFIRMED** | As a bounded interpretation, the pin clearly contains the generator guide and UI copy cited above; it contains no universal-custody or benchmark receipt. The negative limitation is appropriately cautious. |

### Other load-bearing source-dependent statements in the findings

| ID | LLP 0182 claim | Verdict | Pin evidence |
| --- | --- | --- | --- |
| L1 | Zerobugs search composes title/description/comment substring matching in the graph and can disable search per project. | **CONFIRMED** | Query predicates: `apps/zbugs/shared/queries.ts:442-449`; project flag: `apps/zbugs/shared/schema.ts:24-34`; UI gating: `apps/zbugs/src/pages/list/list-page.tsx:394-399,484`. |
| L2 | The source permits unauthenticated requests for public machine-readable issues. | **CONFIRMED** | Missing authorization produces undefined auth at `apps/zbugs/api/index.ts:300-323`; the machine route accepts that value at `apps/zbugs/server/machine-routes.ts:103-128`; the query applies public visibility for non-crew at `apps/zbugs/shared/queries.ts:15-20` and `apps/zbugs/server/machine-routes.ts:34-48`. |
| L3 | The live product actually answered an unauthenticated machine-readable route on 2026-08-05. | **UNVERIFIABLE-FROM-PIN** | Source support is confirmed by L2, but live behavior is external and was not fetched. |
| L4 | Public-project issue/label/comment/user data is the workload's “dominant base data.” | **UNVERIFIABLE-FROM-PIN** | The generator defaults 90% of issues to public at `apps/zbugs/scripts/generate-synthetic.ts:632-640`, and new shared-mutator issues default public at `apps/zbugs/shared/mutators.ts:78-88`, but the pin does not quantify the live production corpus. “Dominant” is an interpretation, not a proved live-data fact. |
| L5 | Client-chosen row ids are commonly preserved by server forms. | **CONFIRMED** | Issue, comment, and emoji creation generate ids in the client citations under M4; server overrides pass those same ids through in the citations under M6. Label create-plus-attach likewise generates `labelID` client-side at `apps/zbugs/src/pages/issue/issue-page.tsx:620-628`, and the shared write preserves it at `apps/zbugs/shared/mutators.ts:284-315`. |
| L6 | The linked issue 3385 is open, requests JSON values in `where`, says views are not synced, and documents a trigger/custom-mutator workaround. | **UNVERIFIABLE-FROM-PIN** | Issue 3385 and its machine-readable route are external and absent from the sparse checkout. No network fetch was made. |
| L7 | Zero hydrates whole rows into a normalized local relational store, reuses them across queries, and derives canonical changes through PostgreSQL logical replication/`zero-cache`. | **UNVERIFIABLE-FROM-PIN** | These are external Zero architecture/documentation claims. The sparse pin contains the Zerobugs PostgreSQL/logical-WAL configuration (`apps/zbugs/docker/docker-compose.yml:1-47`) but not enough implementation or documentation to prove the general Zero claims. |

## Snapback `[observed]` spot-checks

Per the task, these are shallow checks against only the named LLP headers and
summaries, not repository-implementation verification.

| Owner | Load-bearing LLP 0182 observation | Result | LLP evidence |
| --- | --- | --- | --- |
| LLP 0166 | The current local store is query-scoped/plan-identity materialization with completeness-honest answers and a closed result-transform boundary, not a normalized cross-query row database. | **AGREES** | LLP 0166 is Implemented and owns local sync/storage (`llp/0166-local-persistent-store.spec.md:1-6`). Its summary says registered queries define the replica, retention is keyed by plan identity, answers require completeness proof, and evaluation uses a closed transform contract (`llp/0166-local-persistent-store.spec.md:273-310`). The header further describes own-fragments-only result transforms (`llp/0166-local-persistent-store.spec.md:31-38`). |
| LLP 0129 | Generated mutation IR and typed local-write work materially narrowed the historical write gap, while browser-write admission remains governed and bounded. | **AGREES** | At header/summary level, LLP 0129 is Accepted and owns sync/runtime/client/auth (`llp/0129-local-first-program.plan.md:1-7`). Its header records a shipped IR evaluator and a 12/13 IR-expressible durable-mutation corpus (`llp/0129-local-first-program.plan.md:23-30`); its summary keeps claims scaled to acceptance evidence (`llp/0129-local-first-program.plan.md:392-398`). The exact `Insert/Get/Guard/Patch` verb ceiling was not deeply reverified in this spot-check. |
| LLP 0135 | Snapshot batches are bounded static composition, not arbitrary relational/search/aggregate/data-dependent nodes. | **AGREES** | LLP 0135 is Accepted (`llp/0135-sequence-allocation-and-snapshot-batch.spec.md:1-7`); the header records 2-8 bounded-child nodes at one snapshot (`llp/0135-sequence-allocation-and-snapshot-batch.spec.md:20-28`), and the summary calls the composition a static tuple of already-admitted bounded-profile invocations and explicitly excludes aggregates (`llp/0135-sequence-allocation-and-snapshot-batch.spec.md:194-209`). |
| LLP 0080 | The stable relational profile is a narrow bounded two-source equi-join/projection profile and excludes many-to-many fan-out and aggregates. | **AGREES** | LLP 0080 is Implemented (`llp/0080-portable-relational-queries-and-projections.rfc.md:1-7`); its summary states exactly that boundary and exclusions (`llp/0080-portable-relational-queries-and-projections.rfc.md:92-106`). |

No requested Snapback summary/header spot-check disagreed with LLP 0182.

## Acceptance recommendation

**Do not mark LLP 0182 Active as-is.** Its central workload inventory is
substantially sound, but four factual corrections and two claim-label
clarifications are required before acceptance. The synthetic-fixture errors are
load-bearing because LLP 0183 Stage 0 freezes this fixture for later scale and
custody comparisons.

### Required factual revisions

1. Project visibility is assigned to the wrong table.

   Wrong:

   > `| project | issue namespace, visibility, and search capability |`

   Corrected:

   > `| project | issue namespace and search capability |`

   The existing `issue` row already correctly names visibility.

2. The generator is not fully deterministic and its advertised counts do not
   match the executable default.

   Wrong:

   > The source includes a deterministic synthetic-data generator whose default profile is one million issues, roughly three million comments, and roughly 1.5 million issue-label rows.

   Corrected:

   > The source includes a seeded synthetic-data generator whose default count logic at seed 42 produces 1,000,000 issues, 2,527,886 comments, and 2,000,370 issue-label rows. It is not fully deterministic across run dates because generated timestamp ranges are anchored to the generation date.

3. The derived total is not 4.5 million rows.

   Wrong:

   > The relevant Snapback comparison is therefore not "can SQLite store 4.5 million rows?"

   Corrected:

   > The relevant Snapback comparison is therefore not "can SQLite store roughly 5.53 million generated rows?"

4. Timestamp replacement is narrower than “the pinned server mutators.”

   Wrong:

   > Zerobugs commonly chooses row ids in the client mutator and preserves those ids in the server form, while the pinned server mutators replace client timestamps with `Date.now()`.

   Corrected:

   > Zerobugs commonly chooses row ids in the client mutator and preserves those ids in the server form. Server overrides replace client timestamps with `Date.now()` for issue create/update, emoji add, and comment add, while view-state and notification timestamps remain client-supplied.

### Required label clarifications

The following conclusions are reasonable research interpretations, but the pin
cannot make them `[source]` facts. Mark them explicitly as interpretations (or
move the `[source]` citation before them):

5. Wrong:

   > The table count is not difficult for Snapback. The graph operations performed on those tables are the meaningful workload.

   Corrected:

   > [interpretation] The table count is not difficult for Snapback. The graph operations performed on those tables are the meaningful workload.

6. Wrong:

   > This is not an exotic analytics workload. It is the ordinary shape of one polished collaborative application screen.

   Corrected:

   > [interpretation] This is not an exotic analytics workload. It is the ordinary shape of one polished collaborative application screen.

After those six revisions, this pin-only audit recommends marking LLP 0182
**Active**, with its external Zero-documentation, live-site, and issue-3385
claims remaining explicitly outside what this artifact verifies.
