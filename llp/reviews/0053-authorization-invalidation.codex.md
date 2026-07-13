# Review: LLP 0053 — Authorization invalidation (Codex / GPT family)

Artifact for the `/llp-super-refine` dual-model refine loop (LLP 0005 review
norms). One dated, numbered section per round; review bodies preserved verbatim.
Orchestrator verification and disposition notes sit outside the verbatim bodies.

This document was split out of LLP 0039 on 2026-07-12; the mechanism's earlier
review history (three failed design attempts) lives in
`0039-auth-vertical-slice.{fable,codex}.md`.

## Round 1 — 2026-07-12

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` at creation (sha256
`f15f285f448ba20b30bb18a4ebcf1ba1874dab44a8f47b0bf16b94981dc67518`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, workdir = repo root. Session id
`019f5783-274a-7500-bce7-679ff7bcec79`; 266,631 tokens used. Fresh session.
**Date:** 2026-07-12
**Redacted:** No secrets in the brief; reviewer instructed not to read
`.agent-local-secrets.md` or `llp/reviews/`, and not to quote secret material.
Sending the document and repository content to an external provider was explicitly authorized by the human invocation of `/llp-super-refine` (LLP 0005 honesty rules).
**Method:** cli-runner — fresh session, blind to the concurrent paired review and
to all archived reviews. The brief supplied the mechanism's three-attempt failure
history and directed the reviewer at the exhaustiveness stress cases.

### Review body (verbatim)

## Overall assessment

The split from LLP 0039 was the right move, and the RFC contains several strong safety ideas. However, attempt 3 is not sound yet.

The four classes are neither exhaustive nor mutually exclusive: they mix result-delivery topology with authorization-write impact. More importantly, the design treats invalidation as a queue event rather than a persistent security obligation. Even perfect handling of class-(b) writes would still miss policy activation, time-based expiry, incorrect declarations, and lost destructive drains. The claim that false negatives are structurally impossible is therefore false.

## Strengths

- Separating result changes from visibility changes is the correct conceptual move. Class (c) identifies the real distinction the two-class model missed: shared rows should use ordinary matcher delivery while ACL changes trigger authorization resubscription (LLP 0053 §The classification model, lines 93–106).

- Always advancing the global epoch for a correctly identified permission-backing write is a good v1 safety floor. It makes incomplete or actor/subject-confused targeting a precision defect rather than a missed revocation (LLP 0053 §Invalidation, lines 119–139; LLP 0011 §Local-First and Realtime Implications, lines 232–255).

- The diagnosis of current epoch machinery is accurate. Epochs are in process memory, advance after commit, clear on reset, and resume compares bare numbers (`src/local.rs:835`, `1003`, `1411–1418`, `3611–3623`, `3700–3719`). Same-transaction durability plus an incarnation addresses real crash and ABA hazards (LLP 0053 §Epochs: durable and incarnation-scoped).

- Replacing the boolean with a monotone disposition is directionally excellent. The RFC correctly notices that queue collapse can erase a previously queued security consequence (LLP 0053 §The invalidation signal, lines 204–232; `src/ephemeral.rs:760–786`).

- The retained-data posture is unusually honest: session-mode retention stays disabled until durable query-scoped invalidation exists; `sessionId`/`provider` scope mismatch is named; and unobserved offline revocation is acknowledged as unavoidable without a lease (LLP 0053 §The retained and offline authorization contract; LLP 0039 lines 705–714; LLP 0043 lines 63–91).

- The no-regression acceptance language correctly distinguishes matcher behavior from DK-3 delivery. Todo is Ibex and ordered, while todo-v2 is ordered HostPlan; both therefore use `live_replace`, not `live_delta` (`demos/todo/snapback/handlers.mjs:8–14`; `demos/todo-v2/snapback/functions.mjs:26–33`; `src/live_matcher.rs:571–579`).

## Concerns

1. **HIGH — The four classes are not a partition and cannot express mixed or transitive authorization safely.**

   Classes (a), (c), and (d) describe how result changes are delivered; class (b) describes whether a table affects authorization. Those are orthogonal axes. A `gameMembers` table used both as the ACL and as a shared roster result is simultaneously (b) and (c). A user-filtered `listMyMemberships` query makes the same table both (a) and (b). “Exactly one” has no valid precedence rule without either losing information or making ordinary roster/status writes globally resync.

   Hierarchical visibility is worse: with `documents(folderId)`, `folders(orgId, name)`, and `orgMembers(orgId, userId)`, changing `documents.folderId` or `folders.orgId` changes authority without writing the ACL. Labeling those tables (c) misses the invalidation; labeling `folders` as (b) makes an ordinary folder-name edit globally resync. This is the material question already admitted in LLP 0053 §Open Questions 2, not optional future polish. LLP 0011 explicitly permits declared relationships in permission rules (lines 148–155).

   The proposed `permissionDependencies: [{ backing, subject }]` shape also does not identify which of several read tables the edge governs, so it cannot actually assign every `(function, table)` pair.

   *Resolves with:* Replace the exclusive classes with at least two independent dimensions: result routing (`row-disjoint | shared | independent`) and authorization impact (`none | backing | routing/relationship`), with field- or mutation-sensitive effects. Define transitive dependency propagation and work a document → folder → organization example end to end, including inline ownership changes and a table that is both result and ACL.

2. **HIGH — Classification prevents missing labels, not missing or false authorization dependence.**

   LLP 0053 defines an auth-scoped function only through structured `AuthUserId`, `authScopeField`, or `permissionDependencies` (lines 84–91). Opaque Ibex handlers can read `ctx.auth` directly. The shipped todo does so, while `authScopeField` is a separate manual declaration (`demos/todo/snapback/handlers.mjs:8–14`; `demos/todo/snapback/functions.mjs:23–30`; `packages/snapback-codegen/define.mjs:286–312`). Omitting that declaration leaves an accurate table read summary but bypasses the entire classification/global-epoch rule.

   Runtime capture cannot currently prove access: it records a user-id auth dependency for every authenticated Ibex invocation, whether or not auth was read, and does not capture `sessionId` or `provider` (`src/runtime.rs:454–478`, `1821–1839`).

   Incorrect labels remain equally dangerous. A permission-routing table marked `authorityIndependent`, or a missing class-(c) backing edge, produces no epoch because only class (b) bumps. Only class (a) gets a proposed debug assertion, and debug/test convergence is not a production proof. The shipped L4 analogue is debug-only, runs after HostPlan delta emission, and compares membership IDs rather than authorization disposition (`src/local.rs:3528–3570`).

   The unexpected-read safety net is also underspecified: if its conservative table taint lives only with a subscription, reaping that subscription before the next write loses the protection.

   *Resolves with:* Treat every opaque live/retainable function that can observe `ctx.auth` as auth-scoped unless authority-independence is machine-proved. Add an explicit authority-dimension declaration and observed-access validation, or refuse opaque undeclared dependence. Every unproved no-bump assertion must fall back conservatively in production. Unexpected-read taint must be application-level, installed before publishing the snapshot, and survive subscription GC until corrected metadata activates.

3. **HIGH — Permission changes are not limited to class-(b) data writes.**

   Hot authorization-policy activation can revoke visibility with no data write. Today `load_functions` replaces executable functions while leaving subscriptions and epochs untouched (`src/local.rs:952–983`). Schema and function manifests also activate independently; `ensure_app` applies schema before loading functions, with no rollback of the schema half if cross-manifest function validation fails (`src/local.rs:1068–1112`; standalone endpoints at `src/server.rs:1642–1664`). Narrowing an auth filter can therefore strand already-published rows.

   Time-based grants are another concrete counterexample. `RuntimeNow` is expressible and SQL evaluation supplies the current time, while the matcher has no clock or deadline wake (`src/value_expr.rs:142–145`; `src/storage.rs:1402–1412`; `src/live_matcher.rs:428–442`). An `expiresAt > now` membership can expire while a live client retains access indefinitely. The RFC’s `authorizedUntil` discussion only addresses offline retention.

   *Resolves with:* Define the complete invalidation-event universe. Auth-relevant schema/function/classification metadata must stage and validate as one bundle, then atomically rotate/bump and issue delete obligations on activation—or require a restart that does so. Time/external-state-dependent authorization must either be forbidden for syncable queries or captured as a scheduled deadline dependency. Add no-data-write tests for policy narrowing and grant expiry.

4. **HIGH — The disposition remains an at-most-once queue event, so delivery loss can erase it permanently.**

   `OutboundQueue::drain` destructively removes all messages before delivery (`src/ephemeral.rs:910–923`). HTTP drain is explicitly destructive (`src/server.rs:2461–2475`), and WebSocket delivery drains the whole batch before sending, abandoning the remainder after a send failure (`src/server.rs:2243–2257`). After an epoch change, the server skips the stale subscription on later fan-out (`src/local.rs:3323–3325`). Thus a lost HTTP response containing the sole delete message leaves the client’s unauthorized rows indefinitely. A lost reset sentinel has the same problem after the subscription was removed.

   Queue collapse also has two unhandled orderings. The message that triggers overflow is not inspected, and every later durable message is ignored while `overflowed` (`src/ephemeral.rs:884–890`). Therefore a delete that triggers collapse, or arrives after a sticky retain sentinel, can be weakened. LLP 0053 acceptance tests only delete-then-overflow.

   This security requirement supersedes LLP 0032 P4’s earlier decision that destructive loss needs no acknowledgement because a later snapshot recovers it (lines 1228–1256).

   *Resolves with:* Make invalidation a persistent, level-triggered `ResyncObligation`, not an ordinary outbox message. Store its scope, authorization witness, and maximum disposition until a successful superseding snapshot or explicit acknowledgement clears it; queue frames become wakeups. Maintain typed maximum-disposition metadata while overflowed. Test lost HTTP responses, mid-batch WebSocket failure, reset loss, the overflow-triggering message, both event orderings, and repeated escalation.

5. **HIGH — Query deletion is not fenced against stale callbacks or retained-store writes.**

   The RFC names a query-scoped delete primitive but not a durable query generation or tombstone. Current retention writes are fire-and-forget; `writeServerRows` starts the retained write before checking disposal, and `putRetainedQuery` overwrites unconditionally (`packages/snapback-contract/index.mjs:418–440`; `client-store.mjs:140–150`). A callback begun before invalidation can therefore repopulate a query after deletion.

   LLP 0039’s authority-epoch fence does not expressly solve a permission change under the same authority. Current durable dispatch also invokes consumers synchronously without awaiting them, while resubscribe starts via `void resubscribe(...)` (`demos/_kit/client.mjs:542–559`, `808–815`, `1568–1573`). That cannot enforce “durable clear completes before resubscribe.”

   *Resolves with:* Persist a per-query authorization fence atomically with quarantine/delete. Every callback, optimistic reconciliation, snapshot application, and store write must carry its expected fence and fail if stale. Define a serialized asynchronous coordinator barrier that hides live rows, removes affected overlays, commits the durable transition, and only then permits resubscription.

6. **MEDIUM — Same-transaction epoch advancement lacks a complete write-path design.**

   HostPlan and Ibex commit in different storage paths, and `LocalSnapback` sees their changes only after commit (`src/storage.rs:708–725`, `1045–1094`, `1180–1199`, `1275–1295`; `src/local.rs:1380–1424`). `ChangedRow` carries only one row image; updates contain the post-update row, so old/new subject derivation cannot be added to the current post-commit layer (`src/storage.rs:59–67`, `1224–1247`).

   Seed uses a third direct transaction and performs no epoch processing (`src/storage.rs:551–594`; `src/local.rs:1151–1154`). The same issue will apply to admin edits, imports, and future system writers unless the design explicitly centralizes them.

   *Resolves with:* Define one transactional commit hook used by every writer. It must classify actual changed tables/fields, capture old and new subject values, deduplicate scopes, and update a single durable `AuthorizationVersion { incarnation, epochs }` before commit. Publish and compare that object atomically on both write and read lanes. Acceptance must cover HostPlan, Ibex, seed, admin/import, reset, and rollback.

7. **MEDIUM — The disposition and compatibility semantics are incomplete.**

   `retain`, `quarantine`, and `delete` are ordered but not defined as client state transitions. The RFC does not specify their effect on live rows, retained records, optimistic overlays, pending/failed mutations, in-flight callbacks, or a connection-wide sentinel that has lost query identity. No listed reason currently emits `quarantine`, so its purpose is unclear.

   The boolean projection is wire-compatible, not behavior-compatible: the shipped kit ignores `clear_retained`, and an old server’s overflow always sends true without knowing whether it swallowed an authorization event (`demos/_kit/client.mjs:808–815`; `src/ephemeral.rs:773–785`). Legacy retained records also lack an incarnation and must have an explicit migration outcome.

   *Resolves with:* Add a state-transition matrix for every disposition and state component, define connection-wide scope, and specify the old/new server × old/new client rollout. Pin fail-safe handling for absent disposition/incarnation and a minimum client capability before session-mode retained reads can enable. If quarantine has no v1 producer or distinct semantics, remove it for v1.

8. **MEDIUM — Targeted scope keys and coalescing are not defined coherently.**

   Subject bumps are described as `User(Arg(...))` or `permissionSubjectField` derivation, while class-(c) subscriptions capture a backing-table-namespaced subject scope (LLP 0053 lines 122–148). The RFC never states whether a backing write emits `user:<id>`, a backing-qualified key, or both. Current code only knows `user:<id>` (`src/local.rs:3759–3761`). Raw `Arg`/`Literal` values also need collision rules.

   The claimed per-subscription coalescing bound is not designed either; the durable lane currently appends every message until overflow (`src/ephemeral.rs:718–727`, `884–892`).

   *Resolves with:* Specify a typed, collision-safe scope-key schema and exact attachment/emission/coalescing matrix. Alternatively, simplify v1 to one durable global epoch and compute subject scopes only in shadow diagnostics until coarse suppression is approved.

9. **MEDIUM — Two matcher claims are inaccurate enough to risk a regression.**

   LLP 0053 says declaring a shared table row-scoped would make the matcher skip other players’ writes. On the normal shipped Ibex path, captured dependencies are consulted first and their verdict returns before the static `authScopeField` fallback; the fallback is reached only when there is no captured Query dependency (`src/live_matcher.rs:112–152`, `193–220`). Ibex query calls capture their QueryPlan, and subscriptions retain those dependencies (`src/runtime.rs:643–647`; `src/local.rs:1586–1637`). A same-game move therefore normally wakes the subscription despite a bad static declaration.

   Also, shipped `authScopeField` is not generic: the fallback recognizes only metadata equal to `"userId"` and then hardcodes the row field `"userId"` (`src/live_matcher.rs:139–146`).

   *Resolves with:* Rewrite the rationale to distinguish captured-dependency behavior from the static fallback. Pin that class metadata may never override captured Row/MissingRow/Query dependencies. Either restrict v1 `authScopeField` to `userId` or implement the configured field with insert/delete/scope-moving-update tests.

## Suggestions

- Replace the nominal four-class model with two explicit dependency lanes: `ResultDependency` and `AuthorizationDependency`. A table may appear in both.

- Consider a structured `ctx.permissions.requireMembership(...)` or authorization-witness API. It could record backing rows, relationship edges, authority dimensions, and deadlines directly instead of reverse-engineering arbitrary JavaScript.

- Ship the smallest safe v1: durable global epoch, persistent delete/retain obligations, and query fences. Keep subject inference in shadow mode and add targeted epochs only when their suppression proof exists.

- Add a reference “full re-query plus full authorization re-evaluation” oracle and property-test it against randomized writes, deployments, expiry events, overflow, disconnect, response loss, restart, and stale callback interleavings.

- Put worked manifests in the RFC before acceptance: todo; a roster table that is both ACL and result; inline ownership transfer; document/folder/org hierarchy; and an expiring grant. The card-game manifest does not yet exist in the repository, so prose examples alone are not evidence of exhaustiveness.

- Limit mandatory invalidation classification to live/retained/auth-resyncable functions. LLP 0008 deliberately preserves online-only execution as the safe escape hatch for opaque queries.

## Open questions

- Is application-auth metadata a trusted assertion, or must Snapback prove it before granting live/retained capability?

- Which fields and mutation forms may change authorization, and are visibility-routing fields allowed to be mutable?

- What is the complete set of invalidation sources: data writes, bundle activation, schema changes, clock deadlines, provider claims, configuration, imports, and restores?

- What exact acknowledgement or supersession event discharges a server-side invalidation obligation?

- Does `quarantine` have a distinct v1 use, and what data remains recoverable or readable after it?

- Should ordinary process restart rotate the incarnation and force every retained query to resnapshot, or should a durable incarnation survive restart and rotate only at logical stream boundaries?

- How will the same atomic authorization-version and persistent-obligation contracts work on the Cloudflare coordinator?

## Readiness verdict

Verdict: NOT READY

The proposal has a strong safety direction, but unresolved correctness gaps remain in classification, non-write invalidation, delivery durability, and client fencing. In its current form, a real application can lose authorization without a class-(b) write, and a correctly generated delete obligation can still be permanently lost or later undone. These are material false negatives under LLP 0008 and LLP 0011, so the RFC should not advance until the classification model becomes orthogonal and the invalidation mechanism becomes persistent and fenced end to end.
### Orchestrator verification notes — round 1 (outside the verbatim body)

Both families independently concluded the four-class model is **not
exhaustive**, and between them produced **three distinct real app shapes it
cannot express**. Every decisive claim was spot-checked and verified:

- **The classes conflate two orthogonal axes** (GPT family). Classes (a)/(c)/(d)
  describe *result-delivery topology*; class (b) describes *authorization write
  impact*. A `gameMembers` table is simultaneously the ACL and a shared roster
  players read — "exactly one class" is incoherent.
- **Authorization changes with no class-(b) write.** Re-parenting
  `documents.folderId` changes visibility without touching the ACL; hot function
  reload replaces executable functions with subscriptions and epochs untouched
  (`load_functions`, `src/local.rs:952-983`); `RuntimeNow` is expressible in
  filters (`src/value_expr.rs:142-145`) while the matcher has no clock or
  deadline wake, so an `expiresAt > now` grant expires with **zero writes** and a
  live client retains access indefinitely. All are false negatives, which LLP
  0008 pins as correctness bugs.
- **A third unclassifiable shape** (Claude family): row-authorized shared
  visibility — "my docs OR public docs", link-shared rows, `status='published'` —
  is authorized by fields *on the row* with no backing table. Class (a) is a lie
  (rows aren't user-partitioned), (b) is the attempt-1 storm, (c) has no backing
  table, (d) is false.
- **The document's own matcher rationale is wrong.**
  `live_subscription_may_be_affected` consults **captured dependencies first**
  and returns their verdict; the static `authScopeField` path is only a fallback
  when no captured dependency exists (`src/live_matcher.rs:112-126`). The claimed
  "declaring a shared table row-scoped makes the matcher skip other players'
  writes" does not hold on the normal captured-dependency path.
- **`authScopeField` is hardcoded to literally `"userId"`**
  (`src/live_matcher.rs:139-146`) — not a general configurable field as the
  document assumes.
- **Invalidation-as-a-queue-message can be permanently lost.**
  `OutboundQueue::drain` destructively pops every message
  (`src/ephemeral.rs:910-923`), HTTP drain is destructive
  (`src/server.rs:2461-2475`), and once `overflowed` is set, subsequent pushes
  early-return as no-ops until drain (`src/ephemeral.rs:884-893`) — so a `delete`
  arriving *while already overflowed* is silently dropped and cannot escalate the
  parked sentinel. The round-1 sticky-OR covered only delete-then-overflow, not
  overflow-then-delete.
- **`permissionSubjectField` old/new derivation is not implementable** on the
  current layer: `ChangedRow` carries a single row image plus `changed_fields`
  (`src/storage.rs:59-67`), not an old/new pair, and epochs advance *after* the
  durable commit.
- **Internal contradiction:** the round-1 text regenerated the incarnation "on
  restart" while claiming epochs are "trustworthy across restart" — the two
  cannot both hold, and it contradicts LLP 0039's operator-declared restore
  design.
- **Undeclared 0011 divergence:** 0011's ratified rule clears "*for sensitive
  retained slices*"; the round-1 text mapped every permission-epoch change to an
  unconditional `delete` across all slices.
- The ABA example was imprecise (`resume_requires_resnapshot` compares with `!=`,
  so 0→1→reset→0 *is* caught today; the real ABA needs re-advancement).
- Both families note the card-game proving demo **does not exist in the repo**,
  so class (c) was validated only in prose — the same way attempt 2 died.

**Disposition (2026-07-12, revision 2 — attempt four).** The classification
taxonomy is **abandoned**, not patched: three unclassifiable shapes from two
independent reviewers is evidence the enumeration can never be exhaustive. The
redesign takes the reframe both reviews imply — the matcher already re-applies
authorization on re-query, so *live* correctness needs no taxonomy — and reduces
epochs to what the matcher genuinely cannot observe (staleness across
disconnection, retained-data destruction, and writeless authorization events).
Applied: two orthogonal declarations replacing four exclusive classes; an
**enumerated, closed authorization-event universe** with a conservative fallback
(opaque or unenumerable auth dependence ⇒ non-retainable, LLP 0008's sanctioned
online-only escape hatch); a persistent **level-triggered obligation** replacing
the loseable queue message; per-query durable client fences; one transactional
commit hook across every writer; the incarnation persisted across ordinary
restarts (regenerated only on reset/import/declared restore, matching 0039);
clock-dependent authorization forbidden in retainable queries rather than
half-solved; the 0011 live-vs-retained clearing divergence resolved in 0011's
favor; field-granular `permissionFields` adopted; subject targeting demoted to
**shadow mode** entirely (which also moots the unimplementable old/new
derivation, the scope-key collision design, and the coalescing design); and
worked classifications of todo, todo-v2, mine-OR-public, hierarchical
document/folder/org, mixed ACL+result roster, and the card game carried **in the
document** rather than deferred to implementation.

## Round 2 — 2026-07-12 (attempt four: the taxonomy-free reframe)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` (sha256
`ce46cb2a6b687a0eb261d15875115b952955310382f7ca31bfe1ecce89fab915`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`. Session id `019f5798-9a47-78a3-8089-85977378b989`. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as round 1.
**Method:** Same as round 1 — shared brief carrying the four-attempt failure
history, directing the reviewer to attack the reframe itself, the event-universe
closure claim, the online-only fallback, the obligation model, and the worked
classifications. Blind to the concurrent paired review and to all archived
reviews.

### Review body (verbatim)

## Overall assessment

Attempt 4 is a substantial conceptual improvement: abandoning exclusive table classes removes the expressiveness failure that doomed attempts 2 and 3. For deterministic authorization expressed entirely through captured database reads, the matcher can indeed handle mixed ACL/result tables, row-local sharing, and hierarchical joins without classifying each table into one shape.

However, the proposal is not sound yet. Its reframe proves, at best, that the server may wake and recompute a connected query. Authorization correctness also requires the resulting removal to survive fan-out errors, destructive drains, overflow, reconnect, stale callbacks, and durable-store races. Matcher-only authorization changes receive none of the persistent obligations introduced for enumerated events, so the exact queue failures motivating the obligation model can still strand forbidden rows. The “online-only” fallback likewise prevents persistence but does not prevent a live or disconnected client from continuing to render stale rows.

The fifth failure is therefore not another missing table class. It is that authorization significance exists in delivery and client-state transitions, not only in event detection and query evaluation.

## Strengths

- The failure history in §Motivation is unusually valuable. It explains why extending the four-class taxonomy again would be the wrong response and makes the new direction reviewable against concrete counterexamples.

- §Two orthogonal declarations correctly separates result-delivery topology from permission-event production. Allowing `gameMembers` to be both query input and permission backing is much cleaner than forcing it into one exclusive class.

- §The authorization version makes two sound corrections to the shipped implementation: the version becomes durable and advances transactionally, and the incarnation survives ordinary restart while changing across destructive boundaries. This directly addresses the current post-commit, process-memory epoch updates in `src/local.rs:1380–1425,3611–3623` and the independent seed path in `src/storage.rs:551–583`.

- §Invalidation is an obligation, not a message correctly diagnoses the existing transport. Destructive drain, drain-before-WebSocket-send, and sticky overflow are confirmed in `src/ephemeral.rs:760–923` and `src/server.rs:2243–2257,2461–2475`. Treating security consequences as persistent levels rather than queue entries is the right direction.

- §Client fences identifies a real shipped race: retained writes are fire-and-forget before disposal is checked, and `putRetainedQuery` overwrites unconditionally (`packages/snapback-contract/index.mjs:418–440`; `client-store.mjs:140–150`). A serialized coordinator and fail-closed store API are necessary.

- §Retained and offline authorization is appropriately honest that an offline device cannot be remotely erased and that `authorizedUntil` must be decided before retained session-mode reads ship.

- Keeping subject targeting in shadow mode is prudent. Imprecise targeting cannot create a v1 false negative while no correctness decision depends on it.

## Concerns

1. **HIGH — The central reframe covers computation but not fail-closed delivery.**

   §What invalidation is actually for and §Worked classifications make `public → private` and document reparenting ordinary writes with no authorization event or obligation. If the matcher re-query removes the row but its `live_replace` is lost, the client remains unauthorized yet still holds the old result.

   This is not hypothetical. HTTP drain destructively removes the batch before the response is known to have reached the client (`src/ephemeral.rs:910–923`; `src/server.rs:2461–2475`). WebSocket delivery drains the complete batch before sequential sends (`src/server.rs:2243–2257`). Overflow drops later durable pushes while sticky (`src/ephemeral.rs:884–892`). LLP 0032 §S5.D5 deliberately accepted these losses only because a fresh snapshot recovers ordinary data.

   A lost HTTP response is especially direct: the server has popped the removing update; the client sees a failed poll, but the next empty drain can look healthy. Because the visibility change did not advance the authorization version, no level-triggered authorization obligation re-fires.

   Re-query failure is another connected counterexample. LLP 0011 §Authorization Model permits function-level authorization checks. After reparenting, a query may now throw permission-denied rather than return an empty result. `src/local.rs:3368–3375` treats that as fan-out failure and `src/local.rs:3573–3604` emits a substitute resync. LLP 0053 classifies fan-out retry as `retain`, explicitly allowing the forbidden old rows to remain rendered.

   *Resolves with:* Any delivery uncertainty for a potentially authorization-sensitive result must be at least `quarantine`, with retained state deleted or durably quarantined, until a sufficiently new authorized snapshot is atomically applied. `retain` is safe only for a view proved authority-independent. Add fault-injection acceptance combining `public → private` and hierarchy reparenting with query denial, serialization failure, lost HTTP response, overflow, and mid-batch WebSocket failure.

2. **HIGH — “Online-only” does not confine clock-dependent or opaque authorization.**

   §The authorization-event universe correctly observes that `expiresAt > RuntimeNow` can expire without a write and leave a live client authorized indefinitely. Making the query “online-only” does not solve that fact.

   LLP 0012 §Capability Manifest distinguishes callable-online, live-replace, syncable-live, offline-retained, and auth-resyncable as independent capabilities. LLP 0008 §Subscription Contract expressly permits online live replace/resnapshot queries outside the retained subset. The shipped subscribe gate checks only `FunctionKind::LiveQuery`, not the syncability class (`src/local.rs:1571–1584`).

   Nor does non-retainable mean “unavailable when disconnected.” The kit keeps `handle.rows` and merely marks the connection stale after loss (`demos/_kit/client.mjs:1026–1061`); the Contract adapter re-emits connection state without clearing its boundary (`packages/snapback-contract/index.mjs:446–471`). Opaque or clock-authorized rows can therefore remain visible in memory offline.

   *Resolves with:* Define the fallback precisely. Writeless or unenumerable authorization must be one-shot/non-subscribable, or it must have a deadline/periodic authoritative wake and a client lease that hides at expiry. If “online-only” remains subscribable, it must quarantine immediately on connectivity loss and fence all late callbacks. Merely disabling durable retention is not a security boundary.

3. **HIGH — The authorization-only witness cannot fence matcher-only visibility changes.**

   `ResyncObligation.witness` and the per-query fence contain only `(incarnation, epoch)`. That value deliberately does not change for matcher-only authorization changes such as `public → private` or `documents.folderId` reparenting.

   A stale retained write can therefore proceed as follows: write W0 containing a public document starts at epoch E; the matcher processes `public → private`; write W1 stores the removing result, still at E; W0 completes last and passes the unchanged authorization fence, repopulating forbidden bytes. This is precisely possible with the current fire-and-forget retention and unconditional store overwrite cited in §Client fences.

   The same missing dimension affects obligation discharge. `retain` producers such as overflow and fan-out retry represent a missing data commit, not an authorization-epoch change. A snapshot taken before that commit can have a satisfying authorization pair while still being too old. The current client already needed a separate `resubscribeDemandEpoch` to prevent an in-flight snapshot from swallowing a one-shot overflow signal (`demos/_kit/client.mjs:693–702,834–847,909–941`).

   *Resolves with:* Make both fences and obligations composite: authorization version, minimum data/stream version, and coordinator or subscription generation. Durable writes must atomically reject lower data versions and superseded generations even when the authorization epoch is equal. A snapshot may discharge only when it meets both authorization and data witnesses.

4. **HIGH — The persistent obligation state machine is not specified sufficiently to survive the named failures.**

   “It is stored” does not define the storage location, durable key, transaction boundary, or how a wakeup is regenerated. Subscription and connection identifiers cannot be the only keys: disconnect destroys both subscriptions and outboxes, and reconnect deliberately creates a fresh subscription rather than resuming one (LLP 0008 §Realtime Delivery; LLP 0032 §P4).

   The RFC also does not define how:

   - a subscription obligation transfers to a fresh subscription;
   - subscription, connection, and client obligations join;
   - one connection-wide snapshot discharges several query obligations;
   - a lost HTTP response causes the next drain to synthesize another wakeup;
   - obligations survive restart without leaking forever;
   - a weaker later event updates the witness while preserving an earlier `delete`;
   - an acknowledgement racing a newer obligation becomes a no-op.

   “Successful superseding snapshot or explicit acknowledgement” is unsafe as written. Server-side computation, enqueue, send success, or HTTP response completion proves neither client receipt nor atomic client application. Allowing any of those to discharge recreates the lost-response bug.

   A bare version pair also loses disposition history: §Dispositions makes reset and restore `delete`, while §Retained and offline authorization maps a boot/reconnect pair mismatch to quarantine followed by snapshot-and-release. The client cannot infer the required maximum disposition from the pair alone.

   *Resolves with:* Specify a durable invalidation ledger or stable client/query obligation record containing obligation identity, maximum disposition, authorization witness, minimum data version, and scope. Every drain, handshake, and fresh subscribe must project the outstanding level. Discharge should require an authenticated client acknowledgement after the disposition and snapshot commit atomically, using compare-and-clear against the exact current obligation. Persist a disposition watermark so reset/restore mismatches still require deletion.

5. **HIGH — The declaration model still contains silent false-negative channels.**

   §What invalidation is actually for says `authScopeField` is the only declaration capable of causing a false negative. It is not. Omitting `permissionBacking`, omitting a relevant `permissionField`, or failing to attach the global version to a query can suppress the event, retained deletion, and reconnect mismatch just as completely.

   The terminology is internally inconsistent. “Authorization dependence” is defined as whether a table change can alter who may see what, yet the worked table labels `docs.public` and `documents.folderId` as authorization dependence `none`, although those fields directly alter visibility. The declaration really means something closer to “produces a coarse authorization event.”

   The consumer side is also undefined. Which subscriptions carry the global version? Current code adds a `user:<id>` permission dependency to every authenticated query and none to anonymous queries (`src/local.rs:3931–3959`). That would miss an anonymous/public view narrowed by function activation. The worked `mine-OR-public` row says dependence is `none`, while the invariant says retainability requires declared authorization dependence.

   `permissionFields` also needs operation-specific semantics. Deletes currently have empty `changed_fields`, and journal-reconstructed changes have unknown/empty fields (`src/storage.rs:1250–1269,2261–2298`). A simple intersection test can miss deletion of an ACL row. The example additionally lists `role` and `expiresAt`, while the proposed expiry sweep flips `active`; that sweep would be filtered out unless authors happened to list the extra field.

   *Resolves with:* Rename the producer property and define it precisely. Every live subscription and retained slice should carry the global version by default, including anonymous/public views, unless authority independence is proved. Retainable/auth-resyncable queries with undeclared or opaque authorization inputs must fail manifest load, not merely produce a doctor warning. Inserts, deletes, and updates with unknown field information must always fire for a permission-backing table; field filtering may optimize only known updates whose changed fields are provably disjoint.

6. **HIGH — The authorization-event universe is not closed.**

   A concrete fifth source is activation of new authorization evaluator semantics in a Snapback binary/runtime upgrade. Event 2 covers schema, functions, and authorization metadata, but not a change to filter, null, collation, matcher, or `ctx.auth` evaluation semantics. Ordinary restart preserves the authorization pair, so retained data produced under the old evaluator can remain trusted. The repository already exposes binary build identity (`src/identity.rs:29–70`), but it is not coupled to authorization validity.

   More fundamentally, event enumeration is the wrong closure boundary for invocation-varying inputs. `RuntimeId` is valid in the same query expression profile as `RuntimeNow` (LLP 0051 §Context; `src/manifest.rs:845–887`). Ibex warm VMs also deliberately preserve module-level closure state (LLP 0009 §Invocation Isolation). Either can alter an opaque authorization decision without a database write, deadline, or policy activation.

   The “one hook used by every writer” boundary is also incomplete while LLP 0004 §Summary retains raw SQL and direct table writes as escape hatches. An application-level Rust hook cannot observe an external SQLite/Postgres writer unless those paths are prohibited, gated, or intercepted in the database.

   Finally, authority transitions and ephemeral authorization need explicit partitioning. LLP 0039 owns logout, expiry, revocation, and user/session transitions through `AuthCoordinator`; LLP 0013 requires durable permission changes eventually to remove or resync affected ephemeral subscribers, while LLP 0026 records that this event is still unowned.

   *Resolves with:* Replace the informal event list with a closed-input theorem: a continuously subscribed or retained authorization decision may depend only on stable args, connection-fixed authority, captured database reads, and content-addressed policy/evaluator semantics. Every other host input must provide a wake/version witness or force one-shot execution. Persist an authorization-semantics ABI/digest and advance the version when it changes. Define the supported writer boundary and explicitly delegate authority transitions and ephemeral behavior to named fail-closed contracts.

7. **HIGH — The matcher safety argument does not match the shipped matcher.**

   The RFC says the default is “any change to a read table wakes,” other-user changes skip only through `authScopeField`, and the re-query is the authorization check. The code has two additional load-bearing behaviors:

   - Captured dependencies are consulted first, and their `Some(false)` verdict immediately wins (`src/live_matcher.rs:121–125,158–220`). This can skip without `authScopeField` and bypasses the static read summary.
   - Eligible unordered HostPlan queries use DK-3 `live_delta`, deliberately performing no re-query (`src/live_matcher.rs:544–663`; `src/local.rs:3420–3537`). Only debug builds run a convergence re-query.

   The captured-dependency path has already produced a permanent-staleness bug when point reads were omitted; the code comments at `src/live_matcher.rs:163–168` and LLP 0020’s 2026-07-07 implementation note document that correction. This does not mean the current path is wrong, but it disproves the claim that only a lying `authScopeField` needs parity protection.

   The worked rows need corresponding corrections:

   - Todo’s behavior is accurate, but the captured `userId` query normally decides before its static `authScopeField`.
   - Todo-v2 has no `authScopeField` and still skips other users through its HostPlan predicate, directly contradicting the sole-opt-in claim.
   - `mine-OR-public` is not expressible in the current conjunctive HostPlan filter and needs a concrete Ibex fixture; captured predicates may safely skip some doc writes, so “any doc write wakes” is false.
   - The hierarchy fixture must prove both visible→hidden and hidden→visible paths through the actual captured dependencies, not merely assert that `docs` appears in the static read set.
   - Mixed-table insert/delete/unknown-field cases are missing.

   *Resolves with:* State the invariant as “full re-query or an equivalence-proved delta transition.” Enumerate every skip proof and require capture-completeness plus matcher-versus-full-requery convergence coverage for all authorization-sensitive skip paths, not only `authScopeField`. Carry concrete fixtures for every worked row and assert the exact matcher path used.

8. **HIGH — Client rollout and offline mismatch do not preserve the required disposition.**

   The RFC bars disposition-oblivious old clients only from session-mode retained reads. That is too narrow: `quarantine` requires live rows to hide immediately. The shipped client ignores `clear_retained` and any disposition, responding to `resync_required` only with `void resubscribe(...)` (`demos/_kit/client.mjs:808–815`). The server source explicitly notes that no shipped client reads the boolean (`src/ephemeral.rs:773–775`). Such a client can continue rendering revoked live rows throughout a failed or slow resubscribe.

   There is also a rollout mismatch in the opposite direction: current overflow emits `clear_retained: true`, while the proposed compatibility projection would make ordinary `retain` overflow false. That wire behavior must change deliberately rather than being described as already aligned.

   Finally, a generic pair mismatch cannot distinguish a coarse live quarantine from reset/restore deletion. Quarantine-and-release after snapshot cannot satisfy a prior requirement to destroy retained bytes.

   *Resolves with:* Require disposition/coordinator capability for every session-mode authorization-scoped live subscription, not only retained reads, or define a safe legacy forced-close/full-clear path. Version the wire behavior explicitly. On retained boot, unknown or pruned disposition history must fail closed to `delete`, not release quarantined bytes after a snapshot.

9. **MEDIUM — The governing LLPs do not yet agree with the reframe.**

   LLP 0011 §Local-First and Realtime Implications ratifies server-directed resubscribe specifically because universal mid-connection permission re-evaluation was not a v1 assumption. LLP 0053 says LLP 0011 wins, but now relies on matcher re-evaluation for ordinary authorization-changing writes.

   LLP 0039 §Permission dependencies still describes a classification model, says only permission-backing writes are permission-affecting, and claims this preserves LLP 0011. Its landing order likewise still calls LLP 0053’s deliverable a classification lint. LLP 0043’s shipped retained store does not yet carry the proposed durable incarnation/fence or query-scoped deletion primitive. LLP 0013/0026 still leave durable-to-ephemeral authorization revocation unowned.

   These may all be reconcilable, but acceptance of LLP 0053 while they remain contradictory would leave implementers with multiple plausible authorities.

   *Resolves with:* Amend LLP 0011’s ratified wording to distinguish matcher-observable result/visibility changes from permission-backing, authority, and writeless events. Reconcile LLP 0039’s seam and landing order, register the new client/store/wire shapes in LLP 0012/0043, and explicitly preserve or close the ephemeral capability gap.

10. **MEDIUM — The global blast-radius gate is not decision-ready.**

   A routine membership write quarantines every authorization-scoped live view and deletes every authorization-scoped retained slice globally. Under the card-game workload, joins/leaves can therefore become a cross-application availability and storage-amplification vector even when no attacker can read data.

   §Acceptance says the disruption will be “measured and bounded,” but defines neither an acceptable bound nor retained-cache destruction, store write amplification, offline availability, or adversarial churn as measurements. It also suggests N clean shadow observations as a candidate for narrowing; observations can build confidence but cannot prove subject completeness.

   *Resolves with:* Set explicit quantitative gates for unrelated live quarantine, resnapshot traffic, retained deletion, and churn-induced availability loss. Consider table-scoped authorization versions as a mechanically complete intermediate step between one global epoch and subject targeting. Permit subject suppression only from a structural proof or closed derivation over old/new rows; keep N-observation evidence diagnostic-only.

## Suggestions

- Model admission as a `WakeContract` rather than a table class:

  `captured database inputs + authority generation + artifact/evaluator generation + optional next deadline + delivery continuity witness`.

  A live authorization-sensitive query is admitted only when every mutable input contributes a wake or version.

- Prefer a durable invalidation ledger over individually persistent server-side client obligations. Each entry can carry authorization version, minimum data version, scope, and disposition; a pruning floor conservatively means `delete`. Clients present their last atomically applied witness on every handshake.

- Add table-scoped authorization versions before subject-scoped versions. They are mechanically complete, avoid most unrelated global invalidation, and do not require solving old/new user targeting.

- Make the oracle report not only convergence but its proof path: which captured read woke or skipped, whether a delta or re-query ran, the data/auth witnesses, and why a disposition was selected. That will make shadow-mode evidence diagnostically useful.

- Extend LLP 0010’s deterministic fault harness with a cross-product of authorization changes and `dropNextMessage`, lost response, reordered callback, overflow, restart, and store failure. Avoid tests that prove only the happy re-query.

## Open questions

- What exact query-level declaration or derivation proves that a result is authority-independent and may safely use `retain` during delivery uncertainty?

- Are opaque or clock-dependent functions one-shot only, or will v1 support deadline-driven live authorization? What precisely does “online-only” mean for already-rendered memory after connection loss?

- What composite witness identifies a satisfying snapshot: authorization version, app stream/version, subscription generation, artifact/evaluator digest, and disposition?

- Where are obligations stored, how are they keyed across fresh subscriptions and multiple devices, and what exact client acknowledgement discharges them?

- Does every live and retained query carry the global authorization version by default, including anonymous/public queries? If not, what proves the opt-out safe?

- What stable digest represents authorization evaluator semantics across server upgrades?

- What `authorizedUntil` default bounds offline exposure, and does expiry hide, quarantine, or destroy retained bytes?

- Are raw SQL/direct writes prohibited for permission-bearing tables, or will database-level hooks make them participate in authorization versioning?

- Does LLP 0053 deliberately exclude ephemeral subscriptions for v1, preserving LLP 0039’s fail-closed room gap, or must authorization events revoke them too?

- What quantitative global-invalidation cost is acceptable before table- or subject-scoped targeting becomes a prerequisite rather than an optimization?

## Readiness verdict

Verdict: NOT READY

The taxonomy-free reframe is worth preserving, but the current proposal has unresolved security failures in matcher-only delivery, online-only confinement, same-epoch fencing, obligation persistence and discharge, declaration completeness, event closure, matcher proof coverage, and client rollout. A connected matcher wake and correct re-query are not sufficient until every authorization-removing result is delivered or quarantined through a durable, data-versioned, fail-closed client transition.
### Orchestrator verification notes — round 2 (outside the verbatim body)

**The reframe survived.** Both families kept it: GPT — "the taxonomy-free reframe
is worth preserving"; Claude — "for the first time in four attempts, the residual
concerns are about enforcement, reach, and cost rather than about a shape the
model cannot express." That is the structural signal the split existed to obtain:
no reviewer produced a fifth unclassifiable app shape.

The residual concerns, verified, cluster on one theme — **computing the right
answer is not the same as the client being unable to see the wrong one**:

- **The witness hole (GPT #3), the sharpest finding.** The reframe says
  matcher-mediated visibility changes (re-parenting a document out of your
  folder) need no epoch, because the matcher re-queries. True for a *connected*
  client. But a *disconnected* client's only staleness witness **is** the epoch —
  which did not move — so on reconnect it compares `(incarnation, epoch)`, sees a
  match, and concludes its retained data is still authorized when it is not. The
  fix that solved the connected case manufactured a hole in the disconnected one.
- **Delivery, not computation (GPT #1).** The shipped outbox destructively drains
  and drops on sticky overflow, so a correct re-query whose delivery is lost
  leaves revoked rows on screen. Negative information does not self-heal on the
  delta path; the round-2 obligation sketch was not specified tightly enough to
  survive the named failures (GPT #4, Claude #5: identity, storage, discharge,
  escalation, GC).
- **The online-only fallback is an honor system (Claude #2).** "Retainable ⇒
  declared authorization dependence" has **no enforcement mechanism**, so an
  omission silently defeats the confinement the safety argument rests on.
- **Coarse-delete blast radius on retained data (Claude #1).** Bounded for live
  views by the round-2 acceptance, but **unbounded and unstated for retained
  slices**: routine membership churn would destroy every client's retained data
  once item 8 lands — i.e. adopting auth would make offline capability
  permanently useless, not merely deferred.
- Plus: the event universe's closure is asserted rather than argued (both); the
  clock rule is self-contradictory and not detectable as scoped (Claude #4); the
  matcher safety argument still does not match the shipped matcher's
  captured-dependency precedence and `userId`-only fallback (GPT #7); "auth-scoped"
  is never defined and event 2's reach is understated (Claude #7); event 4 invites
  a logout storm (Claude #3); the governing LLPs (0008/0011/0020/0043) do not yet
  agree with the reframe (GPT #9).

**Disposition (2026-07-12, revision 3 — attempt five).** The reframe is kept and
completed rather than replaced. The core correction follows directly from the
witness hole: **the epoch was never a coherence protocol and must stop pretending
to be one.** Attempt five states three mechanisms, each doing only what it can:

1. **Connected** → matcher + re-query, delivered over persistent level-triggered
   obligations (converges; losing a wakeup costs a round trip, never the
   consequence).
2. **Reconnecting** → **mandatory resnapshot of every auth-scoped subscription**,
   unconditionally. This closes the witness hole by refusing to ask the epoch a
   question it cannot answer: matcher-mediated visibility changes leave no epoch
   trace, so reconnect never trusts the epoch for them.
3. **Offline retained reads** → correctness comes from an **`authorizedUntil`
   lease**, not from the epoch. This is the industry's converged answer to
   revocation-to-an-unreachable-party (CRL → OCSP → stapling → short-lived
   credentials), and it is now a required v1 mechanism with a default rather than
   an open question.

That restructuring also fixes the blast radius: coarse authorization events
**quarantine** (fail-closed, cheap — hide, block reads, keep bytes, release on a
superseding snapshot that proves continued access) and **delete only on proof**
(the resnapshot shows access is gone, or a targeted event proves it). Routine
membership churn therefore no longer destroys retained data. Also applied:
retainability becomes a **machine-checked manifest-load property** rather than an
honor system (undeclarable ⇒ online-only, refused at load); the obligation state
machine is fully specified (identity, durability, discharge, escalation, GC); the
closure claim is argued rather than asserted; the clock rule is made detectable;
the matcher argument is aligned with the shipped precedence; and the 0008/0011/
0020/0043 amendments are named.
