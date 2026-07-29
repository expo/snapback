# Deep-round report: Linear, Partiful, and Research Room

## Frozen context

- Protocol: LLP 0102 plus freeze aggregate
  `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`.
- Repaired Snapback source frozen for all 21 deep arms:
  `5f31cb6174daaefa04a1e05242acbbc22c725040`.
- Provider versions and target profiles are those pinned in
  `protocol/provider-inventory.v1.json` and copied into each capsule.
- Execution orders were frozen per application and honored for assignment and
  start. Independent arms were allowed to finish out of order.
- Assistance followed `protocol/assistance-policy.v1.json`. Every material
  source inspection, prior-arm reuse, failed attempt, and untimed extension is
  retained per arm.
- All 21 deep capsules pass the frozen structural verifier. A separate strict
  draft-2020 schema pass found and removed four redundant forbidden root
  extensions without changing outcomes, and corrected one fresh-target
  non-file baseline sentinel. All 35 capsules now pass both validations and
  every declared evidence, cleanup, and non-empty baseline path resolves.
- The detailed independent coordinator adjudications are in
  [deep-round-evidence-audit.md](./deep-round-evidence-audit.md). In
  particular, screenshots are treated as integration witnesses, never as
  substitutes for provider authority, transport, settlement, or cleanup.

Validity threats remain explicit. Most hosted-provider evidence used local
emulators or disposable/shared free-tier targets, and unavailable hosted
credentials are not inferred. Active-time counters are worker-reported and are
not interchangeable with wall time. Supabase Research Room's original target
was destroyed after a builder evidence-redaction Stop and rerun prospectively.
Convex Research Room froze before scenarios after a provider control credential
appeared in process argv; its scenario work is an untimed extension. Appwrite
Research Room's final inventory drift reduces reproducibility confidence.

## Product completeness

Legend: **P** pass, **G** explicit product GAP, **F** fail, **U** unavailable
remote dependency. A GAP or unavailable hosted target is never promoted to a
pass. Convex's secrets failure is additionally Stop-class.

### Linear

| Scenario | Snapback | Convex | Supabase | Firebase | InstantDB | SpacetimeDB | Appwrite |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| LINEAR-01-SEED | P | P | P | P | P | P | P |
| LINEAR-02-AUTHORITY | P | P | P | P | P | P | P |
| LINEAR-03-FILTERS | P | P | P | P | P | P | P |
| LINEAR-04-PAGINATION | P | P | P | P | P | P | P |
| LINEAR-05-DETAIL | P | P | P | P | P | P | P |
| LINEAR-06-OPTIMISTIC | P | P | P | P | P | P | P |
| LINEAR-07-CONFLICT | P | P | P | P | P | P | P |
| LINEAR-08-LIVE | P | P | P | P | P | P | P |
| LINEAR-09-SEARCH | G | P | P | G | G | G | P |
| LINEAR-10-OFFLINE | G | G | G | P | P | G | G |
| LINEAR-11-MIGRATION | G | P | P | P | P | P | P |
| LINEAR-12-DEPLOY | G | U | G | U | G | U | U |
| LINEAR-13-PERFORMANCE | P | P | P | P | P | P | P |
| LINEAR-14-CLEANUP | P | P | P | P | P | P | P |

Snapback passes the transactional issue-tracker core but lacks ordinary search,
offline client behavior, migration execution, and the frozen hosted deployment
path. Firebase and InstantDB are the only arms with direct offline evidence.
Supabase and Appwrite have the strongest native full-text path; Convex also
passes search and migration locally.

### Partiful

| Scenario | Snapback | Convex | Supabase | Firebase | InstantDB | SpacetimeDB | Appwrite |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| PARTY-01-SEED | P | P | P | P | P | P | P |
| PARTY-02-PUBLIC-PRIVATE | P | P | P | P | P | P | P |
| PARTY-03-INVITE-RSVP | P | P | P | P | P | P | P |
| PARTY-04-ROLES | P | P | P | P | P | P | P |
| PARTY-05-GUEST-LIST | P | P | P | P | P | P | P |
| PARTY-06-CAPACITY | P | P | P | P | P | P | P |
| PARTY-07-LIVE-BURST | P | P | P | P | P | P | P |
| PARTY-08-ASSET | G | P | P | P | G | P | P |
| PARTY-09-SCHEDULE | P | P | P | P | G | P | P |
| PARTY-10-EFFECT-RETRY | P | P | P | P | G | P | P |
| PARTY-11-EFFECT-AMBIGUOUS | P | P | P | P | G | P | P |
| PARTY-12-REVOCATION | P | P | P | P | G | P | P |
| PARTY-13-DEPLOY | G | U | U | U | G | U | U |
| PARTY-14-PERFORMANCE | G | P | P | P | P | P | P |
| PARTY-15-CLEANUP | P | P | P | P | P | P | P |

The shared transactional/auth/realtime core is broadly table stakes. Snapback's
typed roles, capacity settlement, revocation, scheduled work, and explicit
effect certainty pass; native asset bytes, hosted deployment, and the complete
performance path remain gaps. InstantDB's missing file, scheduler, effect,
revocation, and deployment surfaces make this its weakest deep app. All five
other competitors pass every locally testable product scenario.

### Research Room

| Scenario | Snapback | Convex | Supabase | Firebase | InstantDB | SpacetimeDB | Appwrite |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| RESEARCH-01-SEED | F | P | P | P | P | P | P |
| RESEARCH-02-FILES | G | P | P | P | P | P | P |
| RESEARCH-03-OUTSIDER | F | P | P | P | P | P | P |
| RESEARCH-04-KEYWORD | F | P | P | P | P | P | P |
| RESEARCH-05-SEMANTIC | G | P | P | P | G | G | G |
| RESEARCH-06-PROGRESS | F | P | P | P | P | P | P |
| RESEARCH-07-CITATIONS | F | P | P | P | P | P | P |
| RESEARCH-08-COLLABORATOR | F | P | P | P | P | P | P |
| RESEARCH-09-CANCEL | F | P | P | P | P | P | P |
| RESEARCH-10-RETRY | F | P | P | P | P | P | P |
| RESEARCH-11-OUTCOMES | F | P | P | P | P | P | P |
| RESEARCH-12-SCHEDULE | F | P | P | P | G | P | P |
| RESEARCH-13-SECRETS | F | **F/Stop** | P | P | G | G | P |
| RESEARCH-14-PERFORMANCE | F | P | P | P | P | P | P |
| RESEARCH-15-CLEANUP | P | P | P | P | G | P | P |

Snapback's sessions cold-start preflight refuses a generated artifact requiring
`bounded_response_stream_v1` even when the exact process enables outbound
actions. This blocks the deployed app before bind, so twelve downstream
scenarios remain failures rather than code-review passes. The exact binary's
dev-auth streamed-action control passes 8/8, localizing the problem to
capability composition rather than the underlying streaming/settlement model.
Assets and semantic/vector search are separate honest gaps.

Supabase and Firebase pass all 15. Convex passes the application workload but
fails the secret boundary because its official local backend carries a control
credential in argv; the Stop cannot be averaged away. SpacetimeDB lacks native
semantic/vector retrieval and the required native secret boundary. Appwrite
lacks native vector retrieval. InstantDB lacks vector retrieval, scheduling,
the consequent scheduled-secret boundary, and immediate empty-shell deletion.

## Raw authoring and operational cost

The table retains each capsule's reported active minutes and command count.
These are descriptive records, not a synthetic authoring score: worker
instrumentation granularity differs, diagnostics remain charged, and `*`
marks an untimed continuation.

| App / provider | Result | P / G / F / U | Active min | Commands | Confidence |
| --- | --- | ---: | ---: | ---: | ---: |
| Linear / Snapback | complete | 10 / 4 / 0 / 0 | 0.66 | 5 | 14/16 |
| Linear / Convex | complete | 12 / 1 / 0 / 1 | 0.32 | 6 | 14/16 |
| Linear / Supabase | complete | 12 / 2 / 0 / 0 | 34.21 | 10 | 14/16 |
| Linear / Firebase | complete | 12 / 1 / 0 / 1 | 28.23 | 16 | 16/16 |
| Linear / InstantDB | complete | 12 / 2 / 0 / 0 | 16.25 | 6 | 16/16 |
| Linear / SpacetimeDB | complete | 11 / 2 / 0 / 1 | 49.77 | 6 | 14/16 |
| Linear / Appwrite | complete | 12 / 1 / 0 / 1 | 19.46 | 15 | 16/16 |
| Partiful / Snapback | complete | 12 / 3 / 0 / 0 | 46.12 | 8 | 14/16 |
| Partiful / Convex | complete | 14 / 0 / 0 / 1 | 31.03 | 13 | 14/16 |
| Partiful / Supabase | complete | 14 / 0 / 0 / 1 | 41.35 | 6 | 14/16 |
| Partiful / Firebase | complete | 14 / 0 / 0 / 1 | 39.00 | 18 | 15/16 |
| Partiful / InstantDB | complete | 9 / 6 / 0 / 0 | 36.35 | 5 | 13/16 |
| Partiful / SpacetimeDB | complete | 14 / 0 / 0 / 1 | 64.46 | 8 | 15/16 |
| Partiful / Appwrite | complete | 14 / 0 / 0 / 1 | 68.06 | 15 | 15/16 |
| Research / Snapback | product-blocked | 1 / 2 / 12 / 0 | 20.38 | 11 | 8/16 |
| Research / Convex | stopped* | 14 / 0 / 1 / 0 | 13.93* | unavailable | 14/16 |
| Research / Supabase | complete* | 15 / 0 / 0 / 0 | 50.00* | 5 | 14/16 |
| Research / Firebase | complete | 15 / 0 / 0 / 0 | 65.15 | 5 | 15/16 |
| Research / InstantDB | complete | 11 / 4 / 0 / 0 | 17.64 | 7 | 13/16 |
| Research / SpacetimeDB | complete | 13 / 2 / 0 / 0 | 31.54 | 17 | 15/16 |
| Research / Appwrite | complete | 14 / 1 / 0 / 0 | 22.74 | 14 | 13/16 |

Raw inventories, dependencies, failed attempts, glue, build/runtime samples,
and cleanup commands remain in each arm. The largest recurring operational
contrasts were:

- Appwrite's breadth came with 29 local containers, 12 volumes, roughly
  255–268 MB of JavaScript dependencies, stale Function/runtime quirks, and
  the highest cleanup ceremony.
- Supabase supplied excellent SQL, RLS, Storage, Realtime, pgvector, and cron,
  but its Docker topology and configuration/restart seams were substantial.
- Firebase's emulator suite was broad and its offline behavior strongest, but
  indexes/rules/functions and cross-emulator orchestration produced many
  commands and a large dependency tree.
- Convex was the most compact integrated search/vector/scheduler/realtime
  authoring model, but anonymous local provisioning was under-documented and
  its Research Room control-credential exposure is disqualifying.
- SpacetimeDB's reducers/subscriptions were fast and direct but generated
  request/result tables, missing search/vector/secrets surfaces, and server
  lifecycle work added glue.
- InstantDB made hosted identity and reactive relations quick, while absent
  scheduler/effect/vector and lifecycle APIs shifted important behavior into
  application state machines or explicit gaps.
- Snapback was strongest where authority, conflict, revocation, ephemeral
  state, scheduled effects, and ambiguous settlement were exercised together.
  Its external-project setup, incomplete ordinary offline/deploy/search/assets
  path, and the sessions/streaming admission split dominated its costs.

## Correctness and evidence confidence

| App | Snapback | Convex | Supabase | Firebase | InstantDB | SpacetimeDB | Appwrite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Linear | 14 | 14 | 14 | 16 | 16 | 14 | 16 |
| Partiful | 14 | 14 | 14 | 15 | 13 | 15 | 15 |
| Research Room | 8 | 14 | 14 | 15 | 13 | 15 | 13 |

Dimension-level reasons are retained in every capsule and audited in
`deep-round-evidence-audit.md`. The common deductions are honest: no durable
offline claim earns at most one reconnect point; unavailable hosted identity
can reduce target confidence; cleanup without an independent baseline or with
a surviving shell is indirect; stale inventories reduce reproducibility.
Firebase is the only provider with direct offline evidence in every relevant
deep app. No arm receives authority or transport credit from UI rendering
alone.

Two Stops are separated. Supabase's first Research Room target was destroyed
because the builder's redaction failed; the provider did not disclose the
value, and the clean prospective r2 arm is the product result. Convex's local
backend itself supplies a control credential through argv, so
RESEARCH-13-SECRETS remains a provider Stop-class failure; the builder's first
unredacted process proof is recorded separately and contained.

## Five-app synthesis

### Recurring findings

- Realtime database updates are now table stakes. The differentiator is
  authority-aware invalidation, reconnect/offline semantics, and settlement
  under conflict—not whether a callback fires.
- Auth is easiest to trust when actor identity, policy, data mutation, and
  negative outsider evidence are all inspectable. Supabase RLS, Firebase
  rules, InstantDB linked permissions, Convex function gates, Appwrite resource
  permissions, SpacetimeDB reducers, and Snapback's server-derived sessions
  each offer useful but different proofs.
- Files, full-text search, scheduling, secret custody, and hosted deployment
  decide whether an integrated backend remains integrated on richer apps.
  Todo and Chat alone materially understated these boundaries.
- Native effect settlement matters. Snapback's explicit certainty and
  cancellation vocabulary is preference-shaping; providers without it require
  application-authored ledgers and guards even when the happy path looks easy.
- Evidence and cleanup are product experience. Target identity, scoped
  deletion, redacted diagnostics, and reproducible inventories exposed issues
  that visual demos would have missed.

### Provider differentiators

- Firebase: broadest consistent completion and strongest ordinary offline
  client; weaker relational/query ergonomics and operationally broad emulator
  surface.
- Supabase: best conventional relational/search/vector toolbox with inspectable
  SQL/RLS; heavier local operations and no ordinary offline application model.
- Convex: most concise integrated function/realtime/search/vector/scheduler
  path; current local Stop-class credential handling prevents a go-to
  recommendation for Research Room.
- Appwrite: unusually complete self-hostable product suite with strong resource
  permissions and opaque Function secrets; heavy footprint and no native vector
  query.
- SpacetimeDB: strong transactional reducers and realtime performance; search,
  semantic retrieval, secrets, and some request/result ergonomics lag.
- InstantDB: excellent low-ceremony reactive data and temporary hosted targets;
  effects, scheduler, vector search, asset breadth, and deterministic target
  retirement are incomplete.
- Snapback: strongest coherent authority/settlement/local-first design
  potential, but present completeness and cross-feature integration remain
  materially behind the leaders.

### Snapback-native opportunities

1. Resolve every capability requirement from the same instance-live manifest
   in cold start, publication, inspection, and runtime admission.
2. Add native asset bytes with owner/member delivery, deletion, export, and
   cleanup semantics rather than a metadata-only imitation.
3. Make indexed full-text retrieval ordinary and define a native semantic/
   vector outcome that preserves target portability and authorization.
4. Bring protected retention and queued mutation settlement to the ordinary
   generated clients.
5. Turn clean external-project bootstrap and a credible hosted deployment path
   into product surfaces with identity, rollback, backup, and cost evidence.
6. Preserve and amplify server-derived authority, explicit ambiguous-effect
   settlement, cancellation fencing, typed ephemeral state, and
   provider-independent acceptance receipts.

### Architectural rethink triggers and deliberate non-goals

The frozen evidence does not require a fundamental auth or streamed-action
rewrite: the exact runtime already passes the difficult stream, cancellation,
and settlement control, and the failure localizes to inconsistent capability
resolution. A rethink becomes warranted if the repaired sessions path cannot
pass from a clean external project without privileged repository coupling, or
if hosted targets cannot preserve the same authority and settlement contract.

Native files, search/vector retrieval, offline sync, and deployability are
architecture-level roadmap questions, not excuses for provider-shaped wrappers.
Snapback should not add Firebase-shaped documents, Supabase-shaped SQL, or
Convex-shaped actions merely to make fixtures pass. Durable TTL emulation for
ephemeral state, client animation labeled as push, scan-based vectors labeled
as semantic search, and unsafe retry that erases ambiguity remain deliberate
non-goals.

## Second remediation tranche

The schema-valid ledger is
[deep-remediation.v1.json](./deep-remediation.v1.json). The immediate tranche
is intentionally narrow: repair the general instance-live capability
composition invariant and prove it through a clean sessions + streamed-actions
acceptance witness. Assets, indexed retrieval, protected offline clients, and
hosted deployment remain separately prioritized work; none is hidden inside a
fixture-specific Research Room patch.
