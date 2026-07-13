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

## Round 3 — 2026-07-12 (attempt five: delivery obligations, reconnect resnapshot, and offline lease)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` (sha256
`33b91b4c4276917c00f1c009e0c8cf8ef4bb6f32cff362e36e628f561d15e17f`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec`,
non-interactive), model `gpt-5.6-sol`, reasoning effort `ultra`, sandbox
`read-only`, workdir = repo root. Session id
`019f57c8-a32d-76b1-b5af-03c0efce76e1`. Fresh session.
**Date:** 2026-07-12
**Redacted:** Same as round 1.
**Method:** cli-runner — fresh session, blind to all archived reviews. The
brief supplied the five-attempt failure history and directed the reviewer to
attack the reframe, reconnect witness, persistent-obligation state machine,
retainability enforcement and event-universe closure, quarantine semantics,
and offline-lease clock threat model.

### Review body (verbatim)

## Overall assessment

The central reframe is good: authorization shape should not be forced into an exhaustive taxonomy when complete database read dependencies and conservative re-evaluation can handle arbitrary joins, hierarchies, mixed ACL/result tables, and row-local visibility. The two orthogonal declaration axes are substantially better than the previous class model.

However, attempt five is not sound yet. It closes delivery for coarse authorization events but not for ordinary matcher-mediated authorization removals. A `public → private` write can be computed correctly, then its sole removal can disappear in the shipped destructive HTTP drain. Because that write advances no authorization epoch and raises no obligation, the connected client can retain the forbidden row indefinitely without reconnecting or invoking the retained-data lease. This is a concrete sixth failure, not merely missing detail.

The closure argument, online-only fallback, obligation state machine, lease scope, and client-clock assumptions also require material revision. The design direction is worth keeping, but it is not ready to implement as the security contract.

## Strengths

- The abandonment of exclusive authorization classes is well justified. LLP 0053 §Two orthogonal declarations cleanly separates result-delivery topology from authorization impact, fixing the mixed roster/ACL failure without inventing more overlapping classes.

- The computation half of the reframe is supported by the implementation when authority is stable and database read capture is complete. Captured dependencies precede static metadata (`src/live_matcher.rs:121-125`); point reads participate in wake decisions (`src/live_matcher.rs:158-220`); changed or unknown scope fields conservatively wake (`src/live_matcher.rs:369-385`). This correctly follows LLP 0008 §Reactivity and Read Sets: false positives are acceptable, false negatives are not.

- The RFC accurately diagnoses current implementation hazards in §Invalidation is an obligation, not a message and §Client fences. The outbox is destructively drained (`src/ephemeral.rs:910-923`), overflow is sticky and drops subsequent durable pushes (`src/ephemeral.rs:760-786,884-892`), and retained writes are fire-and-forget and unconditional (`packages/snapback-contract/index.mjs:418-443`; `client-store.mjs:147-150`).

- §The authorization version correctly identifies that the shipped epochs are process memory advanced after commit, not durable causal witnesses (`src/local.rs:1411-1424,3611-3623`). Centralizing event production is a necessary prerequisite.

- Mandatory fresh authorization evaluation after loss of continuity is the right direction. The shipped stream kit already reconnects by fresh subscription, and Contract replay already full-resyncs before replay (`demos/_kit/client.mjs:900-941`; `packages/snapback-contract/index.mjs:835-895`).

- Quarantine-before-proof is preferable to globally deleting retained caches on every coarse event. §Dispositions recognizes the usability cost of false positives while preserving an intended fail-closed state.

- Keeping subject targeting in shadow mode under §Shadow-mode targeting is disciplined. Nothing security-sensitive should depend on subject inference until completeness, old/new row handling, and oracle comparison are genuinely proved.

- The todo and todo-v2 worked rows match current delivery behavior: todo is an ordered Ibex query and uses re-query plus `live_replace`; todo-v2 is an ordered HostPlan query and also falls back to `live_replace` (`src/live_matcher.rs:577-579`). The other worked shapes are reasonable proposed acceptance fixtures.

## Concerns

1. **HIGH — Matcher-mediated authorization removals still have lossy, edge-triggered delivery.**

   LLP 0053 §Three mechanisms says a connected matcher result is delivered over a persistent obligation, but §Acceptance says ordinary writes—including `public → private` and hierarchy reparenting—fire no obligation. The implementation makes this contradiction exploitable:

   1. A client holds a document because `public = true`.
   2. An ordinary write changes it to private.
   3. The matcher correctly re-queries and produces a result without the document.
   4. The server updates its captured dependency state before enqueueing the replacement (`src/local.rs:3368-3403`). The delta path likewise updates server membership before enqueueing (`src/local.rs:3491-3537`).
   5. HTTP polling destructively removes the frame before the response is confirmed (`src/ephemeral.rs:910-923`; `src/server.rs:2461-2475`).
   6. If that response is lost, the next poll returns an empty queue. The client does not set `needsResubscribe`; a later successful empty poll looks healthy while retaining the old rows (`demos/_kit/client.mjs:953-990`).

   No epoch moved, no obligation exists, no reconnect occurs, and §The lease only covers retained/offline data, not the live in-memory result. The disclosure is unbounded.

   *Resolves with:* Create acknowledged persistent result-supersession state for every auth-scoped authoritative result shrink/removal—or conservatively every auth-scoped delivery. Its witness must include a causal database/delivery generation, and acknowledgement must occur only after the final client boundary and durable store transaction commit. Add lost-HTTP-response tests for `public → private`, hierarchy reparenting, and a DK-3 `remove` while the connection remains usable.

2. **HIGH — The proposed `ResyncObligation` is not yet a complete fail-closed state machine.**

   Several state transitions are unsafe or underspecified:

   - `outbox_overflow` and fan-out retry are assigned `retain`, even though either may have swallowed the only authorization-removing update. Overflow clears the backlog and replaces it with a sentinel; further pushes while overflowed are dropped (`src/ephemeral.rs:760-786,884-892`). A failed re-query similarly leaves the prior result while emitting a recovery resync (`src/local.rs:3573-3604`). “Keep showing current rows meanwhile” is unsafe for an auth-scoped result.
   - `(incarnation, epoch)` cannot order matcher-mediated writes or repeated overflow episodes because those deliberately do not advance the epoch. A delayed acknowledgement for snapshot A can discharge a later obligation B with the same witness.
   - §Discharge says acknowledgement is required, but §Dispositions releases quarantine on a snapshot. If a newer event arrives while the older snapshot is in flight, publishing that snapshot before a server-side compare-and-discharge can reopen access.
   - §GC says an obligation dies with its subscription/connection, while acceptance requires survival across mid-batch WebSocket failure and reset. Current teardown destroys both subscriptions and outboxes (`src/local.rs:2717-2754`; `src/ephemeral.rs:1601-1611`).
   - No stable `client` identity is defined. Current connections and subscriptions are process-memory identities, and default Contract connection labels are regenerated per surface mount.
   - Persistence alone is not level-triggering: every later drain/open must consult or synthesize outstanding state. Current drains intentionally bypass SQLite and operate only on the in-memory queue.

   *Resolves with:* Define a durable logical key such as client-instance plus query identity, along with `{authorizationVersion, resultGeneration, obligationRevision, maxDisposition}`. Every drain, connection open, and subscribe must observe it. Acknowledgement must compare-and-discharge the exact revision after client commit; stale acknowledgements must fail. GC only after acknowledgement or enforceable lease expiry. For scalability, prefer a compact global generation plus lazy per-client/query acknowledgement watermarks over O(number-of-clients) writes inside every permission transaction.

3. **HIGH — The online-only fallback does not close the writeless-event universe.**

   LLP 0053 §The authorization-event universe correctly observes that a clock predicate can leave a connected client authorized indefinitely because the matcher has no deadline wake. It then makes the query “online-only,” but LLP 0008 §§Subscription Contract and Reactivity explicitly allow non-retained queries to remain live through replace/resnapshot mode.

   A live query using `expiresAt > ctx.runtime.now()` therefore remains stale with no write. The runtime exposes `ctx.runtime.now()` (`packages/snapback-harness/ctx-bootstrap.js:287-293`; `src/runtime.rs:734`), while matcher evaluation has no clock (`src/live_matcher.rs:428-442`). Opaque process, policy-provider, or other external dependencies have the same defect.

   Thus the closure argument “undeclarable ⇒ non-retainable ⇒ online-only ⇒ mechanism 1” is false: non-retainability removes durable bytes but creates neither a matcher wake nor removal of live memory. Natural session expiry and other authority transitions also need an explicit boundary assignment to LLP 0039 rather than being ambiguously mixed with this RFC’s four events.

   *Resolves with:* Define clock-dependent and undeclarable authorization queries as one-shot, non-subscribable reads and enforce that at manifest load, or implement deadline/event wakes, periodic revalidation, or a short server-renewed connected lease. Define `auth-scoped` and `auth-resyncable` as conservative manifest predicates; unknown authenticated queries must not escape because their dependencies are opaque.

4. **HIGH — “Machine-enforced retainability” currently proves declaration presence, not declaration truth.**

   The invariant in §The authorization-event universe allows `authScopeField`, declared `permissionDependencies`, and explicit `authorityIndependent`. These remain author assertions unless a verifier proves their completeness.

   The RFC itself notes that Ibex receives `ctx.auth` as a materialized input invisible to capture. In current code it is a plain object (`packages/snapback-harness/ctx-bootstrap.js:267-294`), and the runtime records a user auth dependency whenever an input user exists, regardless of whether or how the program uses it (`src/runtime.rs:1821-1839`). A loader cannot prove that an opaque handler marked `authorityIndependent` does not inspect auth, or that a `permissionDependencies`/`permissionFields` declaration is complete.

   Consequently, `authScopeField` is not the only false-negative-capable declaration. A false `authorityIndependent`, incomplete permission dependency, or incomplete field list can also suppress a required event. An acceptance-suite convergence assertion samples behavior; it is not a structural proof.

   *Resolves with:* Restrict retainability to a proof-carrying subset: closed declarative IR, compiler-proved taint/effect analysis, or a runtime capability design in which opaque code cannot access raw auth or untracked external facts. `authorityIndependent` must be derived or capability-enforced, never a free-form escape hatch. Until field completeness is proved, whole `permissionBacking` tables should bump and `permissionFields` narrowing should remain shadow-only.

5. **HIGH — “Reconnect” and the lease do not cover every loss-of-continuity path or every materialized copy.**

   Mandatory resnapshot is stated as a transport event, but continuity is not defined machine-readably:

   - Pure HTTP polling has no freshness budget (`demos/_kit/client.mjs:37-44`). After the 120-second server reaper removes its subscription (`src/server.rs:1477-1518`; `src/local.rs:2717-2754`), a later poll of the absent outbox returns `[]`; only WebSocket-registered clients receive the reaper resync sentinel.
   - Public `resume_live` can move a subscription to another connection and return `mode: "retained"` when epochs match (`src/local.rs:1747-1826`), precisely the comparison that cannot witness matcher-only visibility changes.
   - A paused handle stops transport but leaves `handle.rows` renderable (`demos/_kit/client.mjs:1134-1146`).
   - Contract connection changes re-emit the previous cell rather than blocking it (`packages/snapback-contract/index.mjs:464-471`).
   - The RFC simultaneously requires resnapshot on every reconnect and says an ordinary restart does not force retained subscriptions to resnapshot. LLP 0039 §Permission dependencies pins the same no-resnapshot-on-restart rule. A server restart necessarily destroys connection continuity.

   The `authorizedUntil` text applies only to retained data, so these live in-memory copies can survive beyond the lease without calling the retained store.

   *Resolves with:* Define a server-issued connection/subscription generation. Unknown, reaped, restarted, or rebound generations must return a typed resnapshot requirement rather than an empty healthy drain. Auth-scoped `resume_live` must always resnapshot or be forbidden. Poll gaps, background resume, pause/resume, and missed freshness budgets must quarantine before rendering. Apply the lease/read gate to every auth-scoped materialization: live handles, rendered boundaries, optimistic overlays, and durable bytes. Clarify that incarnation persistence avoids an unsolicited offline wipe, but any eventual post-restart reconnect still snapshots.

6. **HIGH — An adversarial client clock defeats the claimed lease bound.**

   §The lease calls `authorizedUntil` the security boundary and says the exposure window is at most the lease. That is not true without a trusted verifier clock. A client can roll its wall clock backward; the shipped freshness budget itself uses `Date.now()` (`demos/_kit/client.mjs:1418-1428`). A user controlling the client can also patch the check or copy already-delivered plaintext. The certificate analogy assumes that the relying verifier and its clock are trusted; here the holder is the verifier.

   The proposed fence compounds this: lease expiry changes neither `(incarnation, epoch)` component, so a stale same-fence retained write can repopulate data after expiry unless a separate local generation participates in the atomic check.

   *Resolves with:* State the threat model explicitly. For conforming clients, define server issuance time, maximum skew, remaining-TTL transport, monotonic-timer anchoring, wall-clock rollback detection, suspend/reboot behavior, persistent time high-water marks, and fail-closed behavior when elapsed time cannot be proved. State the bound as lease plus tolerated skew and cap it by session/grant expiry. If a hostile device or user is in scope, acknowledge that software alone cannot force forgetting plaintext; trusted secure time/hardware with sealed encryption—or online-only access—is required.

7. **MEDIUM — Event production semantics are incomplete across field filtering and non-database activation.**

   `permissionFields` is underspecified for inserts, deletes, and unknown changed-field sets. Shipped deletes carry the preimage but `changed_fields: []` (`src/storage.rs:817-840,1250-1269`); journal-reconstructed changes also have unknown fields (`src/storage.rs:2261-2298`). A simple intersection would miss deletion of `gameMembers`, the canonical kick.

   Event 2 also promises atomic activation of schema/functions/auth metadata with the authorization event, but current function activation is an in-memory swap rather than part of a database transaction (`src/local.rs:942-988`). Schema activation, seed, reset, HostPlan, and Ibex use different transaction boundaries. A generic commit hook cannot alone make code activation, version advancement, and obligations atomic.

   *Resolves with:* Specify that inserts and deletes on permission-backing tables always fire; only updates may use field intersection, and empty/unknown fields fire conservatively. Define a durable staged activation record, crash recovery/roll-forward rules, and pointer-swap ordering for function/schema bundles. Add crash-cut tests for every writer and activation path.

8. **HIGH — The client quarantine/fence contract needs a local transactional generation, not only an authorization pair.**

   Current code validates the RFC’s race diagnosis but cannot implement the proposed guarantee as stated: `putRetainedQuery` overwrites unconditionally, the localStorage backend has no CAS, and `writeServerRows` starts the retained write before checking disposal (`client-store.mjs:147-150,227-246`; `packages/snapback-contract/index.mjs:418-443`).

   A fence containing only `(incarnation, epoch)` cannot order lease expiry, local quarantine/delete, repeated same-epoch matcher deliveries, or renewal. The disposition semantics are also inconsistent: quarantine says keep bytes for possible release, while §Client fences says remove overlays and queues. Under the global epoch, unrelated membership churn could therefore destroy every client’s pending offline edits even when the coarse event was a false positive. Finally, a subject-matched event is listed as “proof” for deletion, but subject targeting alone does not prove revocation; the event could grant access or change a non-revoking role.

   *Resolves with:* Extend the DK-9 store interface with atomic compare-and-transition operations over a persistent local disposition generation plus the server witness. Persist non-overwritable quarantine/delete tombstones and serialize across tabs. Specify dispositions independently for live rows, retained rows, overlays, and pending mutations; quarantine should preserve but disable queued work until revalidation. Delete only after a semantic revocation proof or authoritative snapshot, never merely a subject match.

9. **MEDIUM — The governing corpus currently contains contradictory authority.**

   LLP 0053 says LLP 0011 wins, but changes ratified contracts recorded in LLP 0011 §Local-First and Realtime Implications and LLP 0000’s decision ledger: permission-affecting writes advance epochs, and reconnect compares epochs rather than resnapshotting unconditionally. LLP 0039 says ordinary restarts should not force retained resnapshot, while this RFC’s central reconnect rule requires it. LLP 0043 still permits offline reads when the stored epoch is merely “not known-stale,” without a lease.

   These may be intentional refinements, but the corpus presently leaves an implementer with incompatible instructions.

   *Resolves with:* Make acceptance of LLP 0053 explicitly supersede and amend the affected clauses in LLP 0000, 0008, 0011, 0020, 0039, and 0043 in the same change. Distinguish “restart does not itself delete offline data” from “a connection established after restart must obtain a fresh snapshot.”

## Suggestions

- Separate the design into two durable cursors:

  - an authorization generation for coarse/writeless events and dispositions;
  - a result-delivery generation or database version for reliable supersession of every auth-scoped result.

  Queue frames then become hints; the client is current only when its acknowledged cursor satisfies both.

- Make the authorization event enumeration a promptness optimization rather than the only safety boundary. A short connected revalidation lease plus a separately chosen offline lease would bound unknown writeless dependencies, subject to the explicit trusted-clock limitation.

- Keep both `permissionFields` suppression and subject-scoped suppression in shadow mode initially. Whole-table permission events are a safer v1 baseline.

- Label the mine-or-public, card-game, roster, hierarchy, and mixed-table rows as required fixtures rather than shipped evidence. Current HostPlan supports flat conjunctive filters, not OR or joins, so these proofs need explicit Ibex implementations and captured-read assertions.

- Model-check the obligation/acknowledgement protocol or property-test a small executable state machine. Include delayed acknowledgements, duplicate acknowledgements, two same-epoch removals, reset, response loss, callback failure, overflow, restart, and cross-tab stale writes.

- Put a quantitative acceptance threshold on global authorization churn. “Measure and record” is insufficient when every membership join/leave can quarantine every auth-scoped view.

- Bump the client-store version or namespace when lease/disposition records land. Handshake gating cannot protect an offline downgraded client that opens a newer store without contacting the server.

## Open questions

- What exact adversary is the lease intended to constrain: a conforming app with an inaccurate clock, or a user controlling the device and client code?

- What manifest-derived predicate makes a query `auth-scoped`? Do unknown or opaque authenticated queries conservatively count as auth-scoped?

- Does “online-only” mean one-shot and non-subscribable, or can it still be a long-lived live-replace query?

- What stable client/device/query identity owns an obligation across connection loss, process restart, multiple tabs, session rotation, and user switch?

- Must every auth-scoped result delivery be acknowledged, or only deliveries that shrink membership? If only shrinking deliveries, how is that determined safely for query errors and opaque handlers?

- Which writeless authority transitions belong to LLP 0039 rather than this event universe—natural session expiry, auth-mode transition, account/provider changes—and what is the formal handoff?

- Can local SQLite and the Cloudflare coordinator both implement the same atomic activation, obligation observation, and acknowledgement contracts without blocking their delivery lanes?

- Who owns the 24-hour default, what risk class is it suitable for, and must applications such as finance or private messaging choose materially shorter ceilings?

## Readiness verdict

Verdict: NOT READY

The proposal has a promising computational reframe, but a concrete ordinary `public → private` removal can still be lost permanently while the client remains connected, leaving forbidden data visible with no epoch, obligation, reconnect, or applicable lease. The online-only closure argument, obligation state machine, retainability proof, continuity boundary, and clock threat model also contain unresolved material correctness and safety gaps.

## Round 4 — 2026-07-13 (focused audit of the current enforcement fixes)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md`, current
working-tree revision (sha256
`e64dcb731745776511a8c85a571802548012a0f102554108f89a25da6c308cd7`).
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1 (`codex exec --ephemeral`),
model `gpt-5.6-sol`, reasoning effort `xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24592-auth-review`. Fresh session
`019f5b00-7c7e-7802-8e71-54a249a0a695`.
**Date:** 2026-07-13
**Redacted:** Same as earlier rounds.
**Method:** Focused ENG-24592 gate review of the current unreviewed
enforcement fixes. This review was explicitly informed by all prior
`0053-authorization-invalidation.*.md` artifacts (not blind), LLP 0039 at the
ownership seam, and direct source verification. The reviewer was instructed
not to reopen the settled architecture or accept on the author's behalf.

### Review body (verbatim)

## Overall assessment

**NOT READY.** The architecture remains sound and settled; no seventh design is warranted. LLP 0039 draws the ownership seam correctly and blocks landing item 6 pending review.

The enforcement fixes are **not safe to implement as written**. The commit-version and denial corrections appear in explanatory prose, but operative state, fence, disposition, and acceptance text still permits the two fail-open traces those corrections were meant to eliminate. The remaining issues are local protocol and consistency corrections.

## Strengths with exact sections

- **Removal security is framed correctly.** [LLP 0053 §Negative deltas, lines 172–206](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:172) correctly treats removals and denied re-queries as obligation-backed negative outcomes.

- **The fail-closed definition of auth-scoped is correct.** [LLP 0053 lines 210–215](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:210) makes every subscription auth-scoped unless explicitly `authorityIndependent`. This closes the opaque-handler hole without reopening the architecture.

- **The corrected closure reasoning is logically sound.** [LLP 0053 lines 378–402](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:378) correctly states that online-only confinement protects retained data but does not create a matcher wake for connected views.

- **Per-scope durability identifies the right crash argument.** [LLP 0053 lines 460–474](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:460) correctly recognizes that matcher removals are discovered post-commit and that process death closes their live-scope crash window through mandatory resnapshot.

- **Commit-version witnessing is implementable with the shipped primitives.** Query and mutation outputs already carry versions ([manifest lines 1647–1657](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/manifest.rs:1647)); `live_delta` obtains the causing commit version ([local.rs lines 4038–4061](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:4038)); and retained storage already rejects lower versions within a stream ([client-store.mjs lines 567–585](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-contract/client-store.mjs:567)).

- **The 0039 seam and landing order are substantially correct.** Ownership is separated at [LLP 0039 lines 988–1080](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:988), and item 6 remains explicitly blocked at [lines 1256–1273](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1256).

## Findings

### HIGH

#### 1. The commit-version fix is not present in the normative obligation record, client fence, or acceptance criteria

**Evidence.** The corrected discharge prose requires a snapshot at or after the causing commit ([0053 lines 475–489](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:475)). But the record still defines `witness: (incarnation, epoch)` ([lines 447–452](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:447)); merging only raises disposition and says nothing about a maximum data-version floor ([lines 455–459](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:455)); the retained fence is still only `(incarnation, epoch)` ([lines 585–599](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:585)); and acceptance still discharges under a satisfying pair ([lines 699–706](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:699)). Status nevertheless claims both mechanisms are now commit-version witnessed ([lines 776–784](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:776)).

The client baseline is also stale: 0053 says retained writes overwrite unconditionally ([lines 587–590](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:587)), while writes are now serialized ([index.mjs lines 462–489](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-contract/index.mjs:462)) and version-CASed. That CAS still lacks an authorization/removal tombstone, so it does not close the fence race after quarantine or deletion.

**Failure trace.** A removal commits at version 100 without changing the authorization pair. A racing version-99 snapshot is acknowledged later and satisfies the record and acceptance’s unchanged pair, discharging the obligation. Alternatively, quarantine deletes the retained record, after which a delayed version-99 callback finds no newer record to compare against and repopulates the store under the unchanged pair. Repeated removals at versions 100 and 105 also have no specified merge rule preserving 105.

**Resolves with.** Define a composite obligation/fence containing the authorization pair, version stream, and minimum commit version. Merge takes the maximum minimum version within the same stream and the maximum disposition; authorization-pair/stream changes dominate data-version comparison. Equal-pair writes must be version-nondecreasing, including against a persisted quarantine/delete tombstone. An acknowledgement must conditionally clear only the current obligation whose composite witness it satisfies. Update the record, fence section, Acceptance, and Status together.

#### 2. Denial/error remains normatively routable to `retain`

**Evidence.** The new rule correctly says any re-query error or denial on an auth-scoped subscription is obligation-backed with disposition at least `quarantine`, never `retain` ([0053 lines 196–206](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:196)). The dispositions table still maps unqualified “fan-out retry” to `retain` ([lines 511–517](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:511)) and has no error/denial producer. Acceptance has no denial case.

The shipped path makes this ambiguity concrete: a re-query error enters `fail_subscription_fanout` ([local.rs lines 3953–3960](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:3953)), which emits a generic recovery resync ([lines 4158–4189](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:4158)). The existing fan-out test proves that an untyped handler throw becomes `live_refresh_failed` ([local_v0.rs lines 3366–3420](/Users/ccheever/projects/snapback-eng-24592-auth-review/tests/local_v0.rs:3366)).

**Failure trace.** A membership change wakes a query whose function-level authorization now throws. The generic fan-out failure is interpreted through the table as `retain`; the client continues showing its old rows while resubscribing. Every resnapshot throws, so “meanwhile” is permanent. No successful snapshot can repair the view.

**Resolves with.** Make the producer table explicit: every `Err` or denial from an auth-scoped re-query produces at least `quarantine`; retry may continue while the rows are hidden, but may never retain them. Reserve recovery `retain` for `authorityIndependent` subscriptions or a path proven not to represent an authorization-negative result. Add acceptance for typed denial, untyped error, repeated failed resnapshots, lost/overflowed quarantine delivery, and substitute-resync disposition inheritance.

### MEDIUM

#### 3. The per-scope durability model has the right idea but an inconsistent identity and linearization contract

**Evidence.** The record contains only a scope category, not a scope identifier ([0053 lines 447–452](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:447)). Identity is described as one `(client, scope)` obligation “keyed durably” ([lines 455–459](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:455)), while subscription- and connection-scoped obligations are then explicitly non-durable ([lines 460–474](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:460)). “Enumerated-event obligations are written transactionally” also does not say how a cause transaction enumerates in-memory connections or offline retained clients.

**Failure trace.** An implementation keys an obligation by a transient subscription ID. Resubscription allocates a new ID, the old scope is collected, and a retained query loses the durable quarantine it still needs. Alternatively, an enumerated event commits, but its per-client obligations are materialized post-commit despite the transactional claim; a crash then leaves no specified durable object from which client obligations are reconstructed.

**Resolves with.** Add an event-by-scope matrix: identify the transactionally durable cause, the post-commit live projection, and the durable retained client/query state. Define the actual scope discriminator and its behavior across resubscribe, reconnect, restart, and GC. Clarify whether the durable authorization version is the authoritative cause from which per-client obligations are projected, or whether durable per-client rows are required.

#### 4. Acknowledgement and level-triggered re-fire are required but have no protocol contract

**Evidence.** Discharge requires delivery and acknowledgement, and an unacknowledged obligation “re-fires on the next wakeup” ([0053 lines 475–479](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:475)); “wakeup” is undefined. The client-to-server socket protocol has no snapshot or obligation acknowledgement variant ([live_wire.rs lines 135–177](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/live_wire.rs:135)). LLP 0039 assigns 0053 ownership of its wire vocabulary ([0039 lines 1228–1235](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1228)), but its deferred protocol obligations do not name the item-6 acknowledgement.

The server already has usable triggers: the outbox drain is destructive ([ephemeral.rs lines 1189–1219](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/ephemeral.rs:1189)), and WebSockets have a 30-second safety-net wake ([server.rs lines 2973–2983](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/server.rs:2973)).

**Failure trace.** The sole removal hint is lost on a quiet connection. The obligation persists, but no defined actor rereads it, so the row remains indefinitely. A naïvely delayed acknowledgement can also race a later merged obligation unless clearing is a conditional comparison against the current composite witness. An ack-incapable session client accumulates obligations forever.

**Resolves with.** Pin that every drain and live heartbeat projects current obligations, with a stated promptness bound. Specify what an acknowledgement names—scope/generation, authorization pair, version stream, snapshot version, and disposition—and require conditional discharge. Gate all session-mode auth-scoped live subscriptions on acknowledgement/disposition capability, not only retained reads. Exact encoding may remain in an implementation spec.

#### 5. Acceptance and the 0039 seam still contradict delivery obligations and mandatory resnapshot

**Evidence.** Design requires an obligation for any removal, including ordinary deletes ([0053 lines 188–195](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:188)). Acceptance instead says ordinary writes fire no obligation and cause no resnapshot beyond shipped behavior ([lines 673–684](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:673)). Design explicitly includes process restart and every non-live resume in mandatory resnapshot ([lines 230–245](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:230)); Acceptance says an ordinary restart does not force retained subscriptions to resnapshot ([lines 713–718](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:713)).

The 0039 seam similarly says ordinary writes “do not resync” ([0039 lines 1017–1027](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1017)) and that ordinary restart must not force every retained subscription to resnapshot ([lines 1012–1015](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1012)).

**Failure trace.** An implementer follows Acceptance and writes a test asserting zero obligations for a `public → private` ordinary update. The implementation passes the gate while recreating the permanent lost-removal defect. A restarted auth-scoped retained view may likewise render without the mandatory revalidation required by Design.

**Resolves with.** Distinguish **delivery obligations** from coarse authorization-event obligations. Ordinary writes cause no epoch advance, no global quarantine, and no unrelated resync amplification, but a result-removing delivery still creates an obligation. Qualify restart language: preserving the incarnation does not itself invalidate every query, but every auth-scoped non-live resume still resnapshots; `authorityIndependent` is the exemption. Mirror those formulations in 0039.

#### 6. The corrected closure argument names the wrong clock residual and Acceptance overclaims refusal

**Evidence.** The logical correction is sound, but [0053 lines 390–402](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:390) and Status ([lines 793–797](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:793)) claim JavaScript `Date.now()` remains reachable and undetectable. Current codegen rejects `Date.now`/`new Date` ([codegen lines 1890–1907](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-codegen/index.mjs:1890)); the deterministic Ibex runtime also denies them ([runtime.rs lines 1731–1779](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/runtime.rs:1731)), with a direct query test ([ctx_ledger_v0.rs lines 404–430](/Users/ccheever/projects/snapback-eng-24592-auth-review/tests/ctx_ledger_v0.rs:404)).

The actual opaque clock surface is `ctx.runtime.now()` ([ctx-bootstrap lines 495–501](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-harness/ctx-bootstrap.js:495)), which the host permits ([runtime.rs lines 744–749](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/runtime.rs:744)). Acceptance nevertheless says any clock-dependent authorization query is refused at manifest load ([0053 lines 693–697](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:693)).

**Failure trace.** The RFC’s proposed `Date.now()` residual test fails at codegen or runtime, so it cannot demonstrate the claimed behavior. Conversely, an opaque handler can call `ctx.runtime.now()`, publish a time-limited result, and receive no write or deadline wake when time passes; the connected view remains stale despite Acceptance’s blanket manifest-refusal claim.

**Resolves with.** Keep the corrected logical closure argument, but name the actual clock surfaces and enforcement stages: declarable `RuntimeNow` authorization is load-rejected; ambient `Date` clocks are codegen/runtime-denied; opaque `ctx.runtime.now()` authorization is the current connected-view residual unless a load-time declaration rule covers it. Update Summary, Acceptance, Status, the expiry oracle, and Open Question 2 consistently.

#### 7. Detecting a shrinking `live_replace` is not pinned for general Ibex output

**Evidence.** The rule depends on knowing that a row the client holds was removed ([0053 lines 188–195](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:188)). The current subscription record stores input and captured read dependencies, not the previously delivered logical result ([local.rs lines 1123–1130](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:1123)). HostPlan deltas can compare captured membership IDs ([lines 4011–4028](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:4011)), but the Ibex `live_replace` path moves the new rows into the envelope and retains only new dependencies ([lines 3953–3987](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:3953)). Raw dependency rows need not equal projected or synthesized output rows.

**Failure trace.** An Ibex query projects, aggregates, or synthesizes output. A re-query at version 100 omits an output row previously delivered, but captured raw dependency membership cannot identify that output removal. No obligation is raised; if the replacement frame is lost, the forbidden row remains.

**Resolves with.** Pin one implementation predicate before coding: retain each subscription’s last potentially delivered logical membership/version, with defined output identity, or conservatively obligation-back every auth-scoped `live_replace`. This is an enforcement detail, not a new architecture.

### LOW

#### 8. The fail-closed auth-scoped rule lacks an explicit acceptance row

**Evidence.** The normative definition is clear at [0053 lines 210–215](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:210), but Acceptance never tests undeclared functions or the `authorityIndependent` opt-out.

**Failure trace.** A test suite can pass while an implementation applies obligations only to functions with declared authorization dependencies, recreating the opaque-handler lost-removal hole.

**Resolves with.** Add fixtures proving undeclared means auth-scoped and only explicit `authorityIndependent` suppresses removal obligations.

#### 9. `permissionFields` still lacks the conservative unknown-fields rule

**Evidence.** The declaration is defined at [0053 lines 282–304](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:282), but no rule covers empty/unknown `changed_fields`. Journal reconstruction deliberately produces an empty list ([storage.rs lines 3305–3340](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/storage.rs:3305)); the matcher correctly treats empty as unknown and therefore affected ([live_matcher.rs lines 352–365](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/live_matcher.rs:352)).

**Failure trace.** A journal-reconstructed permission-table update has no field list. An implementation treats the empty intersection as irrelevant and suppresses the authorization event.

**Resolves with.** State that empty or unavailable `changed_fields` means “may include every field” and fires the event.

#### 10. LLP 0039 retains stale open-question vocabulary

**Evidence.** The seam says 0053 rejected classification and pins the retained lease ([0039 lines 50–55](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:50), [lines 1271–1273](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1271)), while its Open Questions still move a possible fifth classification class and the lease default to 0053 ([lines 1519–1523](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1519)).

**Failure trace.** A landing planner can incorrectly treat rejected classification work or the settled 24-hour default as an unresolved prerequisite.

**Resolves with.** Replace the stale paragraph with 0053’s actual remaining questions.

## Open questions

1. What stable identity names subscription-, connection-, and retained client/query-scoped obligations across resubscription, reconnect, multiple tabs, and process restart?

2. What exact composite value does an acknowledgement name, and which implementing protocol document owns its wire schema and conditional-discharge transaction?

3. Is opaque `ctx.runtime.now()` authorization deliberately admitted as the named connected-view residual, or must retainable/auth-resyncable admission reject any handler that can call it?

4. For arbitrary Ibex output, will shrinking-result detection retain logical output membership, or will all auth-scoped `live_replace` deliveries be conservatively obligation-backed?

## Recommended next step

Revise LLP 0053 in place; do not reopen the architecture. Correct the obligation record, composite fence, merge/discharge semantics, denial disposition table, per-scope identity/durability matrix, acknowledgement/re-fire obligation, clock wording, and Acceptance/Status rows. Reconcile the narrow 0039 seam wording in the same revision, then run one focused independent review of that diff while keeping landing item 6 blocked.

**As written, the enforcement fixes are not safe to implement. After the HIGH and MEDIUM corrections above are made—and the LOW safety pins are incorporated into acceptance—they are safe to implement without a seventh design. This review does not accept the RFC on the author’s behalf.**


## Round 5 — 2026-07-13 (paired blind confirmation of the revised enforcement gate)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` at SHA-256
`fd0499240ede7a67d71edd86a13bd930de5620e8c1467da7c7160cbccd6a6592`.
**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1
(`codex exec --ephemeral`), model `gpt-5.6-sol`, reasoning effort
`xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24592-auth-review`.
Fresh thread `019f5b3c-ad45-7a11-8b63-b6a3123f0bdd`.
**Date:** 2026-07-13
**Review-body SHA-256:**
`9aa894c592ea50cb697b9c3127e9b4dbc6a9c03fa64e8a26b8a40b73ff616369`.
**Redacted:** no
**Method:** Independent adversarial confirmation of the exact frozen candidate.
The reviewer was forbidden from reading prior review artifacts and had read-only
access to the RFC, governing LLPs, and source tree. Nothing was edited.

### Review body (verbatim)

# Review of Snapback LLP 0053

**Digest reviewed:** `fd0499240ede7a67d71edd86a13bd930de5620e8c1467da7c7160cbccd6a6592`

**Verdict: NOT READY**

The core architecture is sound: composite authorization/data witnesses, scope-local revisions, connection-root children, level-triggered obligations, terminal-delete proofs, ACK-after-commit, query/queue generations, mandatory resnapshot, and capability refusal form a coherent direction. The frozen text still has three blocking specification defects and two bounded protocol gaps.

## HIGH

1. **The RFC contradicts its governing, ratified authorization contract.**

   Anchors: [§Summary, line 78](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:78), [§Authorization-event universe, lines 345–353](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:345), [§Worked classifications, lines 881–884](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:881), [§Acceptance, lines 912–919](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:912).

   LLP 0053 says LLP 0011 wins where it pins a contract, while LLP 0011 requires every permission-affecting write to advance an authorization epoch and emit server-directed resync ([LLP 0011 lines 232–249](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0011-auth-and-permissions.rfc.md:232)); LLP 0008 repeats that requirement ([lines 455–462](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0008-local-first-sync-and-realtime.rfc.md:455)). LLP 0053 instead requires `public → private` and similar row-mediated authorization changes to advance no epoch. Both contracts cannot be implemented simultaneously.

   **Bounded resolution:** make acceptance of 0053 explicitly supersede the cited LLP 0011/0008 clauses, and land the corresponding dated amendments/root-ledger reconciliation before item 6 begins.

2. **A known mutable query input remains outside machine-enforced admission.**

   Anchors: [§Authorization-event universe, lines 429–449](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:429), [§Open Question 2, lines 1064–1069](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:1064).

   The text correctly admits that online-only confinement does not wake a connected query, but leaves enforcement open. This is already concrete: `ctx.runtime.id()` is exposed to queries ([ctx-bootstrap.js lines 495–501](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-harness/ctx-bootstrap.js:495)) and produces a fresh host ID ([runtime.rs lines 568–607](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/runtime.rs:568)). An auth-scoped handler can branch visibility on it without a database write, epoch event, or matcher wake. The connected result can therefore remain authorization-stale indefinitely.

   **Bounded resolution:** refuse `ctx.runtime.id()` and every other non-database mutable host input while establishing or rerunning auth-scoped subscriptions and retainable queries, or define an exhaustive machine-enforced allowlist. Add initial-run and rerun acceptance on every runtime profile.

3. **The lease does not yet substantiate its bounded-exposure guarantee.**

   Anchors: [§The lease, lines 698–736](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:698), especially [lines 708–715](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:708), and [lines 739–742](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:739).

   The lease is the only claimed bound for an unreachable honest client, but the RFC does not pin the issuer/time basis, rollback behavior, atomic binding to the accepted composite witness, renewal linearization, or the actual configurable ceiling. An honest wall-clock rollback can extend `authorizedUntil` beyond the promised lease, and a renewal racing invalidation can persist a fresh-looking lease against stale rows.

   **Bounded resolution:** make `authorizedUntil` a server-issued absolute expiry bound to the snapshot proof and composite witness; commit it atomically with snapshot/fence state before ACK; fail closed on missing expiry or detected clock rollback; state the default and maximum explicitly; and add expiry-while-closed, rollback, renewal/invalidation-race, and delete-before-render tests.

## MEDIUM

1. **Extinct-scope retirement and tombstone GC are incomplete across server failure and long-term churn.**

   Anchors: [§Invalidation obligations, lines 554–585](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:554), [§GC, lines 633–640](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:633), [§Client fences, lines 786–793](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:786), [§Acceptance, lines 986–994](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:986).

   Server live-scope state is intentionally non-durable, while client pending scopes are durable. The RFC does not define how a new process proves an old scope extinct if the old process died before issuing retirement proof. It also requires per-scope high-water state to survive indefinitely, yielding unbounded durable growth under repeated subscription churn.

   **Bounded resolution:** add an authenticated server boot/connection-issuer generation that can retire every prior-generation scope after a satisfying snapshot; define safe query-instance rotation or a fail-closed cap for compacting retired high-waters; test crash-before-retirement and sustained churn.

2. **The bounded denial/error retry contract has no specified state owner.**

   Anchors: [§Negative deltas, lines 221–236](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:221), [obligation record, lines 501–511](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:501), [client pending state, lines 773–778](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:773), [§Acceptance, lines 996–1004](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:996).

   Exactly two retries within one non-resettable 15-second budget are required, but neither normative state representation records attempts or budget origin, and ownership across retransmission is unspecified.

   **Bounded resolution:** assign retry state to the server obligation revision, with monotonic `first_failure_at` and attempt count; state its behavior under duplicate re-fire, newer revisions, reconnect, and process loss; add boundary-time fault tests.

## LOW

None.

**Architecture sound:** Yes—the architectural direction is sound. These findings require closing contracts and enforcement edges, not redesigning the matcher/obligation/fence model.

**May items 6 and 8 unblock on this text?** No. Item 6 remains blocked by the governing-contract conflict, mutable-input admission hole, and retirement/retry gaps. Item 8 additionally remains blocked by the incomplete lease contract.


## Round 6 — 2026-07-13 (final paired blind confirmation of the operative gate)

**Reviewed operative corpus:**

- `llp/0000-snapback.explainer.md` at SHA-256
  `7957a27102d55ae3197e55d90553980c0d0fd0275f7df80547d7670501bcda03`
- `llp/0008-local-first-sync-and-realtime.rfc.md` at SHA-256
  `f101a489c1e3d477b5f9c0322b6336827d8600930db67294d35dd32bb3b0b1ac`
- `llp/0011-auth-and-permissions.rfc.md` at SHA-256
  `0045e02cec94cf101cfbb459edd180b1985ebe4f5d06dfcc95484730829623b1`
- `llp/0013-ephemeral-realtime-state.rfc.md` at SHA-256
  `7c6bd5b4642153e75a684b1f4632b4187effcaa21630ded4e8a82bd753ae4177`
- `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
  `33b71fbc229d61c793fafca867b8cb18c9186356722d101f0696a3fa84e84e0b`
- `llp/0053-authorization-invalidation.rfc.md` at SHA-256
  `98f286826e4cf0fb283648747ba209fbed99f8f09519a1e1498f18b86136bf8f`

**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1
(`codex exec --ephemeral`), model `gpt-5.6-sol`, reasoning effort
`xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24592-auth-review`.
Fresh thread `019f5b7a-fd5e-7aa2-84f6-d8c2038aff2a`.
**Date:** 2026-07-13
**Review-body SHA-256:**
`0c9a6653eb0ccd39f7b901534932549375e162cec6091064332a1a2fc66e5a57`.
**Redacted:** no
**Method:** Blind adversarial confirmation of the exact operative corpus. The
reviewer was forbidden from reading prior review artifacts, verified all six
hashes, inspected governing LLPs and source, ran the reference checker, and
edited nothing.

### Review body (verbatim)

# Verdict: NOT READY — High severity

The architecture remains sound, but the enforcement contract has one blocking identity/GC inconsistency. This is a bounded protocol correction, not a seventh design.

The two independent blind reviews initially returned READY. During final synthesis, the issue below surfaced; both reviewers then independently confirmed it as a High blocker. No review artifact was read and no file was edited.

## Hash gate

All operative SHA-256 values matched exactly:

| LLP | Verified hash |
|---|---|
| 0000 | `7957a27102d55ae3197e55d90553980c0d0fd0275f7df80547d7670501bcda03` |
| 0008 | `f101a489c1e3d477b5f9c0322b6336827d8600930db67294d35dd32bb3b0b1ac` |
| 0011 | `0045e02cec94cf101cfbb459edd180b1985ebe4f5d06dfcc95484730829623b1` |
| 0013 | `7c6bd5b4642153e75a684b1f4632b4187effcaa21630ded4e8a82bd753ae4177` |
| 0039 | `33b71fbc229d61c793fafca867b8cb18c9186356722d101f0696a3fa84e84e0b` |
| 0053 | `98f286826e4cf0fb283648747ba209fbed99f8f09519a1e1498f18b86136bf8f` |

`./ref-check --verbose` also completed with 0 errors.

## Blocking finding

High — `ClientQuery` scope identity cannot simultaneously provide anti-replay and bounded retirement.

Exact evidence:

- A live `Subscription` scope includes `query_instance_id`, but `ClientQuery` includes only `{client_store_id, query_key}`: [LLP 0053:637](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:637).
- Revision high-water must survive discharge until authenticated retirement: [LLP 0053:703](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:703).
- The only two authenticated retirement forms require issuer/scope-sequence fields that `ClientQuery` lacks: [LLP 0053:752](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:752).
- GC nevertheless claims that a new `query_instance_id` lets the former namespace disappear and prevents old-instance frames from allocating state: [LLP 0053:879](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:879), [LLP 0053:1206](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:1206).
- The existing store’s canonical retained key is only function plus arguments, reinforcing that the missing discriminator must be explicitly added: [client-store.mjs:34](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-contract/client-store.mjs:34).

Failure trace:

1. Retained query `Q` uses instance `I1` and receives a `ClientQuery` obligation at revision `R`.
2. It is discharged and compacted; `Q` is recreated as never-reused instance `I2`.
3. Both lifecycles nevertheless have the identical wire scope `{store, Q}`.
4. If the old revision state is compacted, delayed `I1` obligations cannot be distinguished from `I2`; coincident revision/witness/proof tuples also undermine stale-ACK rejection.
5. If the high-water is retained forever to prevent reuse, unique query-key churn grows permanent per-key state, contradicting bounded GC.

Composite witnesses mitigate some stale ACK schedules, but they cannot supply the missing instance discriminator or resolve the storage-bound contradiction.

Bounded resolution:

1. Define `ClientQuery { client_store_id, query_key, query_instance_id }`.
2. Bind that ID into obligations, resolution/ACK tokens, full-scope comparison, and old-frame rejection.
3. Specify client-query instance retirement: apply the maximum pending disposition, advance query and queue generations, retire the exact instance, then permit its revision state to be removed. Missing state must reject frames without allocating state.
4. Add an adversarial `I1 → compact → I2` test with delayed obligation/proof/ACK frames, plus million-key churn proving bounded state.

## Confirmed portions

No other blocker was found:

- Corpus precedence and dated amendments are coherent and acceptance-gated: [0000:336](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0000-snapback.explainer.md:336), [0008:465](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0008-local-first-sync-and-realtime.rfc.md:465), [0011:261](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0011-auth-and-permissions.rfc.md:261).
- Protected-query admission is closed/default-deny.
- Composite witnesses, dispositions, denial/error handling, durable retry episodes, and ACK-after-commit are enforceable.
- AuthorizedLease atomic head/auth/activation proof, rollback handling, renewal, clamps, and expiry are complete.
- Room invalidation covers registration, snapshot, mutation, enqueue, drain, and final send with precommit barriers.
- LLP 0039 and 0053 carry the same item 5/6/7/8 activation matrix: [0039:1325](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1325).
- Existing source provides concrete implementation seams for destructive drain, delta removal, room locking, commit guards, fresh VMs, and Web-Locked retained storage.

## Gate consequences

- Architecture sound: **Yes**.
- Item 6 may unblock on this candidate: **No**.
- Item 8 may unblock on this candidate: **No**; it additionally retains LLP 0039’s items 5/6/7 prerequisites.
- ENG-24592 can close: **No**. It can close after the bounded correction is incorporated and independently confirmed.

This is a readiness recommendation only; it does not accept LLP 0053 on the author’s behalf.


## Round 7 — 2026-07-13 (focused exact confirmation of the ClientQuery correction)

**Reviewed operative corpus:**

- `llp/0000-snapback.explainer.md` at SHA-256
  `7957a27102d55ae3197e55d90553980c0d0fd0275f7df80547d7670501bcda03`
- `llp/0008-local-first-sync-and-realtime.rfc.md` at SHA-256
  `f101a489c1e3d477b5f9c0322b6336827d8600930db67294d35dd32bb3b0b1ac`
- `llp/0011-auth-and-permissions.rfc.md` at SHA-256
  `0045e02cec94cf101cfbb459edd180b1985ebe4f5d06dfcc95484730829623b1`
- `llp/0013-ephemeral-realtime-state.rfc.md` at SHA-256
  `7447ed8b282e3ddda17663230903a2420c0394842cfcc2c3cb5039ff521630bb`
- `llp/0039-auth-vertical-slice.rfc.md` at SHA-256
  `869c32c1d99c29bad14df40c7a6014e509b4b86c630cdf0f2881e3dfc4ad7824`
- `llp/0053-authorization-invalidation.rfc.md` at SHA-256
  `eb1c624c5a06facaaa32d51e0e5e6793d1ae68e532a36b64a8fb51f3391e1568`

**Reviewer family:** GPT (OpenAI)
**Provider / runtime:** OpenAI Codex CLI v0.144.1
(`codex exec --ephemeral`), model `gpt-5.6-sol`, reasoning effort
`xhigh`, sandbox `read-only`, workdir
`/Users/ccheever/projects/snapback-eng-24592-auth-review`.
Fresh thread `019f5b9e-36f1-7591-85ac-e1852780e494`; 3,542,430 input
tokens (3,327,488 cached), 13,239 output tokens, including 7,777 reasoning
tokens.
**Date:** 2026-07-13
**Review-body SHA-256:**
`63b346bb2cf00838cff4649d382472a67c41c6b6caf4871ff76f84ef8fc7b50a`
**Redacted:** no
**Method:** Fresh blind focused confirmation of the exact operative corpus. The
reviewer was forbidden from reading prior review artifacts, verified all six
hashes, inspected governing LLPs and relevant source, ran the reference checker,
and edited nothing. An earlier run against superseded hashes was interrupted
before verdict and is not recorded as a review.

### Review body (verbatim)

No material correctness, security, coherence, or implementability blocker remains. The correction closes the prior `ClientQuery` identity/GC conflict without reopening the agreed architecture.

Operative corpus verified against the requested hashes:

- `llp/0000-snapback.explainer.md` — `7957a27102d55ae3197e55d90553980c0d0fd0275f7df80547d7670501bcda03`
- `llp/0008-local-first-sync-and-realtime.rfc.md` — `f101a489c1e3d477b5f9c0322b6336827d8600930db67294d35dd32bb3b0b1ac`
- `llp/0011-auth-and-permissions.rfc.md` — `0045e02cec94cf101cfbb459edd180b1985ebe4f5d06dfcc95484730829623b1`
- `llp/0013-ephemeral-realtime-state.rfc.md` — `7447ed8b282e3ddda17663230903a2420c0394842cfcc2c3cb5039ff521630bb`
- `llp/0039-auth-vertical-slice.rfc.md` — `869c32c1d99c29bad14df40c7a6014e509b4b86c630cdf0f2881e3dfc4ad7824`
- `llp/0053-authorization-invalidation.rfc.md` — `eb1c624c5a06facaaa32d51e0e5e6793d1ae68e532a36b64a8fb51f3391e1568`

Focused confirmation:

1. `query_instance_id` is coherent throughout [LLP 0053](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:639): both subscription namespaces and `ClientQuery` scopes carry it; obligation revision, tombstone, resolution and ACK identity inherit it through the full `ScopeId`; compare-and-discharge checks it explicitly; leases, client store state, callbacks, and durable-write CAS tuples carry it.

2. Terminal destruction is crash-safe. The atomic `active → retiring` transition advances query and queue generations, applies the strongest disposition, and destroys payload, leases, overlays, boundaries, and executable queue custody. The durable `retiring` marker preserves exact tokens and owner continuity. Retirement cannot synthesize snapshot/quarantine ACK or permission proof, while an already-issued terminal-delete ACK is permitted only after deletion committed. Final removal preserves the allocator high-water, and recreation obtains a new id.

3. Missing state, mismatched instance identity, retired-frontier frames, and ordinary frames received while `retiring` are rejected before map lookup or allocation. The only retiring-state inputs are the narrowly defined terminal-delete completion and authenticated exact-owner retirement.

4. `RetryEpisode` intentionally uses authority subject, store, canonical query key, and unresolved witness floor—not query instance, scope, or revision. Re-fire, reconnect, restart, retirement, and same-key recreation reattach the existing episode without restoring its three-attempt/15-second automatic budget. Only an explicit authority-checked manual retry can open another episode.

5. GC is bounded by scalar high-waters and current/configured state: one store-wide instance allocator, issuer and scope frontiers, one minimal state per extant query, bounded active/unresolved scope entries, and retry caps of 10,000 globally and 1,024 per authority/store. No historical key or query-instance set is retained. Million-key and same-key churn are explicitly covered.

6. Acceptance covers I1 retirement and I2 recreation, crashes throughout retirement and ACK paths, two shared-store tabs, delayed I1 frames/callbacks/ACKs/resolutions, owner-continuity retirement, server-boot isolation, stale leases, and old-lease inability to mutate I2.

7. The activation matrices in [LLP 0039](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0039-auth-vertical-slice.rfc.md:1515) and [LLP 0053](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0053-authorization-invalidation.rfc.md:918) are identical: item 5 enables finite online sessions, item 6 unlocks negotiated auth-scoped live behavior, item 7 changes no admission state, and item 8 unlocks retained/offline reads. LLP 0039 correctly attributes coordinator/disposition execution, clear serialization, and incarnation to item 5 while assigning the invalidation fence itself to item 6. It now correctly describes quarantine as the item-6 live outcome and item 8 as its retained/offline extension.

8. [LLP 0013](/Users/ccheever/projects/snapback-eng-24592-auth-review/llp/0013-ephemeral-realtime-state.rfc.md:538) mirrors the complete pre-commit room contract: dependency ticket, registration/snapshot interlock, exact room barriers, admitted-permit quiescence, abort-on-prepare failure, exact-ticket rollback/finalization, ambiguous-commit suspension, and atomic generation checks at mutation, enqueue, destructive drain, and final send.

9. No stale current-state claim creates an implementation contradiction. The inspected implementation confirms the stated baseline gaps: destructive/sticky-overflow outboxes in [ephemeral.rs](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/ephemeral.rs:943), current fanout/error-resync behavior in [local.rs](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/local.rs:3869), retention scheduled before the disposed-boundary check in [index.mjs](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-contract/index.mjs:462), current stream/version-only client-store CAS and Web Lock serialization in [client-store.mjs](/Users/ccheever/projects/snapback-eng-24592-auth-review/packages/snapback-contract/client-store.mjs:457), connection-registry bounds in [server.rs](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/server.rs:850), and the current SHA-256/legacy-FNV replay split in [storage.rs](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/storage.rs:172) and [manifest.rs](/Users/ccheever/projects/snapback-eng-24592-auth-review/src/manifest.rs:1450).

`./ref-check --verbose` passed with 0 errors. The six files have no conflict markers, and `git diff --check` is clean. No files were edited; neither `.agent-local-secrets.md` nor `llp/reviews` was inspected. Status remains the author’s decision.

READY
