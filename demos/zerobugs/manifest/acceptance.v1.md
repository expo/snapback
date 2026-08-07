# Zerobugs acceptance manifest v1

**Schema version:** `zerobugs-acceptance.v1`  
**Manifest identity:** `zerobugs-acceptance.v1`  
**Status:** Frozen Stage 0 D1 workload and method; performance margins deferred; primary improvement candidate proposed  
**Date:** 2026-08-05  
**Authority:** LLP 0183 D1 and ZB0–ZB7  
**Machine-readable companion:** [`acceptance.v1.json`](./acceptance.v1.json)

This is the canonical prose contract for the first Zerobugs benchmark. The JSON
companion is canonical for enumerable structures. The pinned workload inventory
is not copied into this file: [`inventory.v1.json`](../stage0/inventory.v1.json)
is canonical for schema, relationships, queries, arguments, projections,
mutations, routes, auth, effects, assets, and fixture/target demand. JSON
pointers below are into that file. Workload statements in this manifest trace
to that inventory or to
[`source-digests.v1.json`](../stage0/source-digests.v1.json).

## 1. Source pin and comparator identity

- Repository: `rocicorp/mono`.
- Commit: `25c2c7308d3eb674d2d895022c9da11ef0c742fb`.
- Sparse source roots: `apps/zbugs` and `packages/zero`.
- Zero package: `1.10.0`.
- `@rocicorp/zero-virtual`: `0.6.3`.
- File-integrity authority:
  [`source-digests.v1.json`](../stage0/source-digests.v1.json), schema
  `zerobugs-source-digests.v1`.
- Inventory authority:
  [`inventory.v1.json`](../stage0/inventory.v1.json), schema
  `zerobugs-inventory.v1`, especially `/pin` and
  `/fixtureTargetDemand/applicationTopology/versions`.
- Verification record:
  [`0182-claim-verification.v1.md`](../stage0/0182-claim-verification.v1.md).

Both arms use the actual pinned UI or a source-faithful port of it. A headless
harness may support a result, but cannot close a whole-application gate. The
moving production site is context only. A new source commit, Zero version,
`zero-virtual` version, or material source digest creates a new manifest
version.

## 2. Canonical demand inventory

The following inventory sections are incorporated by reference and must be
exercised without reduction:

| Demand | Canonical JSON pointer |
| --- | --- |
| schema and physical rules | `/schemaDemand/tables`, `/schemaDemand/logicalPublication` |
| relationships | `/schemaDemand/relationships` |
| query names, arguments, filters, ordering, windows, and nested projections | `/graphDemand/queries`, `/graphDemand/projectionFieldSets` |
| authority partitions, projection widths, membership, and custody | `/factCustodyDemand` |
| mutation reads, guards, branches, writes, generated values, server overrides, and post-commit effects | `/mutationDemand` |
| routes and deployment routing | `/routeDemand` |
| actors, JWT lifecycle, and permission rules | `/authDemand` |
| notification triggers, recipients, payloads, and delivery behavior | `/effectDemand` |
| asset flow and policy | `/assetDemand` |
| seed, large generator, topology, and cleanup demand | `/fixtureTargetDemand` |

The inventory remains source-of-truth if a summary here is ambiguous. No arm
may hardcode, prejoin into fixture output, or omit an item that the required
surface below names.

## 3. Required application surface and inventory realization

Every LLP 0183 required-surface item is bound to the exact inventory entries
that realize its workload demand.

| Required feature | Inventory realization |
| --- | --- |
| Projects and role/visibility-aware issues | tables `project`, `issue`, `user`; relationships `project.issues`, `issue.project`, `issue.creator`, `issue.assignee`; queries `allProjects`, `issuePreloadV2`, `issueListV2`, `issueDetail`; `/authDemand/permissionRules` |
| Open/closed, creator, assignee, all-selected-label, and text filters | query `issueListV2`, including its `/graphDemand/queries/*/filters`; `usersForProject` supplies picker membership |
| Selectable stable ordering and bidirectional keyset navigation | queries `issueListV2`, `commentsPage`, `listIssueByID`, and deprecated-but-inventoried `prevNext`; `/schemaDemand/indexRelevantOrderingFields` |
| Issue-list labels and per-user view state | `issueListV2`, `issuePreloadV2`; tables `label`, `issueLabel`, `viewState`; relations `issue.labels`, `issue.viewState` |
| Detail with project, creator, assignee, labels, view state, notification state, emoji, and comments | query `issueDetail` and every relationship in its inventory entry |
| Virtualized long issue lists and comment threads | `issueListV2.window.ui`, `commentsPage.window.ui`, and `comment` permalink lookup |
| Permalink navigation outside the current window | `listIssueByID`, `comment`, `issueListV2.window.ui`, and `commentsPage.window.ui` |
| Issue, comment, label, emoji, view-state, preference, and notification writes | all 16 entries in `/mutationDemand/mutators`: `issue.create`, `issue.update`, `issue.delete`, `issue.addLabel`, `issue.removeLabel`, `notification.update`, `emoji.addToIssue`, `emoji.addToComment`, `emoji.remove`, `comment.add`, `comment.edit`, `comment.remove`, `label.create`, `label.createAndAddToIssue`, `viewState.set`, `userPref.set` |
| Optimistic presentation with pending, rejected, settled, and observer-converged states wherever a local program is admitted | `/mutationDemand/mutators/*/idTimestampChoice`, `serverDifference`, and `preliminaryClass`; these inventory facts define the operation/value demand, while LLP 0183 ZB3 defines the required visible lifecycle |
| Useful retained reads through disconnection and durable queued intent for admitted operations | the retained graph is the active query set in `/graphDemand/queries`; queued operations are the admitted subset of `/mutationDemand/mutators`; no inventory statement is converted into a claim that the pinned Zero arm has durable offline writes |
| External identity, authorization change, logout, and user switching | routes `GET /api/login/github` and `GET /api/login/github/callback`; `/authDemand/jwt`, `/authDemand/identityLifecycle`, and `/factCustodyDemand/custodyBoundaries` |
| Image upload and delivery | `POST /api/upload/presigned-url` and all of `/assetDemand` |
| Email and webhook/Discord-class notification delivery | all eight `/effectDemand/triggers`, `/effectDemand/recipientSelection`, `emailPayload`, `discordPayload`, and `deliveryModel` |
| Machine-readable issue and unsubscribe routes | `GET /p/:projectName/issue/:id.md` and `GET /api/unsubscribe` in `/routeDemand/endpoints`, subject to the intended-policy amendment in §8 |
| Supported TLS deployment, secrets, backup, restore, inspection, and release identity | `/routeDemand/deploymentRouting`, `/fixtureTargetDemand/applicationTopology`, `/fixtureTargetDemand/postgresDockerTopology`, `/fixtureTargetDemand/applicationTopology/cleanup`, `/assetDemand/configuration`, and the D7/D8 acceptance fixtures in §12; the inventory supplies source topology, not proof that backup/restore already exists |
| Deterministic large-data profile derived from the pinned generator | `/fixtureTargetDemand/syntheticGenerator`, with the single-generation and extension rules in §4 |

All ten tables, 22 relationships, 19 named queries, 16 mutators, nine HTTP
endpoints, and eight notification triggers remain governed by the inventory's
enumeration and counts. Deprecated named queries remain inventory-visible and
must either be exercised where the pinned UI still reaches them or receive an
explicit source-faithful not-reached receipt; they may not silently disappear.

## 4. Frozen fixtures

### 4.1 Actor binding shared by every fixture

Within each seed, sort users lexicographically by `user.id`, then partition by
the inventory role field. Bind distinct rows as follows: ordinary = first
`user`; creator = second `user`; assignee = third `user`; crew/admin = first
`crew`; removed-member = second `crew`. Anonymous has no row. Attacker has no
trusted row or credential. A fixture that cannot form these bindings is
invalid. Both inventoried seeds have sufficient role populations
(`/fixtureTargetDemand/ordinarySeed/actorDistribution` and
`/fixtureTargetDemand/syntheticGenerator/distributions`).

### 4.2 Normal profile: `normal-seed-v1`

The base is the pinned ordinary GitHub CSV seed plus its migration-created Zero
project, exactly as recorded at `/fixtureTargetDemand/ordinarySeed`: 14 users,
516 public issues, 924 comments, 30 labels, 603 issue-label rows, and no rows in
`viewState`, `emoji`, `userPref`, or `issueNotifications`.

Both arms then apply the same manifest-owned deterministic
`policy-extension-v1`:

1. add one internal issue in the migration-created project, created by the
   creator and assigned to the assignee;
2. add one creator comment, one issue reaction, and one comment reaction so
   `commentsPage`, `comment`, and `emojiChange` have protected child facts;
3. add principal rows for `viewState`, `userPref`, and
   `issueNotifications` for the authenticated actors, using the exact
   hash/value/timestamp rules in §4.3 against the extension issue; and
4. use issue id `zbav1_internal_issue`, short id `9183001`, comment id
   `zbav1_internal_comment`, and emoji ids
   `zbav1_internal_issue_emoji`/`zbav1_internal_comment_emoji`; use fixed
   title/description/body text naming the policy fixture, reaction value `👍`
   with annotation `thumbs up`, and timestamps derived from the generation
   instant below; and
5. refuse on any id/short-id collision rather than changing fixture identity.

This is a declared fixture extension, not a claim that those rows exist in the
pinned ordinary seed.

### 4.3 Large profile: `large-seed42-v1`

Run the pinned synthetic generator defaults from
`/fixtureTargetDemand/syntheticGenerator/defaults`, including `SEED=42`, once.
The corrected replayed base output is:

- 100 users;
- 100 projects;
- 4,810 labels;
- 1,000,000 issues;
- 2,527,886 comments;
- 2,000,370 `issueLabel` rows; and
- 5,533,266 rows across the six generated tables.

The generator is seeded but not date-deterministic: issue timestamp ranges are
anchored to its generation date
(`/fixtureTargetDemand/syntheticGenerator/distributions`). The convention for
this benchmark is therefore one controlled generation at
`2026-08-05T00:00:00.000Z`. Preserve its CSV bytes and a content digest as the
canonical `large-seed42-v1` artifact. Both provider arms import that same
artifact; they never generate independently. If the controlled clock cannot be
proved, the fixture attempt is a GAP and cannot supply comparative evidence.

The generator covers only `user`, `project`, `label`, `issue`, `comment`, and
`issueLabel`; `/fixtureTargetDemand/syntheticGenerator/notGenerated` is
authoritative for the missing four tables. Provision them with
`large-overlay-v1` as follows:

1. Select the project with the greatest issue count, breaking ties by project
   id. Within it select the first 1,000 issues by `(modified desc, id desc)`,
   matching the inventoried preload bound. This is the working set `W`.
2. Encode hash inputs as UTF-8 fields separated by one NUL byte and compute
   SHA-256 over
   `zerobugs-acceptance.v1`, table, actor id, and natural-key fields. Enumerate
   each table's natural keys lexicographically from rank zero. A generated
   timestamp is `generationEpochMs - rank`; an id is `zbav1_` plus the first 24
   lowercase digest hex characters. Any collision refuses the fixture.
3. For every authenticated fixture actor and every issue in `W`, create one
   `viewState` row with `viewed` from the rank rule and one
   `issueNotifications` row with `created` from the rank rule and `subscribed`
   equal to `true` exactly when the digest's first byte is even.
4. Create one issue `emoji` for every issue in `W`; if it has a comment, create
   one comment `emoji` on its newest `(created desc, id desc)` comment. Choose
   the creator cyclically from the authenticated actors, use value `👍` and
   annotation `thumbs up`, and derive id/created from the rules above.
5. Create one `userPref` row per authenticated actor with manifest-owned key
   `zerobugs-acceptance.v1` and value equal to the first 32 lowercase hex
   characters of its digest. Acceptance uses that key
   to exercise the inventoried `userPref` query and `userPref.set` mutation; it
   is not represented as a pinned application preference key.
6. Apply `policy-extension-v1` as well, placing its internal issue in the
   selected project with `modified = generationEpochMs + 1` so it is the most
   recent issue and enters the protected working set.

A referential mismatch or row-count mismatch refuses the fixture; it does not
trigger a provider-specific repair.

The stale `db/seed-data/templates/summary.json` is not an input. The generator
uses the ten category files and the inventory's
`/fixtureTargetDemand/syntheticGenerator/templateInputs` is authoritative.

### 4.4 Hot profile: `hot-recent-v1`

Hot is a deterministic derivation of `large-seed42-v1`, not a separately
generated database. Its hot project and 1,000-row working set `W` are exactly
the selection above. All authenticated actors plus one anonymous observer open
the issue-list graph over that project; creator, assignee, crew/admin, and
ordinary act as writers when authorized; removed-member transitions during the
run; attacker executes only negative probes.

One open-loop cycle invokes the 16 mutation inventory entries in inventory
order against deterministically selected eligible rows, using a fresh fixture
reset between cycles. The eight inventoried effect-triggering operations and
the eight inventoried non-triggering operations remain distinguishable.
Arrivals do not adapt to response timing. The exact operation arguments and
selected row ids are emitted before execution and content-digested in the
attempt receipt. This profile defines activity and fanout; it defines no
latency or throughput pass margin.

## 5. Actors, policies, and negative delivery

| Actor | Frozen meaning and expectations | Inventory anchor |
| --- | --- | --- |
| `anonymous` | No credential. May receive public issue graphs and public machine Markdown; receives no private overlay and no mutation authority. | `/authDemand/actors[name=anonymous]` |
| `ordinary-user` | Role `user`, not creator or assignee of the protected issue. Public reads plus own overlays and the inventoried ordinary writes. | `/authDemand/actors[name=logged-in user]` |
| `creator` | Distinct ordinary user who owns the extension issue. Preserve the pinned mismatch: a non-crew creator has no special internal query visibility, although mutation visibility permits operations on the creator's internal issue. | `/authDemand/actors[name=issue creator]`, `/authDemand/permissionRules` |
| `assignee` | Distinct ordinary user assigned to the extension issue. Assignment supplies no extra visibility or edit authority and may create notification subscription state. | `/authDemand/actors[name=assignee]` |
| `crew-admin` | Role `crew`; may read internal issue graphs, take admin edit/delete paths, and create labels. | `/authDemand/actors[name=crew/admin]` |
| `removed-member` | Starts as the second crew actor, establishes protected state, then undergoes a server-side `crew` → `user` role/policy transition plus invalidation of the old crew-bearing authority. The name is an acceptance persona: the pinned schema has no project-member role. | `/authDemand/permissionRules[scope=project visibility]`, `/factCustodyDemand/custodyBoundaries[boundary=role visibility]` |
| `attacker` | No trusted credential; attempts guessed child ids, forged/expired bearer values, cross-principal storage access, unsubscribe abuse, oversized upload, secret/admin access, and replay. It receives no protected fact or useful existence oracle. | `/authDemand/jwt`, `/authDemand/permissionRules`, `/routeDemand`, `/assetDemand` |

Required transitions are login, logout, expiry, user switch, crew-to-user role
change, public-to-internal visibility change, out-of-band permission change,
activation of auth-relevant policy, reset/import/declared restore, and
revocation crossing queued work.

LLP 0053 governs the negative-delivery result:

- Hidden data must not influence rows, fields, order, list membership, search
  membership, count-like UI, existence, completeness, hydration, retained
  facts, or caller-visible errors.
- A protected result shrink, denial, or untyped re-query error is never
  best-effort. It raises an obligation and hides affected state immediately.
- Coarse permission/policy change quarantines affected state until a satisfying
  authority-checked snapshot releases it or proof escalates to delete.
- Trusted denial, authority loss, reset/import/declared restore, incompatible
  stream/incarnation, or expired authorization lease deletes affected data and
  preserves the fence needed to reject delayed callbacks.
- Logout and user switch are authority transitions and delete predecessor
  client state. A non-live resume fresh-snapshots auth-scoped queries.
- Pending/optimistic work is hidden and suspended under quarantine; unauthorized
  queued work cannot execute, leak its prior overlay, or commit after
  revocation.
- Negative delivery is proved at client-delivery and retained-byte boundaries,
  not by React hiding a row.

ZB4 evaluates every protected graph, route, effect, asset, retained store, and
queued-write path against these declared policies.

## 6. Browser, machine, network, and target profiles

### Browser `chrome-arm64-v1`

Use Google Chrome `150.0.7871.187` on arm64. Record the browser artifact digest,
command-line flags, profile directory identity, and feature flags in every
environment receipt. Comparative attempts use a fresh browser profile for cold
paths and the same exact build for both arms. A browser patch or major change is
not silently substituted; it requires a new benchmark version or is reported
as non-comparative context.

### Machine `m5max-18c-128g-v1`

Use an Apple M5 Max 18-core arm64 Mac with 128 GiB RAM running macOS 26.5.2.
The machine is on AC power, uses one fixed power mode, has thermal state and OS
build recorded, and runs no unrelated foreground workload. Both arms, local
databases, browser, and measurement driver run on this same machine for local
comparisons. A different machine/class is non-comparative evidence.

### Network conditions

LLP 0167 defines usable server-egress profiles. This manifest freezes:

| Profile | Use |
| --- | --- |
| `normal` | Identity profile: zero mutation-ack, live-delta, query-response delay, and jitter. All baseline local and hosted measurements use it. |
| `optimistic` | 1,000 ms mutation-ack and live-delta delay, zero query delay and jitter. Used for local optimistic paint, authoritative result, and observer convergence separation. Markers and telemetry must identify it. These values are injected conditions, not performance margins. |
| `demo-slow` | 2,000 ms on all three lanes with 250 ms jitter. Diagnostic/interactive evidence only; it cannot replace `normal` or `optimistic` comparative samples. |
| `offline-disconnected` | A harness connectivity scenario, not an LLP 0167 egress profile: establish/hydrate, disconnect, exercise retained reads and admitted queued intent, terminate/restart, then reconnect. It must use the declared disconnect/ordering seam, not client sleeps. |

Non-`normal` profiles are local-only unless a hosted derived/fork target meets
LLP 0167's activation policy. No primary hosted target is perturbed.

### Target profiles

- `local-loopback`: Zero uses the pinned provider-native local composition from
  `/fixtureTargetDemand/postgresDockerTopology` and
  `/fixtureTargetDemand/applicationTopology`—Zero 1.10.0,
  `zero-cache-dev`, the application API, and PostgreSQL 16.2-alpine. Snapback
  uses repository source on the canonical local Ibex/SQLite target plus only a
  versioned, declared D7 companion where required. All processes bind to the
  same machine and owned runtime namespace.
- `cold-online`: a path state, not a different server: `normal` network,
  cleared browser storage, no retained facts, fresh connection, and the target
  already ready. It is reported separately from warm local and process-cold
  startup.
- `hosted-public-tls`: a clean immutable, provider-supported deployment with
  public TLS, exact release/region/service identities, dedicated test
  credentials, backup/restore, observability, and owned cleanup. LLP 0183 D8
  deliberately leaves target selection evidence-driven; the selected adapter
  and service versions must be named in the next manifest version before any
  hosted comparative attempt. Until then, hosted is a required GAP, not an
  inferred claim from the moving Zerobugs site or a bespoke deployment.

Local, cold-online, hosted, actor-authority, and independent-observer
convergence paths are separate datasets and may not be pooled.

## 7. Performance methodology

### Critical interactions and marks

The interaction ids, descriptions, and exact start/end events are also frozen
in the JSON companion.

| ID | Start event | End event | Paths |
| --- | --- | --- | --- |
| `cold-route-readiness` | navigation request issued from a fresh browser profile after target readiness is proved | required route shell, first useful rows, and explicit complete/incomplete/currentness state are painted; each submark is retained | cold-online, hosted |
| `retained-route-readiness` | navigation request issued after browser restart with declared retained state and network disconnected | retained route paints with exact freshness, authority-lease, and completeness labels | local retained/offline |
| `warm-filter` | scripted filter input/change event commits | correct stable window and completeness state paint | local, hosted |
| `warm-sort` | sort selection event commits | correctly ordered stable window paints | local, hosted |
| `warm-navigation` | list navigation action is dispatched | destination window paints with scroll/completeness state | local, hosted |
| `detail-open` | issue link activation is dispatched | detail root and required relation states paint; relation completion submarks remain separate | local, cold-online, hosted |
| `permalink-jump` | out-of-window issue/comment permalink navigation is dispatched | target row is painted in its loaded window or authoritative missing is painted | local, cold-online, hosted |
| `mutation-paint` | user activation dispatches one admitted mutation | its local optimistic overlay or honest pending state is painted | local `optimistic`, offline-disconnected |
| `mutation-authoritative-result` | same user activation | authoritative accepted/refused outcome is delivered and settlement state paints | local `normal`, local `optimistic`, hosted, authority |
| `observer-convergence` | authoritative commit/refusal is recorded | independent observer paints the canonical result and actor/observer versions agree | local `normal`, local `optimistic`, hosted, convergence |
| `virtual-window-scroll` | scripted scroll crosses the current issue/comment window demand boundary | newly demanded stable rows paint and spacer/scroll position is reconciled without duplicate or skipped unchanged rows | local, hosted |

For mutations, paint, authoritative result, and observer convergence are three
different measurements. A single end-to-end number cannot replace them.

### Trials and reporting

1. Alternate arm order across at least five independent run-to-run trials per
   fixture/path/profile. Each trial starts a new owned server namespace and
   browser profile for cold paths; warm paths receive one unreported warm-up
   traversal before raw samples begin.
2. Use the same fixture bytes, browser build, machine, target class, scripted
   input, network profile, and measurement implementation for comparable arms.
3. Record every raw sample and trial boundary. Report sample count, arithmetic
   error count, median, nearest-rank p95 tail, min/max, and inter-run dispersion.
   Never retain only aggregates.
4. Record browser `PerformanceObserver` long tasks, main-thread busy time,
   memory where the browser exposes it, console/page errors, request errors,
   disconnects, retries, refusals, and timeouts. Long-task records retain their
   native browser threshold and duration; a missing API is a declared GAP.
5. Server evidence separately records examined work, query/write time, live
   fanout, queue depth/latency, CPU, memory, storage, and errors. Client evidence
   separately records facts, rows, bytes, hydration work, query churn residue,
   storage, memory, and bundle bytes.
6. Process startup, cold-online hydration, warm local interaction, hosted
   interaction, authority response, and observer convergence remain separate
   distributions.
7. Any failed correctness/security/recovery assertion invalidates the affected
   performance sample as claim evidence while retaining it as diagnostic
   evidence.

### Performance margins are deferred

**MARGINS ARE NOT FROZEN YET. No path-specific noninferiority margin is frozen
in this v1 manifest.** LLP
0182 contains no comparative run from which a defensible numeric margin can be
derived. `acceptance.v2` may freeze margins only after the repeated-trial method
above produces an observed run-to-run variability envelope for both the pinned
Zero arm and the current-Snapback control. Each margin must be path-specific
and justified by measurement noise plus the largest user-visible regression
the authors are willing to accept. Slowness in the current control is not a
reason to loosen a Zero-relative margin.

After the first Stage 1 attempt, changing a margin creates a new versioned
benchmark. The original manifest, attempt, raw samples, and result remain
visible. No numeric placeholder, example percentage, or provisional
millisecond allowance in another artifact has standing as a v1 margin.

## 8. Pinned-application defect policy

Unless this table declares an intended policy, the pinned inventory behavior
is the required fidelity behavior—even when surprising, such as the internal
issue creator's query/mutation visibility mismatch. For these four defects the
benchmark deliberately requires the safer policy. ZB4 negative-delivery gates
are evaluated against the declared policy, not the Zero arm's defect. A
Snapback arm that fails closed where the pinned arm leaks is a PASS with an
`intentional-improvement` note, not a fidelity failure.

| Inventory finding | Zero arm context | Benchmark-required behavior | Scoring |
| --- | --- | --- | --- |
| Finding 3: `commentsPage`, `comment`, and `emojiChange` omit parent visibility gating | A caller who knows an internal issue/comment/subject id can directly observe protected child facts; `/factCustodyDemand/custodyBoundaries[boundary=unguarded child roots]` and `/authDemand/permissionRules[scope=child visibility gap]`. | **Declared intended policy.** Every child-root query proves visibility through its parent issue before returning row, membership, existence, completeness, order, or hydration facts. The machine route's parent-first structure is the minimum model. | Zero records expected defect context. A fail-closed arm passes with an intentional-improvement note. Any child delivery to anonymous, ordinary, non-crew creator, assignee, removed-member after transition, or attacker fails ZB4. |
| Finding 8: post-commit notifications are non-durable; Discord is not idempotent | In-memory closures run through `Promise.allSettled`; failures are discarded. Email has an idempotency key; Discord has neither durability nor idempotency, per `/effectDemand/deliveryModel`. | **Declared intended policy.** Authoritative commit creates durable notification intent. Email and webhook/Discord-class delivery have stable idempotency identity, retry state, terminal receipt, and explicit ambiguous outcome if the provider cannot prove delivery. Effects never run before commit. | Lost intent, silent discarded failure, or duplicate claimed delivery fails ZB3/ZB7. The pinned Zero result is retained as context, not the required policy. |
| Finding 9: unsubscribe is an unauthenticated state-changing `GET` | Possession of cleartext email plus issue short id is sufficient; no JWT, signature, visibility proof, or one-time token, per `/routeDemand/endpoints[path=/api/unsubscribe]`. | **Declared intended policy.** `GET /api/unsubscribe` is read-only confirmation. Mutation requires a separate POST authorized by a signed, purpose-bound, expiring token that binds user and issue; it is idempotent and reveals no issue/user existence outside the token grant. | A bare email+short-id state change fails ZB4/ZB7. The extra POST is an intentional safety amendment to the pinned route surface. |
| Finding 10: upload size is browser-only and credential/policy handling is unsafe | Presign receives MIME but no size, no bucket/CORS policy is pinned, PUT success is not checked, and the module logs access-key id plus a secret prefix, per `/assetDemand`. | **Declared intended policy.** The service enforces the inventoried 10 MiB ceiling and five allowed MIME types server-side; the signed upload policy binds type and size; browser checks PUT success; delivery/CORS policy is pinned; owned metadata/lifecycle enables cleanup; no credential or secret prefix is logged. | Server refusal of oversized/invalid uploads passes as intentional improvement. Secret logging, unchecked failed PUT, unbounded presign, or undeclared public delivery fails ZB4/ZB7. |

Fixture caveats are also frozen. The large generator's six-table coverage is
completed only through `large-overlay-v1`; neither arm may treat the absent
four tables as not applicable. The ordinary seed's zero internal issues is
corrected only through `policy-extension-v1`, identically in both arms. The
stale template `summary.json` is ignored in favor of the ten actual category
files. These are declared shared extensions, not provider workarounds.

## 9. Custody, source, assistance, and workaround accounting

The LLP 0138 accounting discipline applies to each arm and attempt.

### Custody

Record browser facts, logical rows, unique source rows, projected fields,
membership edges/reasons, completeness proofs, retained bytes, live bytes,
IndexedDB/cache bytes, hydration request/response bytes, and query-churn residue
by query identity, authority partition, projection width, and fixture. Measure
after cold hydration, after each warm interaction class, after the hot cycle,
after browser restart, and after logout/user switch/revocation/lease expiry.
Unknown or absent proof is not counted as absence. Provider inspector totals
must reconcile with independently observed browser storage and network facts or
record the discrepancy.

### Source and touch counts

- Count provider-native implementation files and physical lines by application
  intent, schema/query/mutation, adapter/gateway/configuration, tests, and
  workaround code.
- Report generated output separately; exclude dependencies, build output,
  lockfiles, runtime data, and evidence receipts from authored-source totals.
- Touch count is the unique files plus added/deleted lines from the clean
  source pin or declared Snapback baseline through the attempt. Renames retain
  ancestry. Generated and mechanical-formatting touches remain separate.
- Shared neutral visual code may be reported once, but provider-specific state
  machines, schema, queries, permissions, mutations, endpoints, and lifecycle
  code remain visible and count for their arm.
- Line count is evidence, not a composite quality score.

### Assistance

Record chronologically every human intervention, AI/code-generation use,
documentation or guide page, package-source inspection, cross-arm code reuse,
credential/setup intervention, and failed-path hint with timestamp, source,
arm, purpose, and resulting decision. Shared dependency installation and
predeclared harness setup are named separately. Unrecorded assistance makes
authoring comparisons a GAP.

### Workarounds and components

Every projection, duplicate reducer, application-side join/filter/sort,
sidecar/gateway, handwritten protocol adapter, manual invalidation, polling
loop, custom retry ledger, or provider-specific fixture transformation is
declared before use. Record its class, reason, owner, files/lines, supported or
bespoke status, lifecycle, security boundary, and whether a later stage removes
it. An undeclared component or workaround fails ZB0. A formally versioned D7
companion is allowed and counted; a one-off sidecar is not.

The diary preserves chronology, immutable first-pass verdict, failed paths,
assistance, counts, cleanup, and dated remediation appendices. Later attempts
append; they do not rewrite history.

## 10. Capability and refusal facts consumed by the app

The application consumes exact facts rather than a `zerobugsParity` boolean.
Each fact includes `status` (`supported`, `refused`, or `gap`), target, carrier,
authority posture, bounds/completeness, package/source identity, release
identity, and evidence receipt.

Required fact ids are:

- `relational-graph.issue-list` and `relational-graph.issue-detail`;
- `projected-facts.public-exact`, `public-compatible`,
  `principal-private-exact`, and `protected-or-subsuming`;
- `local-graph-evaluation` and `retained-read`;
- `windowed-query.issue-list`, `windowed-query.comments`, and
  `windowed-query.permalink`;
- one fact per inventory mutation, including its admitted optimistic carrier,
  durable-intent support, value/identity policy, and server-only fallback;
- `derived-search.issue-comment-membership`;
- `identity.github-oauth`, `route.machine-issue`, `route.unsubscribe-safe`,
  `asset.image-policy`, `effect.email-durable`, and
  `effect.webhook-durable`;
- `target.local`, `target.hosted`, `backup`, `restore`, `release-identity`, and
  `cleanup`; and
- the active LLP 0167 network-profile fact and marker.

The UI and inspector render incomplete, unknown, hydrating, retained,
quarantined, retired, pending, rebased, rejected, settled, observer-converged,
refused, and GAP states where applicable. Unsupported graph nodes, mutation
verbs, local carriers, route/effect adapters, and targets refuse with stable,
actionable machine-readable facts; they are never simulated through an
undisclosed broad query or sidecar.

## 11. Evidence and immutable attempts

There is one immutable artifact per provider attempt under
[`demos/zerobugs/evidence/`](../evidence/), following its README. JSON receipts
are named `<arm>.<gate>.<attempt>.json`. A remediation increments the attempt
identifier and retains the original failed, GAP, or incomplete artifact.

Each receipt records at minimum manifest id/digest, arm/provider/release,
fixture and its digest, actor bindings, browser/machine/network/target receipt,
expected/executed checks, PASS/GAP/FAIL counts, missing checks, raw artifact
links/digests, capability/refusal facts, assistance/workarounds, custody/source
accounting, cleanup ownership/result, and redacted errors. Receipts contain no
secrets, bearer values, local credential material, or unredacted sensitive
runtime data. Zero-check, short, fabricated, secret-bearing, unsafe-cleanup,
cross-user-delivery, invariant-violation, or lost/duplicate-settled-intent
attempts are retained Stop-class failures.

## 12. Identity, route, asset, effect, recovery, and cleanup fixtures

- **Identity:** local policy checks use deterministic signed actor fixtures with
  the exact `/authDemand/jwt/claims` shape through the declared auth adapter.
  ZB7 additionally completes real GitHub OAuth start/callback over public TLS
  with a dedicated acceptance identity and verifies database role → signed
  session → protected connection. A mock identity cannot close ZB7.
- **Routes:** exercise all nine `/routeDemand/endpoints`, including both Zero
  aliases, public/internal machine Markdown by id and short id, canonical
  redirect, invalid bearer, authoritative not-found, upload presign, and the
  safe unsubscribe policy in §8. Exact method/path/input/output/auth bounds are
  declared by the supported gateway/route component.
- **Assets:** deterministic valid files for each of the five inventoried MIME
  types; payloads at the 10 MiB boundary and one byte over; mismatched MIME,
  unauthorized presign, failed PUT, public retrieval, metadata, and cleanup
  cases. ZB7 uses the declared production bucket/provider; local capture alone
  cannot close it.
- **Notifications:** invoke each of the eight `/effectDemand/triggers` and prove
  each `/effectDemand/nonTriggers` operation emits none. Use a deterministic
  capture adapter for local tests and sandbox email plus webhook/Discord-class
  providers for ZB7. Fault before send, after send/before receipt, retry, and
  replay to prove durable intent, idempotency, and explicit ambiguity.
- **Backup:** after a declared mix of all mutation classes and pending effect
  receipts, create a target-native backup. Record release/schema/function
  identities, row/count digest, sampled relation digest, authority epoch,
  effect/outbox state, asset manifest, and backup checksum.
- **Restore:** restore that backup into a paused, clean target; verify all
  digests before activation; activate; require fresh authority snapshot and
  observer convergence; prove pending effects do not duplicate and stale
  clients cannot repopulate retired state.
- **Release/roll-forward:** deploy an immutable release, record identity, then
  apply one compatible schema/function change without unreviewed authority or
  projection widening.
- **Cleanup:** remove every owned process, browser profile, local port, database,
  replication slot/replica, volume, target/release, queue/outbox, notification
  test resource, asset/object/bucket, backup, credential, and secret. Enumerate
  each target and result; unsafe or incomplete cleanup fails ZB7.

## 13. Primary improvement candidate

**Candidate:** durable disconnected intent. LLP 0182 finding 10 records the
pinned Zerobugs UI disabling writes offline and Snapback's durable ordered
outbox/restart-preserved intent as the named opportunity. The inventory anchors
the visible operations at `/mutationDemand/mutators`, especially
`issue.create` and `comment.add`, and the pinned offline controls are verified
in `0182-claim-verification.v1.md` M11–M12.

**Proposed success threshold:** across normal, large, and hot fixtures,
`issue.create` and `comment.add` must each pass both
termination-before-send and termination-after-enqueue/before-authoritative-
result scenarios. In every scenario the intent survives a full browser-process
restart, reconstructs the same declared speculative identity/presentation,
settles exactly once after reconnect, and converges an independent observer
with zero lost or duplicate committed rows/effects. A queued write crossed by
revocation must instead be rejected, its overlay removed/redacted, and no
unauthorized state or effect delivered. The Zero arm must visibly retain its
pinned behavior of disabling the corresponding controls offline. Every one of
these scenarios must pass; one loss, duplicate, unauthorized commit, or hidden
failure defeats the candidate.

**PROPOSED — requires Charlie's ratification before Stage 1.** Ratification
must be recorded in the next manifest version before results are known. Without
ratification, or if this threshold is not met while every parity gate and
future noninferiority rule passes, the strongest permitted whole-product claim
is parity. No other improvement may be selected after seeing results.

**RATIFIED (author: Charlie Cheever, 2026-08-07, via
`issues/closed/20260807-local-first-author-gate-packet.md` item 6).**
Durable disconnected intent is the ratified primary-improvement candidate,
recorded before any Stage-1 results are known, per the rule above. The
candidate's remaining delta over landed evidence — the authorized/revocation
leg — rides the LLP 0129 Phase-0-remainder lane (M1 lease custody +
authenticated conjunction witness; owner/timebox per the same packet's
item 2, presented by 2026-08-14).

## 14. ZB gate hooks

| Gate | Manifest hooks |
| --- | --- |
| ZB0 source fidelity and anti-reduction | §§1–3, 8–11; exact inventory and immutable attempts |
| ZB1 relational and window correctness | §§2–5, 7, 10; query/window inventory and child-visibility intended policy |
| ZB2 retained and local data | §§4–7, 9–10; custody accounting and LLP 0053 transitions |
| ZB3 optimistic programs and durable intent | §§2–5, 7–8, 10, 13; full mutation corpus and durable effect policy |
| ZB4 authorization and information flow | §§4–6, 8, 10, 12; all actors, negative delivery, routes/effects/assets |
| ZB5 performance, scale, and custody | §§4, 6–7, 9; ordinary/large/hot, separated paths, raw distributions, deferred margins |
| ZB6 authoring and diagnostics | §§9–11; chronology, assistance, counts, workarounds, exact facts/refusals |
| ZB7 production and recovery | §§6, 8, 10–12; public TLS, supported composition, assets/effects, backup/restore/release/cleanup |

Correctness, security, and recovery are hard gates. No authoring, latency,
custody, or operational advantage compensates for a wrong result, protected
delivery, lost accepted write, or unverifiable restore. Results are reported as
separate vectors; no composite score is permitted.

## 15. Review, freeze, and amendment rule

This v1 freezes the source pin, inventory incorporation, required surface,
fixtures and extensions, actors/policies, defect dispositions, browser/machine/
network method, critical interactions and marks, accounting, evidence custody,
and proposed primary candidate. It deliberately freezes the fact that numeric
performance margins are absent pending evidence.

Before Stage 1, Charlie reviews the primary candidate and the evidence-derived
`acceptance.v2` margins. Any semantic change to a frozen v1 item creates a new
versioned manifest and companion JSON; source/version changes always do so.
Once any evidence receipt names this manifest, even corrections append through
a successor manifest or explicit erratum artifact—these two v1 files are not
rewritten. Every successor links its predecessor and explains the delta.

After the first Stage 1 attempt, a margin or interaction-boundary change is a
new benchmark, never an edit to the benchmark already attempted. Original
receipts, raw distributions, PASS/GAP/FAIL outcomes, and claim eligibility stay
visible. Review may narrow a claim or add a safety gate without erasing prior
evidence; it may not retrospectively choose a winner, remove a failed feature,
or loosen a result in place.
