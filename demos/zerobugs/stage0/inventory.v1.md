# Zerobugs pinned-workload demand inventory v1

This is the human-readable companion to [`inventory.v1.json`](./inventory.v1.json), which is canonical. The source is `rocicorp/mono` at commit `25c2c7308d3eb674d2d895022c9da11ef0c742fb`, inspected on 2026-08-05. Source paths below are relative to `apps/zbugs/` in that pin.

Coverage totals: 10 tables, 22 declared relationships, 19 named queries, no inline `useQuery` graphs, 16 mutators, 9 HTTP endpoints, and 8 post-commit notification triggers.

## Notable findings

1. The pinned generator's default output is not the roughly 4.5 million rows stated in `SYNTHETIC_DATA.md` and repeated in LLP 0182. Direct evaluation of the pinned deterministic control flow gives 5,533,266 rows: 100 users, 100 projects, 4,810 labels, 1,000,000 issues, 2,527,886 comments, and 2,000,370 issue-label rows. `COMMENTS_PER_ISSUE=3.0` feeds a floored exponential distribution whose deterministic mean is 2.527886. `LABELS_PER_ISSUE=1.5` is never used to select rows; the implementation chooses 1–3 labels uniformly, with mean 2.00037. (`scripts/generate-synthetic.ts`, `SYNTHETIC_DATA.md`)
2. The large generator populates only six of ten tables. It does not generate `viewState`, `emoji`, `userPref`, or `issueNotifications`, so it is not by itself a large private-overlay, reaction, or notification fixture. The ordinary GitHub seed also contains no internal issue, so it cannot exercise negative role visibility. (`scripts/generate-synthetic.ts`, `scripts/seed.ts`, `db/seed-data/github/issue.csv`)
3. `commentsPage`, `comment`, and `emojiChange` do not traverse through a permission-gated parent issue. As implemented, a caller who knows an internal issue/comment/subject id can query child facts independently of `applyIssuePermissions`. The machine Markdown route avoids this by permission-checking the issue before its separate comment query. (`shared/queries.ts`, `shared/auth.ts`, `server/machine-routes.ts`)
4. `issue.notificationState` is declared `one` on `issue.id → issueNotifications.issueID`, but `issueID` is not unique. It becomes at most one only after `issueDetail` applies `userID = JWT sub`. (`shared/schema.ts`, `shared/queries.ts`, `db/drizzle-schema.ts`)
5. Logical and physical schema details diverge in several places. `userPref` has logical key order `(userID,key)` but PostgreSQL key order `(key,userID)`; `user.githubID` is published but omitted from the Zero schema; `user.email` is server-only; and multiple columns required by the Zero schema remain nullable physically. (`shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql`)
6. Query visibility and mutation visibility differ for an ordinary creator of an internal issue. Mutations allow the creator to see/comment/react through `assertUserCanSeeIssue`, while issue queries allow internal rows only to `crew`. (`shared/auth.ts`, `shared/queries.ts`)
7. Client ids are normally preserved by server mutators, but issue/comment/emoji timestamps have three layers: client `Date.now()`, server replacement with `Date.now()`, then PostgreSQL trigger replacement with database time. By contrast, notification `created` and view-state `viewed` have no server replacement. (`shared/mutators.ts`, `server/server-mutators.ts`, `db/migrations/0000_init.sql`)
8. Notification delivery is post-commit but not durable. Closures are held in memory, run with `Promise.allSettled`, and failures do not fail the committed mutation or create a retry receipt. Email is idempotency-keyed; Discord is neither durable nor idempotency-keyed. (`api/index.ts`, `server/notify.ts`, `server/email.ts`, `server/discord.ts`)
9. Unsubscribe is a state-changing `GET` authenticated only by a cleartext email plus issue short id; it has no signed token, JWT requirement, or visibility check. (`api/index.ts`, `server/notify.ts`)
10. Upload size is enforced only in the browser. The presign request carries MIME but not size; no bucket/CORS policy is pinned; the client does not test S3 PUT `response.ok`; there is no asset metadata/lifecycle record; and the upload module logs the access-key id plus the first ten secret-key characters. (`src/components/image-upload-area.tsx`, `src/server/upload.ts`)
11. The physical indexes cover the modified-order list variants well, but created-order list windows do not have project/filter/created/id composites, and comment windows order by `(issueID,created,id)` while the physical comment index is only `(issueID)`. (`db/drizzle-schema.ts`, `shared/queries.ts`)
12. `db/seed-data/templates/summary.json` is stale: it records only three categories and 30 projects, while the generator reads ten category files containing ten projects each and ignores the summary. (`db/seed-data/templates/summary.json`, `scripts/generate-synthetic.ts`)

## Schema demand

`S` means the Zero shared schema; `P` means PostgreSQL. “Optional” records source nullability, not whether the application expects the value.

| Table | Primary key | Columns and exact types | Physical indexes / ordering demand | Source |
| --- | --- | --- | --- | --- |
| `user` | S/P `(id)` | `id` S string/P varchar non-null; `login` string/varchar non-null; `name` optional/varchar nullable; `avatar` S required/P nullable; `role` enum `crew\|user`/varchar non-null default `user`; `githubID` P-only integer non-null; `email` P-only nullable varchar | unique `githubID`; unique `login`; login serves creator/assignee filters | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql` |
| `project` | `(id)` | `id`, `name`, `lowerCaseName` strings/varchars non-null; `issueCountEstimate` optional/integer nullable; `supportsSearch` S required/P nullable default true; `markURL`, `logoURL` optional/varchar nullable | unique `lowerCaseName`; trigger derives it from `lower(name)` | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0002_project_lower_case_name.sql`, `db/migrations/0005_project_config_options.sql` |
| `issue` | `(id)` | `id` string/varchar; `shortID` optional number/P identity integer start 3000; `title` string/varchar(128); `open` boolean; `modified`, `created` required numbers/P nullable doubles with defaults and replacing triggers; `projectID`, `creatorID` strings/non-null varchars; `assigneeID` optional/nullable; `description` S required/P nullable varchar(10240) default empty; `visibility` enum `internal\|public`/varchar default public | unique `(id,projectID)`; `shortID`; `created`; six `(projectID,[open],[assigneeID|creatorID],modified,id)` variants; `(creatorID,id)`; `(assigneeID,id)` | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql`, `db/migrations/0003_index_rework_for_gigagbugs.sql`, `db/migrations/0004_status_all_index_changes_for_gigabugs.sql` |
| `viewState` | `(userID,issueID)` | `issueID`, `userID` strings/non-null varchars; `viewed` S required number/P nullable double | PK is the per-principal issue lookup | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `comment` | `(id)` | `id` string/varchar; `issueID` S required/P nullable; `created` S required/P nullable double replaced on insert; `body` string/text non-null; `creatorID` S required/P nullable | only `(issueID)`; application requires stable `(issueID,created,id)` windows | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql` |
| `label` | `(id)` | `id`, `name`, `projectID` strings/non-null varchars | unique `(id,projectID)` and `(projectID,name)` | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0007_red_omega_sentinel.sql` |
| `issueLabel` | `(labelID,issueID)` | `labelID`, `issueID`, `projectID` strings/non-null varchars | PK plus `(issueID)`; composite FKs enforce issue/label project equality | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `emoji` | `(id)` | `id`, `value`, `subjectID` required strings/non-null varchars; `annotation`, `creatorID`, `created` required in S but nullable in P; `created` has default/replacing trigger | `(created)`, `(subjectID)`, unique `(value,subjectID,creatorID)` | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql` |
| `userPref` | S `(userID,key)`; P `(key,userID)` | `key`, `userID`, `value` strings/non-null varchars | physical key order begins with preference key | `shared/schema.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql` |
| `issueNotifications` | `(userID,issueID)` | `userID`, `issueID` strings/non-null; `subscribed` S required/P nullable boolean default true; `created` S required/P nullable double default database time | composite PK | `shared/schema.ts`, `db/drizzle-schema.ts` |

Physical rules also matter to the demanded mutation semantics. Issue insert/update replaces `modified`; issue insert replaces `created`; comment insert replaces `created` and updates its issue's `modified`; comment body is capped at 64 KiB except issue `duuW9Nyj5cTNLlimp9Qje` at 1024; emoji insert replaces `created`, validates a polymorphic subject, and attempts to update the containing issue; issue/comment deletes clean polymorphic emoji by trigger. (`db/migrations/0000_init.sql`)

### Relationships

| Relationship | Kind and join | Source |
| --- | --- | --- |
| `user.createdIssues` | to-many `user.id = issue.creatorID` | `shared/schema.ts` |
| `user.assignedIssues` | to-many `user.id = issue.assigneeID` | `shared/schema.ts` |
| `project.issues` | to-many `project.id = issue.projectID` | `shared/schema.ts` |
| `project.labels` | to-many `project.id = label.projectID` | `shared/schema.ts` |
| `issue.project` | to-one `projectID = project.id` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issue.issueLabels` | to-many `id = issueLabel.issueID` | `shared/schema.ts` |
| `issue.labels` | many-to-many through `issueLabel`, `id → issueID`, `labelID → label.id` | `shared/schema.ts` |
| `issue.comments` | to-many `id = comment.issueID`, physical cascade | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issue.creator` | to-one `creatorID = user.id` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issue.assignee` | optional to-one `assigneeID = user.id` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issue.viewState` | to-many `id = viewState.issueID`, narrowed per query by `userID = JWT sub` | `shared/schema.ts`, `shared/queries.ts` |
| `issue.emoji` | polymorphic to-many `id = emoji.subjectID` | `shared/schema.ts`, `db/migrations/0000_init.sql` |
| `issue.notificationState` | declared to-one `id = issueNotifications.issueID`, made per-user by query predicate; physically non-unique without it | `shared/schema.ts`, `shared/queries.ts` |
| `comment.creator` | to-one `creatorID = user.id` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `comment.emoji` | polymorphic to-many `id = emoji.subjectID` | `shared/schema.ts`, `db/migrations/0000_init.sql` |
| `comment.issue` | to-one `issueID = issue.id`, physical cascade | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issueLabel.issue` | to-one, physical `(issueID,projectID) → issue(id,projectID)` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `issueLabel.label` | to-one, physical `(labelID,projectID) → label(id,projectID)` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `label.project` | to-one `projectID = project.id` | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `emoji.creator` | optional to-one `creatorID = user.id`, creator delete cascades | `shared/schema.ts`, `db/drizzle-schema.ts` |
| `emoji.issue` | polymorphic to-one `subjectID = issue.id`, trigger integrity | `shared/schema.ts`, `db/migrations/0000_init.sql` |
| `emoji.comment` | polymorphic to-one `subjectID = comment.id`, trigger integrity | `shared/schema.ts`, `db/migrations/0000_init.sql` |

The `zero_zbugs` publication contains all ten tables. Its `user` column list includes `githubID` but excludes `email`; the Zero schema exposes neither. (`db/migrations/0000_init.sql`, `db/migrations/0001_add_project.sql`, `shared/schema.ts`)

## Graph demand (D2)

The D2 labels below are proposed-profile classifications, not capability admission. “Outside” includes an absent root/child bound, raw search that must become D6 membership, a missing explicit tie-breaker, or arguments with no declared ceiling.

| Query | Root, args, filters | Relationship projection | Order/window | D2 classification | Source |
| --- | --- | --- | --- | --- | --- |
| `allLabels` | `label`; `undefined`; no filter | none; all label fields | no declared order or limit | closed projection; **outside: unbounded root** | `shared/queries.ts`, `src/zero-preload.ts` |
| `allUsers` | `user`; `undefined`; no filter | none; all exposed user fields | no declared order or limit | closed projection; **outside: unbounded root** | `shared/queries.ts`, `src/zero-preload.ts` |
| `allProjects` | `project`; `undefined`; no filter | none; all project fields | no declared order or limit | closed projection; **outside: unbounded root** | `shared/queries.ts`, `src/zero-preload.ts` |
| `user` | `user`; string id; `id = arg` | none | `.one()` | bounded root, closed projection | `shared/queries.ts`, `src/components/nav.tsx` |
| `crewUser` | `user`; string id; `id = arg AND role = crew` | none | `.one()` | bounded root, closed projection | `shared/queries.ts`, `src/hooks/use-can-edit.ts` |
| `labels` | `label`; `{projectName}`; scalar exists `project.lowerCaseName = lower(arg)` | project existence only | no order or limit | exists, closed projection; **outside: unbounded root** | `shared/queries.ts`, `src/components/filter.tsx` |
| `labelsOrderByName` | `label`; `{projectName,orderBy}`; same project exists | project existence only | `name` arg direction, no explicit id; unbounded | exists, closed projection; **outside: unbounded root and no explicit tie-breaker** | `shared/queries.ts`, `src/components/label-picker.tsx` |
| `issuePreloadV2` | `issue`; `{projectName}`; project exists; crew or public; principal view-state predicate | labels unbounded; view-state 0..1 array; creator; assignee; issue emoji.creator unbounded; 10 newest comments with creator and unbounded emoji.creator | root `modified desc,id desc`, limit 1000; comments `created desc` without id | bounded root, to-one, bounded comments, exists, principal relation, closed projection; **outside: unbounded label/emoji children and child tie-breaker** | `shared/queries.ts`, `src/zero-preload.ts` |
| `userPref` | `userPref`; key string; `key = arg AND userID = JWT sub` | none | `.one()` by composite equality | bounded, principal-bound root analogue, closed | `shared/queries.ts`, `src/hooks/use-user-pref.ts` |
| `usersForProject` | `user`; `{disabled,login?,projectName,filter?}`; branches: login equality; crew and not `rocibot%`; nested creator/assignee issue→project exists; or none | existence only | no order or limit | exists, closed; **outside: unbounded root and LIKE/NOT callback node** | `shared/queries.ts`, `src/components/user-picker.tsx` |
| `commentsPage` | `comment`; `{issueID,limit,start,dir,inclusive}`; issue equality plus keyset start | creator; unbounded emoji.creator | `(created,id)` asc forward/desc backward; arg limit; bidirectional cursor | bounded only for admitted positive limit, to-one, closed; **outside: unbounded emoji, unbounded numeric argument, no parent visibility** | `shared/queries.ts`, `src/pages/issue/comments.tsx` |
| `comment` | `comment`; id string; id equality | creator; unbounded emoji.creator | `.one()`; permalink target | bounded/to-one/closed; **outside: unbounded emoji and no parent visibility** | `shared/queries.ts`, `src/pages/issue/comments.tsx` |
| `issueDetail` | `issue`; `{idField,id}`; dynamic id equality; crew/public; principal notification and view-state predicates | project, creator, assignee; unbounded labels and issue emoji.creator; private notification/view state; 50 newest comments ordered `(created,id) desc` with unbounded emoji.creator | one root; bounded 50-comment preload | bounded root/to-one/bounded comments/principal/closed; **outside: unbounded labels and emoji** | `shared/queries.ts`, `src/pages/issue/issue-page.tsx` |
| `issueListV2` | `issue`; full list context plus nullable limit/start/dir/inclusive; project exists; optional open; title/description/comment ILIKE; repeated all-label exists; creator/assignee exists; crew/public; private view-state | private view-state `.one()` and unbounded labels; other relations are existence-only | selected `modified|created` plus id; direction inverted backward; keyset; truthy limit | intended D2 core: root window, exists/all-label, principal, search-membership candidate, closed; **outside: raw ILIKE/child search, unbounded labels, null/0 removes limit, no arg ceilings** | `shared/queries.ts`, `src/pages/list/list-page.tsx` |
| `listIssueByID` | `issue`; list context plus dynamic id equality; inherits list filters | same view-state and labels as list | list order plus id; `.one()` to locate permalink sort tuple | bounded/exists/principal/closed; **outside: inherited raw search and unbounded labels** | `shared/queries.ts`, `src/pages/list/list-page.tsx` |
| `emojiChange` | `emoji`; subject id string; subject equality | creator `.one()` | no order or limit | to-one/closed; **outside: unbounded root and no parent visibility** | `shared/queries.ts`, `src/pages/issue/issue-page.tsx` |
| `prevNext` | **deprecated** `issue`; `{listContext|null,issue|null,dir}`; list filters or always-false; keyset start | view-state and labels | list order/id; one next/previous | bounded/exists/principal/closed; **outside: inherited raw search and unbounded labels** | `shared/queries.ts`, `src/pages/issue/issue-page.tsx` |
| `issueList` | **deprecated** `issue`; `{listContext,limit}`; list filters | view-state and labels | forward prefix in list order; truthy numeric limit | intended bounded/exists/principal/closed; **outside: raw search, unbounded labels, 0/no ceiling** | `shared/queries.ts` |
| `userPicker` | **deprecated** `user`; `{disabled,login|null,filter|null}`; login, crew/not-bot, any created issue exists, or none | created-issue existence only | no order or limit | exists/closed; **outside: unbounded root and LIKE/NOT callback** | `shared/queries.ts` |

There are no inline `useQuery` graphs: all React consumers call one of these named definitions. (`src/pages/**`, `src/hooks/**`, `src/components/**`)

The list virtualizer supplies positive dynamic pages, forward/backward demand, a single-row permalink lookup, scroll-state persistence, spacers, completeness, and not-found state. Its cursor row includes `id`, `created`, and `modified`. The comment virtualizer uses `(created,id)`, minimum page size 20, a single-comment permalink lookup, and a separate backward one-row newest-comment watcher. (`src/pages/list/list-page.tsx`, `src/pages/issue/comments.tsx`)

## Fact and custody demand (D3)

| Query | Public / authority-independent facts | Per-principal private overlay | Protected facts and projection width | Source |
| --- | --- | --- | --- | --- |
| `allLabels` | all label rows | none | label base | `shared/queries.ts` |
| `allUsers` | all exposed user rows, including role | none | user base | `shared/queries.ts` |
| `allProjects` | all project/config rows | none | project base | `shared/queries.ts` |
| `user` | caller-selected user | none; not bound to JWT sub | user base | `shared/queries.ts` |
| `crewUser` | caller-selected user iff crew | none; not bound to JWT sub | public crew-membership observation | `shared/queries.ts` |
| `labels` | project label membership and rows | none | label base | `shared/queries.ts` |
| `labelsOrderByName` | same, ordered | none | label base | `shared/queries.ts` |
| `issuePreloadV2` | public issue + labels/users/emoji/10 comments | viewState array for JWT sub | same wide graph for internal issues only for crew; `issue-preload-wide` | `shared/queries.ts` |
| `userPref` | none | exact `(JWT sub,key)` row | private exact projection | `shared/queries.ts` |
| `usersForProject` | user rows and relation-existence membership | none | no auth gate | `shared/queries.ts` |
| `commentsPage` | any requested issue's comments as implemented | none | domain-protected comments lack parent visibility proof; `comment-rich` | `shared/queries.ts`, `shared/auth.ts` |
| `comment` | any selected comment as implemented | none | same visibility risk; `comment-rich` | `shared/queries.ts`, `shared/auth.ts` |
| `issueDetail` | public issue plus full detail relations | notificationState and viewState for JWT sub | internal detail only for crew; `issue-detail-widest` | `shared/queries.ts` |
| `issueListV2` | public issue membership/order, labels | viewState for JWT sub | internal membership/order only for crew; `issue-list-narrow-relations` | `shared/queries.ts` |
| `listIssueByID` | one public issue under current list predicate | viewState for JWT sub | internal list target for crew; list width | `shared/queries.ts` |
| `emojiChange` | any requested subject's emoji as implemented | none | domain-protected reactions lack parent proof; `emoji-rich` | `shared/queries.ts`, `shared/auth.ts` |
| `prevNext` | public adjacent list membership | viewState for JWT sub | internal adjacency for crew; list width | `shared/queries.ts` |
| `issueList` | public list membership | viewState for JWT sub | internal list for crew; list width | `shared/queries.ts` |
| `userPicker` | user rows and creator existence | none | no auth gate | `shared/queries.ts` |

All issue query variants select every base issue column. “Narrow” versus “wide” is therefore nested graph width: list adds labels and one private view state; preload adds people, reactions, and ten comments; detail adds project, notification state, and fifty comments; the machine route omits private state and separately fetches up to 1000 comments. Comment, user, project, label, and emoji base rows likewise are not field-projected; widths differ through relationships. (`shared/schema.ts`, `shared/queries.ts`, `server/machine-routes.ts`)

D3 staging demand is consequently: class 1 public exact facts; class 2 compatible public issue facts across list/preload/detail; class 3 exact `viewState`/`userPref`/`issueNotifications` inside a principal partition; class 4 internal/projection-subsuming reuse with full membership, existence, order, search, and retirement proofs. (`shared/queries.ts`)

## Mutation demand (D5)

The classifications are **PRELIMINARY — LLP 0129 owns admission**. The comparison ceiling is current generated `Insert/Get/Guard/Patch`. Counts: two current-IR, three explicit-value/Lane-Q, zero wholly server-only, eleven needing a new verb for the full atomic program.

| Mutator | Exact reads, guards, branches, and writes | Id/time and server difference | Preliminary class | Source |
| --- | --- | --- | --- | --- |
| `issue.create` | login; insert public/open issue; re-read issue+creator for visibility; read notification; conditionally upsert creator subscription | UI nanoid + two Date.now; server keeps id, replaces times; DB replaces times again; post-commit create notification | **new verb**: notification Upsert/Branch | `shared/mutators.ts`, `server/server-mutators.ts`, `src/pages/issue/issue-composer.tsx`, `db/migrations/0000_init.sql` |
| `issue.update` | creator/crew guard; read old issue; patch optional fields; branch on assignee presence/change; visibility/user/notification reads; upsert new and/or previous assignee subscription | client modified replaced by server then DB; post-commit update notification | **new verb**: bounded Branch + Upsert | `shared/mutators.ts`, `server/server-mutators.ts`, `src/pages/issue/issue-page.tsx` |
| `issue.delete` | creator/crew guard; delete issue; physical cascades comments/join/private rows and trigger-cleans emoji | existing id; no effect notification | **new verb**: Delete/dependent delete | `shared/mutators.ts`, `db/drizzle-schema.ts`, `db/migrations/0000_init.sql` |
| `issue.addLabel` | creator/crew guard; default project; insert join row; composite FKs guard project consistency | existing ids; server adds post-commit “updated issue” notification with no label detail | **current IR** Get/Guard/Insert | `shared/mutators.ts`, `server/server-mutators.ts` |
| `issue.removeLabel` | creator/crew guard; delete composite join row | existing ids; same generic update notification | **new verb**: Delete | `shared/mutators.ts`, `server/server-mutators.ts` |
| `notification.update` | login; read issue+user and visibility guard; read current notification; forced subscribe or unsubscribe upsert | client Date.now `created` is not server-replaced | **new verb**: Upsert/Branch | `shared/mutators.ts`, `src/pages/issue/issue-page.tsx` |
| `emoji.addToIssue` | login; issue+user visibility; insert emoji; read notification; conditionally subscribe actor | client nanoid/time; server replaces time; DB replaces again and updates issue; post-commit reaction notification | **new verb**: Upsert/Branch beyond base Insert | `shared/mutators.ts`, `server/server-mutators.ts`, `src/components/emoji-panel.tsx`, `db/migrations/0000_init.sql` |
| `emoji.addToComment` | login; read comment then issue+user; visibility guard; insert emoji | client nanoid/time; server replaces time; DB replaces again; server re-reads comment and notifies | **explicit value or Lane Q** Get/Guard/Insert | `shared/mutators.ts`, `server/server-mutators.ts`, `src/components/emoji-panel.tsx` |
| `emoji.remove` | creator/crew guard; delete emoji | no notification; delete does not update issue.modified | **new verb**: Delete | `shared/mutators.ts`, `db/migrations/0000_init.sql` |
| `comment.add` | login; issue+user visibility; insert comment; read notification; conditionally subscribe actor | client nanoid/time; server then DB replace time; DB updates issue; post-commit comment notification | **new verb**: Upsert/Branch beyond base Insert | `shared/mutators.ts`, `server/server-mutators.ts`, `src/pages/issue/comment-composer.tsx` |
| `comment.edit` | creator/crew guard; patch body; DB length guard | existing id; server re-reads comment and notifies; no issue.modified update | **current IR** Get/Guard/Patch | `shared/mutators.ts`, `server/server-mutators.ts`, `db/migrations/0000_init.sql` |
| `comment.remove` | creator/crew guard; delete comment; trigger deletes its emoji | existing id; no notification or issue.modified update | **new verb**: Delete/dependent cleanup | `shared/mutators.ts`, `src/pages/issue/comment.tsx`, `db/migrations/0000_init.sql` |
| `label.create` | login+crew guard; default project; insert label | caller-supplied id; no pinned UI call site; no server override/effect | **explicit value or Lane Q** Guard/Insert | `shared/mutators.ts` |
| `label.createAndAddToIssue` | login+crew guard; default project; atomically insert label and issueLabel; composite FK | UI nanoid label id; no server override/effect | **explicit value or Lane Q** bounded two-Insert | `shared/mutators.ts`, `src/pages/issue/issue-page.tsx` |
| `viewState.set` | login; derive user id; upsert `(userID,issueID)` | client Date.now `viewed`, no server replacement | **new verb**: Upsert | `shared/mutators.ts`, `src/pages/issue/issue-page.tsx` |
| `userPref.set` | login; derive user id; upsert `(key,userID)` | no generated values or server override | **new verb**: Upsert | `shared/mutators.ts`, `src/hooks/use-user-pref.ts` |

The server overrides exactly `issue.create`, `issue.update`, `issue.addLabel`, `issue.removeLabel`, `emoji.addToIssue`, `emoji.addToComment`, `comment.add`, and `comment.edit`. All other mutators reuse the shared definition authoritatively. (`server/server-mutators.ts`)

## Route demand (D7)

| Method/path | Input and output | Auth | Source |
| --- | --- | --- | --- |
| `GET /api/login/github` | optional `redirect`; OAuth plugin redirects to GitHub | anonymous start | `api/index.ts`, `src/routes.tsx` |
| `GET /api/login/github/callback` | plugin `code/state`, optional redirect; GitHub user upsert, JWT cookie, redirect | GitHub code, no prior app JWT | `api/index.ts` |
| `POST /api/push` | query-string record + Zero JSON mutation envelope; protocol response after effects settle | bearer optional at route, mutators enforce | `api/index.ts` |
| `POST /api/mutate` | same as `/push` | same | `api/index.ts`, `src/zero-init.tsx` |
| `POST /api/get-queries` | query-string record + Zero JSON query envelope; query response | anonymous or bearer | `api/index.ts` |
| `POST /api/query` | same as `/get-queries` | anonymous or bearer; invalid bearer 401 | `api/index.ts`, `src/zero-init.tsx` |
| `POST /api/upload/presigned-url` | `{contentType}` → `{url,key}`; 401/500 errors | valid logged-in bearer | `api/index.ts`, `src/server/upload.ts` |
| `GET /api/unsubscribe` | `id=shortID&email=...`; upsert false; HTML or 400/401/404 | email+shortID only; no JWT/signature | `api/index.ts` |
| `GET /p/:projectName/issue/:id.md` | safe numeric short id or string id; Markdown, 308 canonical redirect, 401/404 Markdown; max 1000 recent comments | anonymous public; crew internal; authenticated responses no-store | `server/machine-routes.ts`, `server/machine-md.ts`, `shared/issue-id.ts` |

Vite forwards `/api*` and `/p/*.md` to Fastify. Vercel rewrites those paths to the one API function and redirects Markdown Accept/crawler requests from human issue paths. (`vite.config.ts`, `vercel.json`)

## Auth demand

The actors are anonymous, ordinary logged-in user, issue creator, assignee, and global `crew`/admin. There is no project-member role. Projects themselves are public records; issue `visibility` carries public/internal policy. Crew sees internal issue query graphs and has the admin fast path. Ordinary creators own their issues/comments/emoji for mutation purposes; assignee status grants no edit authority. (`shared/auth.ts`, `shared/schema.ts`, `shared/queries.ts`, `shared/mutators.ts`)

JWT claims are `sub`, `role: crew|user`, `name`, `iat`, and `exp`. GitHub OAuth uses `githubID` identity, refreshes email, loads the database role, signs a 30-day JWT, and places it in a SameSite=Strict cookie (Secure except localhost). The cookie is intentionally client-readable and the SPA sends it as Bearer to Zero query/mutation endpoints. (`shared/auth.ts`, `api/index.ts`, `src/jwt.ts`, `src/zero-init.tsx`)

Logout only removes the client cookie and changes provider state; there is no server logout/revocation endpoint. A token/user change rebuilds ZeroProvider options with the new user id, bearer, and query context, while application code does not implement its own wipe. (`src/components/login-provider.tsx`, `src/zero-init.tsx`)

Permission inventory: issue query visibility is crew-or-public; issue/comment/emoji ownership is creator-or-crew; comment/reaction/subscription creation requires public issue, issue creator, or crew; labels require crew; private overlay user ids always derive from JWT sub; machine comments run only after the parent issue gate; internal notification email recipients are crew only; Discord is public only. (`shared/auth.ts`, `shared/queries.ts`, `shared/mutators.ts`, `server/machine-routes.ts`, `server/notify.ts`)

## Effect demand

`notify` reads and formats within the authoritative transaction, then appends in-memory closures. After commit, the API awaits all closures with `Promise.allSettled` and ignores failures. (`server/notify.ts`, `server/server-mutators.ts`, `api/index.ts`)

| Trigger | Payload | Delivery rule | Source |
| --- | --- | --- | --- |
| `issue.create` | actor reported; issue title + clipped description; issue link | actor included; subscribed email; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `issue.update` | actor updated; supplied status/assignee/visibility/title/description changes + description | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `issue.addLabel` | generic updated title + description; no label line | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `issue.removeLabel` | same generic update | same | `server/server-mutators.ts`, `server/notify.ts` |
| `emoji.addToIssue` | actor reacted; issue title + emoji | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `emoji.addToComment` | actor reacted; clipped comment + emoji; issue link | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `comment.add` | actor commented; issue title + clipped body; comment fragment | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |
| `comment.edit` | actor edited; issue title + clipped new body; comment fragment | actor excluded; subscribers; public Discord | `server/server-mutators.ts`, `server/notify.ts` |

Recipients are distinct valid emails on `subscribed=true` rows; internal issues filter recipients to crew. Loops receives a transactional request with audience addition, mail-thread headers, short-id subject, message/link/unsubscribe, attachments, and `Idempotency-Key: clientID:mutationID:email`. Discord receives `{content:"**title**\nmessage\n<link>"}` and logs/skips failures. (`server/notify.ts`, `server/email.ts`, `server/discord.ts`)

No external effect fires for issue/comment/emoji delete, explicit notification preference, label creation, view state, or user preference. (`server/server-mutators.ts`, `shared/mutators.ts`)

## Asset demand

The browser accepts JPEG, PNG, GIF, WebP, and SVG and limits files to 10 MiB. A logged-in client requests a presigned URL, the server mints a nanoid key and one-hour signed `PutObject` for `zbugs-image-uploads`, the browser PUTs the file, then inserts `![filename](https://zbugs-image-uploads.s3.amazonaws.com/<key>)` into issue/comment Markdown. (`shared/consts.ts`, `src/components/image-upload-area.tsx`, `src/server/upload.ts`)

The deployment therefore demands S3 presign credentials, browser PUT CORS, and anonymous GET delivery at that URL. No CORS or public bucket policy is pinned. The key is not bound to principal/project/issue; there is no asset metadata, delete, ownership, processing, checksum, or orphan cleanup. Server-side presign validates MIME only, not size. (`src/server/upload.ts`, `src/components/image-upload-area.tsx`)

## Fixture and target demand (D8)

### Fixtures

The ordinary CSV seed has 14 users (7 crew/7 user), 516 public issues (155 open/361 closed), 924 comments, 30 labels, and 603 issue-label rows. `project.csv` has no data row; migration 0001 supplies the one Zero project. It has no private overlay or emoji rows. (`db/seed-data/github/*.csv`, `db/migrations/0001_add_project.sql`, `scripts/seed.ts`)

The generator knobs are `NUM_ISSUES=1000000`, `NUM_PROJECTS=100`, `NUM_USERS=100`, `COMMENTS_PER_ISSUE=3.0`, `LABELS_PER_ISSUE=1.5` (ineffective), `SHARD_SIZE=500000`, `OUTPUT_DIR=db/seed-data/synthetic/`, `SEED=42`, and `SKIP_USERS=false`. It uses seeded xoshiro128** plus Faker, skewed project allocation, floored-exponential comment counts, 70% open, 70% assigned, 90% public, and uniform 1–3 labels. (`scripts/generate-synthetic.ts`, `SYNTHETIC_DATA.md`)

Template generation requires `ANTHROPIC_API_KEY`, defaults to 100 projects and start category 1, uses `claude-sonnet-4-20250514`, and performs eight calls per category. (`scripts/generate-templates.ts`, `SYNTHETIC_DATA.md`)

The seeder loads `user → project → issue → comment → label → issueLabel`, with `ZERO_UPSTREAM_DB`, `ZERO_SEED_DATA_DIR`, `ZERO_SEED_FORCE`, `ZERO_SEED_RESET`, and `ZERO_SEED_APPEND`. It persistently tracks progress, drops/recreates non-PK indexes and foreign keys, disables/re-enables triggers, uses PostgreSQL COPY, sets 2 GiB maintenance work memory and 256 MiB work memory, and analyzes. The documented `ZERO_SEED_BULK` switch does not exist in code; the bulk path is unconditional. (`scripts/seed.ts`, `package.json`, `SYNTHETIC_DATA.md`)

The alternative `gigabugs_v3` downloader names one user/project/label/issueLabel shard plus eight issue and eight comment shards and is described as about 1 GiB, but no counts are pinned. (`README.md`, `db/seed-data/gigabugs/getData.sh`)

### Topology and scale posture

Docker declares two independent `postgres:16.2-alpine` services: `postgres_primary` on 6434 with `zbugs_pgdata_upstream`, and `postgres_replica` on 6435 with `zbugs_pgdata_sync`. Both use user/database/password `user/postgres/password`, 1 GiB shared memory, and logical-WAL/slot/hot-standby settings. Compose does not wire streaming replication; external Zero configuration assigns their roles. (`docker/docker-compose.yml`)

The app server uses `ZERO_UPSTREAM_DB`; Zero cache owns the sync path; README identifies `/tmp/zbugs-sync-replica.db` as a local SQLite replica artifact. The client is a Vite React SPA, application HTTP is Fastify/Vercel-shaped, the README says trunk deploys continuously to AWS, and cleanup removes both Postgres volumes plus the SQLite replica. (`server/db.ts`, `package.json`, `README.md`, `vite.config.ts`, `vercel.json`)

The pinned k6 profile is fixed at 10 VUs and 10 shared iterations in Chromium; each iteration runs 10 navigation/filter/issue/assignee loops against `https://zbugs.vercel.app/?keepalive=1`, and its only threshold is checks rate `1.0`. It does not define a D8 hot data/mutation/fanout envelope or latency threshold. Qualification still needs large private/reaction data plus frozen mutation, fanout, latency, and custody targets. (`SYNTHETIC_DATA.md`, `k6/script.js`, `shared/schema.ts`)
