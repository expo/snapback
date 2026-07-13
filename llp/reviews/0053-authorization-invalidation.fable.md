# Review: LLP 0053 — Authorization invalidation (Fable / Claude family)

Artifact for the `/llp-super-refine` dual-model refine loop (LLP 0005 review
norms). One dated, numbered section per round; review bodies preserved verbatim.
Orchestrator verification and disposition notes sit outside the verbatim bodies.

This document was split out of LLP 0039 on 2026-07-12; the mechanism's earlier
review history (three failed design attempts) lives in
`0039-auth-vertical-slice.{fable,codex}.md`.

## Round 1 — 2026-07-12

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` at creation (sha256
`f15f285f448ba20b30bb18a4ebcf1ba1874dab44a8f47b0bf16b94981dc67518`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `f36fade7-baed-468d-95b0-b5573e21e232`; every assistant
message authored by `claude-fable-5` (verified against the session transcript).
Review body verbatim, including its one-line preamble.
**Date:** 2026-07-12
**Redacted:** No secrets in the brief; reviewer instructed not to read
`.agent-local-secrets.md` or `llp/reviews/`, and not to quote secret material.
Reviewed locally; nothing sent beyond the Anthropic models serving the session.
**Method:** cli-runner — fresh session, blind to the concurrent paired review and
to all archived reviews. The brief supplied the mechanism's three-attempt failure
history and directed the reviewer at the exhaustiveness stress cases.

### Review body (verbatim)

Both verification agents have returned with precise code facts, and every load-bearing factual claim in the document has now been checked against the shipped code. I have everything needed to write the review.

## Overall assessment

This is the strongest of the three attempts, and its core move is right: separating **result** dependence (rides the matcher) from **visibility** dependence (rides the epoch of a declared backing table) is the abstraction the previous two designs were missing, and the always-coarse-in-v1 rule correctly converts the most likely authoring mistake — naming the actor instead of the subject — into a precision cost rather than a correctness bug. The document's factual claims about the shipped system are almost all accurate: I verified the process-memory epoch map, the post-commit bump, the reset clear, the exact-equality resume comparison (`src/local.rs:835`, `1003`, `1411–1418`, `3611–3623`, `3700–3720`), the `clear_retained: true`-on-every-site behavior (`src/local.rs:1046,2783,3600,3658`; `src/ephemeral.rs:782`), the overflow queue-collapse-to-single-sentinel path (`src/ephemeral.rs:760–800`), the `AuthUser`/`Arg`/`Literal` prefix asymmetry (`src/local.rs:4014–4051`, `3759–3761`), and the demos' Ibex/ordered `live_replace` fallback (`demos/todo` `listTodos` is Ibex with `authScopeField: "userId"`; `demos/todo-v2` queries are ordered HostPlans, which `compute_live_delta` refuses at `src/live_matcher.rs:577`).

It is not, however, ready to move past Draft. I found one internal contradiction at the center of the durability section (the incarnation is "regenerated on restart," which nullifies the section's own purpose and conflicts with LLP 0039's restore design), one real exhaustiveness gap in the four-class model (shared tables whose visibility is decided by row fields — "mine OR public" — fit no class), an overbroad impossibility claim (the classification perimeter is declaration-triggered, so opaque handlers escape it entirely), and several under-specified disposition semantics, including a queue-collapse interleaving the acceptance misses and the shipped queue code would get wrong. None of these is a fourth systemic failure; all are fixable within the current design.

## Strengths

- **Class (c) dissolves the attempt-2 conflation cleanly** (§The classification model). The failure history is accurately diagnosed: a membership-gated shared table genuinely is neither user-disjoint nor an ACL, and the "result changes ride the matcher; visibility changes ride the epoch of the declared backing table" split is the correct factoring. I walked the card-game scenario (hands as class (a), moves/board as class (c), `gameMembers` as class (b)) and revocation, grant, and ordinary-move flows all produce correct behavior under the stated rules.
- **The always-coarse rule is the right safety posture** (§Invalidation). "Declarations narrow, never suppress" makes the wrong-but-subject-bearing declaration — the mistake a builder actually makes — cost precision, never correctness, and Open Question 1 correctly centers the proof obligation that graduation would require. This directly repairs the suppression self-contradiction the round-6 changelog in LLP 0039 records.
- **The monotone disposition is motivated by a real, verified defect** (§The invalidation signal). Both halves of the dilemma check out in code: every shipped resync sets `clear_retained: true` including the connection-wide overflow sentinel (`src/ephemeral.rs:776–785`), so a fail-closed client against today's server would blank the UI on a mere overflow; and the overflow path clears all three lanes and discards dropped `DurableMessage` payloads wholesale (`src/ephemeral.rs:770–772`, payload-only struct at `523–526`), so pinning overflow to `false` would indeed silently erase a queued revocation clear. The sticky-OR is the right shape of fix.
- **The epoch-durability diagnosis is exactly right** (§Epochs). Verified: the map is a `BTreeMap` in process memory born empty at construction, the bump runs after the durable commit with an explicit comment saying so (`src/local.rs:3611–3614`), `reset()` empties it (`local.rs:1003`), and resume compares raw `u64`s with no incarnation concept (`local.rs:3700–3720`). Same-transaction advancement plus an incarnation is the correct repair.
- **The no-regression pin is stated with unusual precision** (§Acceptance). The parenthetical about the demos falling back to `live_replace` rather than DK-3 deltas is correct against both the code and the manifests, and adding a genuinely unordered HostPlan fixture to carry the delta-path assertion closes the gap that precision opens. Existing demo manifests would also pass the proposed lint via class-(a) auto-classification (todo's `authScopeField`, todo-v2's `AuthUserId` equality predicates), so the lint itself does not break the shipped corpus.
- **The retained/offline section is honest** (§The retained and offline authorization contract). Retained reads staying disabled until the query-scoped primitive plus stored `(incarnation, epoch)` land matches the shipped client store, which has no epoch or incarnation fields and no per-query delete (only whole-map wipes, `packages/snapback-contract/client-store.mjs:92–151`, `200–202`). Naming unobserved offline revocation as physics, and forcing the `authorizedUntil` decision before re-enablement, are both the right calls.
- **The authoring-vocabulary hazard is real and correctly handled** (§Authoring vocabulary). The double-prefix trap is verified in code (`AuthUser` → `user:`-prefixed via `user_permission_scope`; `Arg`/`Literal` → raw strings), and the unprefixed `PermissionSubjectExpr` with `User(...)` applying the prefix once, plus legacy serialization preserved, is a clean compatible fix.
- **Scope discipline.** The split from LLP 0039 leaves clean seams: the coordinator/executor boundary ("0039 owns the coordinator; 0053 owns what the dispositions mean") is coherent from both sides, the non-goals accurately mirror 0039's, and the Status section's "Unreviewed" honesty about the four-class model is exactly the posture the corpus asks for.

## Concerns

**1. [HIGH] The incarnation is "regenerated on restart," which contradicts the section's own purpose, LLP 0039, and the rationale for same-transaction bumps.**
§Epochs says the incarnation is "regenerated on restart, reset, import, and declared physical restore," while the same section's closing sentence says this is "what LLP 0043's retained authorization epochs need in order to be trustworthy across restart." Both cannot hold: if every ordinary restart regenerates the incarnation, every comparison after a restart fails, every retained subscription and every resume resnapshots, and the epochs are not trusted *across* restart — they are discarded at it. It also makes the same-transaction bump requirement pointless: the crash-window it closes (a crash between write and bump) always implies a restart, which under this rule invalidates everything anyway. And it contradicts the umbrella: LLP 0039 §Protected identity core pins that "no in-directory anchor can distinguish restore from an ordinary restart, and an ordinary restart must *preserve* sessions," which is precisely why the operator-declared `--restored-from-backup` flag exists to regenerate the incarnation in the exceptional case. As written, the flag would be redundant for epochs.
*Resolves with:* persist the incarnation durably across ordinary restarts; regenerate it only on reset, import, and declared physical restore (matching 0039); add an acceptance row that an ordinary restart with unchanged epochs does **not** force resnapshot of retained subscriptions.

**2. [HIGH] The four classes are not exhaustive: shared tables whose visibility is decided by row fields fit none of them.**
Consider "my docs OR public docs" (also: link-shared rows, `status = 'published'` visibility, spectator-visible public games) — an auth-scoped function over a shared table whose visibility is authorized by fields *on the row*, not by any backing table. Class (a) fails: rows are not user-partitioned (public rows are visible to everyone), and declaring `authScopeField` anyway is exactly the lying-(a) staleness false negative the document warns against — the matcher would skip another user's edit to a public row (`field_scope_change_is_disjoint`, `src/live_matcher.rs:369–386`). Class (b) is absurd (the result table as its own ACL makes every write epoch-advancing — the attempt-1 storm). Class (c) requires a backing table that does not exist; self-backing recreates the storm. Class (d) is semantically false, and nothing pins that a lying (d) stays harmless if (d) later enables cross-user optimizations. The only escapes are decomposing one natural query into several subscriptions, or lying. The correct behavior for this shape — conservative matcher wake, re-query applies row-borne visibility, no epoch, no fail-closed clear (a `public → private` flip is an ordinary write whose replace removes the rows) — is exactly what the runtime already does; the model just has no class that *names* it, so the lint hard-fails a legitimate, common shape. This is the same failure genus as attempt 2 (a real app shape the classifier cannot express), one class further out.
*Resolves with:* a fifth declared class — row-authorized shared (visibility decided by matcher-evaluable row fields; matcher/delta path; no epoch; explicitly **no** disjointness-skip entitlement; documented property that its revocations are matcher-eventual, not fail-closed-cleared) — or an explicit, safety-argued widening of (d); plus an acceptance row exercising the mine-OR-public shape end to end.

**3. [MEDIUM] The classification perimeter is declaration-triggered, so the Summary's impossibility claim is overbroad — and the design rewards opacity.**
"An auth-scoped function is one whose *filter* references an auth variable, it declares `authScopeField`, or it declares any `permissionDependencies` entry" (§The classification model). An Ibex handler that reads `ctx.auth.userId` in its body and filters in JavaScript matches none of these: `ctx.auth` arrives as a materialized input projection (`HandlerInput.auth`), not a host call, so the dependence is invisible to capture and to the lint. Such a function escapes classification entirely, making the Summary's "unclassified auth dependence is impossible rather than merely discouraged" false as stated. The live path stays correct (conservative wake), and the retained path is closed only by an *unstated* chain — LLP 0008's syncable-live subset requires *declared* auth variables, so undeclared-auth functions are not retainable — which 0053 never pins. Worse, combined with Concern 2, the incentive inverts the corpus's analyzability bias (LLP 0004 §Design Inputs): an author whose shape the lint rejects can always evade it by going opaque.
*Resolves with:* scope the impossibility claim to the declared perimeter; pin the linkage "retainable ⇒ declared auth dependence ⇒ classified" as a load-bearing invariant of this document; and state the opacity escape honestly (ideally with a doctor diagnostic when captured Auth facts or auth-divergent results appear on an unclassified function).

**4. [MEDIUM] Disposition semantics are under-specified: `quarantine` has no producer, and the monotonicity rule misses two paths the shipped code makes concrete.**
(i) The reason table (§The invalidation signal) assigns `delete` and `retain` but no reason ever produces `quarantine`, and the client obligations distinguishing quarantine from delete (recoverable-but-unreadable vs. destroyed?) are never defined — yet the compatibility projection (`clear_retained == (disposition >= quarantine)`) and the retained contract's "quarantine/delete primitive" both load-bear on the distinction. (ii) The sticky-OR is scoped to "queue collapse," but the shipped overflow is *sticky*: once `overflowed = true`, subsequent pushes early-return as no-ops until drain (`src/ephemeral.rs:884–893`, `760–800`). A permission-epoch `delete` arriving *while the queue is already overflowed* is silently dropped and cannot escalate the parked sentinel — the acceptance covers permission-resync-**then**-overflow but not overflow-**then**-permission-resync, which under a `retain`-valued sentinel is a genuine false negative. (iii) Substitution emissions: `fail_subscription_fanout` (`src/local.rs:3595–3603`) emits a generic resync (e.g. reason `permission_resync_serialize_failed`) *in place of* a failed permission resync; under the new table "other recovery resyncs → retain," that substitution would silently weaken a delete. Monotonicity must hold wherever one signal stands in for another, not only at collapse instant.
*Resolves with:* name at least one producer per level and define each level's client obligation; extend the sticky-OR to the entire overflowed window (a stronger message escalates the parked sentinel's disposition); pin that any resync emitted as a fallback for another inherits that signal's disposition; add the overflow-then-revocation acceptance row.

**5. [MEDIUM] The coarse bump's blast radius is understated, and the uniform `delete` mapping silently diverges from LLP 0011's ratified contract.**
In v1, every class-(b) write synchronously blanks (clear-before-resubscribe) every auth-scoped subscription of every user and, once retained reads re-enable, destroys every client's retained slices — the coarse bump reaches all of them, and `permission-epoch change → delete` is unconditional. LLP 0011's ratified rule is narrower: "clients immediately mark affected results stale and, *for sensitive retained slices*, clear them before resubscribing." 0053 upgrades all slices to sensitive without naming the divergence, despite its own "Where 0011 pins a contract, 0011 wins" rule. And "permission-affecting writes are rare by design" is asserted, not evidenced: in the card-game proving demo, joins/leaves/kicks are routine lobby activity, and each one blanks every player's every auth-scoped view across unrelated games. Attempt 1 was rejected for globally clearing on every write; v1 of attempt 3 does the same on every *permission* write, with a harsher per-event consequence (synchronous clear plus retained destruction, not just resync). This is correctness-safe but is the document's largest unpriced product risk, currently deferred to Open Question 4.
*Resolves with:* name the 0011 divergence explicitly and justify it (or scope `delete` to subject-matched subscriptions and `quarantine` to coarse-reached ones — still fail-closed, since quarantine also clears); state the blast radius in §Invalidation in the same plain terms as the Motivation's storm critique; pin a measurable acceptance bound for unrelated-subscription disruption under the proving demo's membership-churn workload rather than leaving OQ4 purely open.

**6. [MEDIUM] The document does not contain the worked classification of its own proving demo.**
No card-game demo or manifest exists in the repo (verified: `demos/` holds `_kit`, `all-aboard`, `cursors-web`, `graffiti`, `todo`, `todo-v2`), and the acceptance defers the "worked classification report" to implementation time — but LLP 0039's landing order requires 0053 to reach **Accepted before item 6 starts**. That sequencing means the four-class model would be accepted with its motivating class (c) validated only in prose, when attempt 2 died precisely because the proving demo turned out to be unclassifiable and only independent review caught it. A worked table costs a page and is the cheapest possible falsification test.
*Resolves with:* an in-document worked classification (functions × tables × class × resulting invalidation behavior) for the card-game manifest sketch and for todo/todo-v2, reviewed as part of this document rather than discovered during implementation.

**7. [LOW] The ABA example is factually imprecise against the shipped comparison.**
§Epochs gives "(0 → 1 → reset → 0)" as the ABA, but `resume_requires_resnapshot` compares with exact *inequality* (`!=`, `src/local.rs:3717–3718`), so a client holding epoch 1 against a post-reset server at 0 mismatches and resnapshots — that specific sequence is caught today. The real ABA requires post-reset re-advancement back to the recorded value (0 → 1 → reset → 0 → new bump → 1). The incarnation fix is still fully justified; only the example is wrong.
*Resolves with:* correcting the example to the full cycle.

**8. [LOW] Lint mechanics are under-pinned against the shipped matcher and read summaries.**
The matcher honors `authScopeField` only when it is literally `"userId"` (`src/live_matcher.rs:139`), so a class-(a) declaration over any other field passes the proposed lint but earns no skip — safe, but the classification report would then overstate behavior. Ibex read summaries may be empty, which the matcher treats as "all tables" (`src/live_matcher.rs:132–134`), defeating per-pair enumeration at load time. The excess-capture safety net leaves open where the "coarse bump on next write" mark lives (process memory vs. durable) and whether exceeding the static summary demotes the function's retainability.
*Resolves with:* pinning that auth-scoped functions require complete declared table summaries; making the classification report reflect actual matcher capability per field; specifying the net's persistence and the retainability consequence.

## Suggestions

- **Field-granular permission backing.** Real schemas mix permission fields with ordinary fields (`users.role` beside `users.displayName`); table-granular class (b) makes every avatar write a global delete-storm, and the only escape is schema surgery the document never mentions. `ChangedRow.changed_fields` already exists and the matcher already consumes it — an optional `permissionFields: [...]` on a class-(b) table, bumping only when those fields change, is cheap and defuses the most common mixed-table shape. At minimum, document "split your ACL into its own table" as guidance and make the classification report warn on high-traffic (b) tables.
- **Concretize the OQ1 shadow-mode gate.** Always emit the coarse bump, derive subjects mechanically from `permissionSubjectField` over old/new rows, compare against declared subjects, and keep per-`(mutation, backing-table)` counters; promote suppression only for pairs with N clean production-equivalent observations, doctor-visible. Note the old-row source concretely: the `_snapback_changes` journal stores full `row_json`, so prior values are readable in-transaction — but journal pruning (LLP 0008 §Retention) can remove an ACL row's previous change, so derivation must degrade to coarse-only, which v1 already pays.
- **Define the client-derived disposition for the offline/boot path.** The disposition rides `resync_required`, but the stored-`(incarnation, epoch)` mismatch discovered at boot or reconnect has no message; pin it explicitly (quarantine-before-read, then resnapshot-and-release).
- **State the sentinel-escalation cost.** Queue collapse inheriting a subscription-scoped `delete` onto the connection-wide sentinel escalates one subscription's clear into every subscription's clear — correct direction, worth one sentence as an accepted cost.
- **Scope classification to subscribable reads, or say mutations are included deliberately.** Classes have operative meaning only for subscriptions; requiring classification of mutation read-set pairs adds authoring burden with no runtime semantics.
- **Group subjects.** The subject vocabulary is user-only; an ACL row granting a *group* (folder shared with an org) has no expressible subject set, so such writes stay coarse forever and suppression can never graduate for them. Even if unsolved, name the scope-algebra limitation in OQ2 — it is a different problem from "a fifth class."

## Open questions

Beyond the document's own five (of which OQ1 is correctly identified as central and OQ4 should be answered before, not after, the coarse-delete UX ships):

1. What are the client obligations distinguishing `quarantine` from `delete` for the retained store, and which reasons produce `quarantine`? (Concern 4.)
2. Does the incarnation persist across ordinary restarts? (Concern 1 — the document must answer this in one direction and reconcile 0039 either way.)
3. Can subject scopes ever express non-user subjects (groups, orgs, roles), and if not, is "those writes are coarse forever" an accepted permanent cost?
4. Is the classification obligation scoped to live/subscribable queries, or to every function including mutations?
5. When a subscription's captured reads exceed its static summary, does the function lose retainability until redeclared, or only trigger the coarse-bump net?

## Readiness verdict

Verdict: NOT READY

The core design is sound and is a genuine advance over all three prior attempts — the result/visibility separation, the always-coarse safety rule, the monotone disposition, and the durable incarnation-scoped epochs each repair a verified, real defect, and the document's claims about the shipped system are otherwise accurate down to the line level. But it cannot move past Draft with an internal contradiction in the durability section (incarnation regenerated on restart, Concern 1), a demonstrated exhaustiveness gap in the four-class model for row-authorized shared visibility (Concern 2), an overbroad impossibility claim whose true perimeter is undeclared (Concern 3), and disposition semantics that a shipped code path would already violate (Concern 4). All are repairable within the current architecture; with those fixed, the worked proving-demo classification added (Concern 6), and the 0011 divergence named (Concern 5), this document would be ready for the full multi-family loop its Status section rightly asks for.

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
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI 2.1.207 headless (`claude -p`), model
`claude-fable-5` (invoked as `claude-fable-5[1m]`), effort `max`. Fresh
non-interactive session `f2f7e0a1` (see transcript); every assistant message
authored by `claude-fable-5`.
**Date:** 2026-07-12
**Redacted:** Same as round 1.
**Method:** Same as round 1 — shared brief carrying the four-attempt failure
history, directing the reviewer to attack the reframe itself, the event-universe
closure claim, the online-only fallback, the obligation model, and the worked
classifications. Blind to the concurrent paired review and to all archived
reviews.

### Review body (verbatim)

## Overall assessment

Attempt 4 is the first structurally sound framing of this mechanism. The reframe — live correctness for connected subscriptions comes from the matcher plus re-query, and epochs exist only for what the matcher cannot observe — survives adversarial checking against the shipped code for v1's actual premises: I verified that captured read dependencies are consulted first and win (`src/live_matcher.rs:121-125`), that the `authScopeField` fallback is `userId`-only (`src/live_matcher.rs:139`), that point-read wakes cover the cross-table shapes (ENG-23420 tests), and that `ctx.auth` under LLP 0039 carries identity only (`roles` pinned `[]` for real sessions), which is precisely the premise that makes "authorization is either read data, identity, metadata, clock, or an operator verb" exhaust the input space. The three shapes that killed attempt 3 (mixed ACL/result table, hierarchy re-parenting, row-authorized sharing) genuinely need no special handling under this model, and the document's claims about shipped code are accurate essentially everywhere I checked — the post-commit process-memory epoch map (`src/local.rs:3611-3623`), the epoch-free seed path (`src/local.rs:1151-1155`), the bare-`u64` resume comparison (`src/local.rs:3700-3720`), the destructive drain and the overflowed no-op push (`src/ephemeral.rs:884-893`, `910-924`), and all three client-fence gaps (`packages/snapback-contract/index.mjs:420`, `436-443`; `client-store.mjs:147-151`). That level of verification discipline is rare and it shows.

The document does not fail in the way attempts 1–3 failed — I could not construct a connected-subscription shape whose authorization changes without either a matcher wake or an enumerated event, given v1's premises. But it has a fifth failure mode of its own, and it is *omission*, not classification: the retained-data safety chain ("Retainable ⇒ declared authorization dependence ⇒ enumerated events") hangs on a `permissionBacking` declaration that nothing forces an app author to write, and the "confined to the online path" argument does not cover the analyzable-but-undeclared case. Separately, the v1 cost model has a consequence the document bounds for live views but never states for retained data: under global coarseness plus the dispositions table, every membership write eventually destroys every retained slice of every user. Both are fixable within this design — neither requires a fifth redesign — but both are material, so the verdict is NOT READY, which matches the document's own request for another full round.

## Strengths

- **The reframe is correct for the connected case, and verifiably so** (§Summary, §What invalidation is actually for). The matcher's dependency gate wakes on any change to a captured `Row`/`MissingRow`/`Query` dependency and stays conservative when capture is absent (`src/live_matcher.rs:158-221`); joins and hierarchies are Ibex handlers whose ACL reads enter capture; re-scoping updates are caught because `field_scope_change_is_disjoint` refuses the skip when the scope field itself changed (`src/live_matcher.rs:369-386`). The hierarchy row of the worked table — the shape attempt 3 could not express — checks out against the code with no declaration at all.
- **The two orthogonal declarations dissolve the attempt-3 category error** (§Two orthogonal declarations). `gameMembers` being both result table and ACL stops being a conflict the moment result-delivery topology and authorization impact are separate axes. `permissionFields` riding the existing `changed_fields` (`src/live_matcher.rs:353-367` shows the matcher already consumes it) is a cheap, honest defusal of the mixed-table shape.
- **Every load-bearing code claim I audited is true** (§The authorization version, §Invalidation is an obligation, §Client fences). Including the subtle ones: the ABA example is stated correctly (naive `0→1→reset→0` *is* caught by `!=`; only re-advancement needs the incarnation), `clear_retained` is hardcoded `true` at all three emission sites (`src/local.rs:1046`, `3600`, `3658`; `src/ephemeral.rs:782`), and the sticky-overflow push really is a silent no-op (`src/ephemeral.rs:885-887`).
- **Obligations-not-messages is the right response to verified loss paths** (§Invalidation is an obligation). The shipped queue destroys on drain, loses on lost HTTP responses, and drops pushes while overflowed; LLP 0032 P4's "drains need no ack" reasoning (0032:1252-1255) genuinely does not hold for a revocation, and the document says so with the citation. The monotone disposition subsuming sticky-OR is cleaner than the round-1 patch it replaces.
- **The demotion of subject targeting to shadow mode is well-judged** (§Shadow-mode targeting). The shipped targeting machinery is not trustworthy: query-side capture only ever records `user:<own-id>` (`src/local.rs:3931-3960`), and the scope vocabulary is asymmetric — `AuthUser` produces `user:{id}` while `Arg`/`Literal` produce raw strings (`src/local.rs:4014-4040`), so a `kickPlayer` mutation declaring `Arg("targetUserId")` bumps a scope no subscription ever captured. Shadow mode with an oracle is the right way to earn trust the current mechanism has not.
- **Honest perimeter statements throughout**: the `authScopeField` fallback-vs-capture precedence, the `ChangedRow` single-row-image fact, the demos' Ibex/ordered `live_replace` delivery (verified: `demos/todo/snapback/functions.mjs:24-33`, `demos/todo-v2/snapback/functions.mjs:27-31`; ordered/Ibex queries bypass `compute_live_delta`), and the offline-revocation-is-physics admission.
- **The 0011 divergence is resolved in the parent's favor with a real producer for `quarantine`** (§Dispositions), matching 0011's ratified "for sensitive retained slices" clause exactly (LLP 0011 §Local-First bullet list).

## Concerns

**1. HIGH (decision quality / feasibility) — The v1 global-coarse blast radius is bounded for live views but unbounded — and unstated — for retained data, and the document skips a sound intermediate rung its own trust model licenses.**
Evidence: §Dispositions says a coarse event "hides-and-resnapshots every auth-scoped view of every user" and bounds that in §Acceptance ("Blast radius, measured not asserted") — but the `delete` row also fires on "any authorization event affecting a **retained** slice," and with a single global epoch every event reaches every retained slice. Once landing item 8 re-enables retained reads (LLP 0039 §Landing order), every routine `gameMembers` join/leave/kick — the proving demo's ordinary lobby traffic — durably **destroys every user's entire offline cache**, including retained todo rows whose authorization has nothing to do with the game. The blast-radius acceptance measures live-view disruption only; retained destruction at scale is never named, bounded, or gated. Meanwhile the design already trusts captured read sets for live-correctness *skips* (the matcher's entire skip logic is read-set-based), yet refuses to trust the same read sets to scope event-1 reach — inconsistent trust accounting. A table-scoped rung exists entirely inside this document's framework: an event-1 obligation need only reach subscriptions and retained slices whose read summary (or captured dependencies) includes the written `permissionBacking` table — a load-time-knowable, collision-free key requiring no subject derivation, no old/new rows, and no new trust beyond what live correctness already assumes. Under the reframe's own first row, connected subscriptions that read the backing table are *already delivered a corrected result by the matcher wake in the same commit frame* (`notify_permission_resyncs_in_frame` and `notify_live_subscriptions_in_frame` run back-to-back, `src/local.rs:1419-1425`), so quarantining them buys nothing the replace does not, while quarantining everything else is pure false positive. The document jumps from global-coarse straight to subject-scoped shadow mode, never examining or rejecting the table-scoped middle.
*Resolves with:* (a) state the retained-deletion consequence of global coarseness explicitly and either bound it in §Acceptance or gate item 8 on a mitigation; (b) either adopt table-scoped event-1 reach (obligations keyed on `permissionBacking`-table ∈ read summary; global reach reserved for events 2–4, which have no table key) or record an explicit argument for rejecting it; (c) specify what quarantine does to a pending optimistic queue on a not-proven-affected view (the common case under global events is an unaffected user mid-edit; §Client fences covers repopulation, not in-flight optimistic state).

**2. HIGH (correctness of the safety argument) — "Retainable ⇒ declared authorization dependence" has no enforcement mechanism, and the online-only confinement does not cover the analyzable-but-undeclared case.**
Evidence: §The authorization-event universe confines *opaque* auth dependence (ctx.auth read in code) to the online path and pins the invariant "Retainable ⇒ declared authorization dependence ⇒ enumerated events." But consider a perfectly analyzable, retainable-looking membership-gated query — the card-game board — where the app author simply **never declares** `gameMembers: permissionBacking`. The lint has no signal to refuse (that unknowability is exactly why the classification attempts died); live behavior stays correct (matcher wake), so nothing surfaces in development; but a kick fires no event, no epoch advances, and a disconnected or offline client's retained board slice never invalidates — a retained false negative, LLP 0008's named correctness-bug class (0008 §Reactivity: "false negatives are correctness bugs"). The doctor heuristic ("captured reads or auth-divergent results *suggest* undeclared auth dependence") is a net, not a gate. So the invariant is aspirational: the fifth failure mode of this mechanism is *omission*, and the document's honest-perimeter paragraph addresses opacity but not omission.
*Resolves with:* a load-time forcing function scoped to retention, not a resurrected taxonomy — e.g., a **retainable query must carry an explicit binary authority attestation for every table in its read summary** (`permissionBacking` or `authorityRelevant: false`), failing manifest load on any unattested table. This is per-retainable-query, two-valued, and orthogonal — none of attempt 3's result-topology confusion — and it converts silent omission into an explicit (L4-assertable, doctor-checkable) lie, matching how the `authScopeField` lie channel is already handled. It also answers the document's own Open Question 6 concretely. Add an acceptance row: an undeclared-ACL retainable query is refused at manifest load.

**3. MEDIUM (coherence) — Event 4's parenthetical invites a logout storm.**
Evidence: §The authorization-event universe, event 4: "Explicit out-of-band revocation (an admin/host-ops verb; **also what LLP 0039's session revocation calls into**)." LLP 0039's "session revocation" includes ordinary logout, sliding expiry, and refresh-reuse revocation. If those call into event 4, every user's logout advances the global authorization version and quarantines every auth-scoped view of every user. That contradicts 0039's own architecture, where session-scoped authority loss is handled by the two-phase revocation, typed auth-error close, and `AuthCoordinator` clearing — 0039's acceptance says the two paths "share one **client** mechanism," not one epoch. A session ending changes no other principal's data visibility (grants are user-level), so it should not be an authorization event at all.
*Resolves with:* one sentence scoping event 4 to authority-*changing* operator verbs (e.g., admin revocation of a user's access where no table write exists), and an explicit statement that ordinary session lifecycle (logout, expiry, per-session revoke, supersession) is owned by LLP 0039's session machinery and advances no authorization version.

**4. MEDIUM (coherence / enforceability) — The clock rule is self-contradictory as drafted and not detectable as scoped.**
Evidence: §The authorization-event universe: "a query whose authorization depends on the clock is **online-only**: non-retainable, non-auth-resyncable, **refused at manifest load** with `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`" — online-only and refused-at-load cannot both hold; §Acceptance repeats the flat refusal. Worse, "authorization depends on the clock" is not a lintable property: the lint can see `RuntimeNow` in a filter (`src/manifest.rs:863`; evaluable in SQL via `now_ms: Some(..)` in `src/storage.rs:2368`, unanalyzable to the matcher per `src/value_expr.rs:144`), but it cannot distinguish an auth-bearing `expiresAt > now` membership from a benign `dueDate < now` result filter — that distinction is exactly what the taxonomy failed to make. Note also that demoting clock-auth to online-only would *not* be safe: a connected subscription's grant expiring on the clock produces no wake ever, so "the conservative matcher is the safety net" fails precisely there — refusal is the right instinct; the drafting just has to commit to it.
*Resolves with:* restating the rule as it can be enforced: `RuntimeNow` (and any clock source) is refused in the filters/read paths of **subscribable and retainable** queries, regardless of what the field means; permitted in one-shot callable queries (evaluated fresh per call, no staleness window). Name the deadline-wake scheduler as the future work that would relax this, rather than implying a semantic auth/non-auth distinction the lint cannot draw.

**5. MEDIUM (specification completeness) — The obligation model is under-specified exactly where the shipped queue failed: identity, storage, and discharge.**
Evidence: §Invalidation is an obligation pins the record shape and monotonicity but not: (a) whether obligations are **durable state or derived state** — if stored independently of the `AuthorizationVersion`, they are a second source of truth that can diverge (and the crash-durability acceptance covers the version, not the obligation); if derived (an obligation *exists* iff a scope's last-satisfied witness < current version), the entire loss-path analysis collapses into the fence comparison and most of §Acceptance's queue tests become trivially true — the document should say which; (b) the **discharge rule for client-scoped obligations spanning multiple queries** — a client holds N retained slices and M live subscriptions; which "successful superseding snapshot" discharges a client-scoped `delete`, and what happens to the not-yet-resubscribed remainder; (c) the **acknowledgement channel** — retained-byte destruction is client-side work the server cannot observe except via ack, and that wire surface is nowhere pinned (0039's companion list defers "0053 registers its own manifest and wire vocabulary" back to this document). Also note obligation `scope: subscription` is fragile under the shipped reconnect model, where subscriptions die with the socket and reconnect is a fresh subscribe (LLP 0008 §Realtime Delivery close-out) — subscription-scoped obligations must be defined to survive identity churn or be re-derived.
*Resolves with:* pinning obligations as derived-from-versions wherever possible (stored only as per-scope satisfied-witness bookkeeping), a per-query discharge rule for client-scoped dispositions, the ack message shape (or an explicit statement that v1 needs no ack because fences make destruction self-enforcing at next read), and the subscription-churn rule.

**6. MEDIUM (the closure claim is asserted, not argued) — Open Question 2 already has a constructible answer the document should carry, with its premises pinned as conditions.**
Evidence: §The authorization-event universe enumerates four events but never argues *why* the universe closes. The argument exists and is short: everything a query's visibility can depend on is (identity from `ctx.auth`) ∪ (data it reads) ∪ (function/schema/authorization metadata) ∪ (the clock) ∪ (operator verbs on the store). Reads are the matcher's; metadata activation is event 2; store surgery is event 3; the clock is forbidden (concern 4); operator revocation is event 4; and identity is *constant for a live session* with its lifecycle owned by LLP 0039 — the last of which holds only because `ctx.auth` is identity-only in v1 (`roles` always `[]` for real sessions, 0039 §ctx.auth; LLP 0036's ratified v1 keeps config unreadable by queries; `_auth_*` tables are unreadable by `ctx.db`). Those premises are load-bearing and currently implicit, and each has a named future violation: a BYOP provider materializing claims into `ctx.auth` (a provider-side revocation is then a writeless authorization change with no enumerated event), config-readable query filters, and `dev↔sessions` auth-mode transitions (a trust-model change that arguably warrants incarnation rotation, not listed in §The authorization version's regeneration set).
*Resolves with:* carrying the input-inventory argument in the document as the answer to OQ2, and pinning the premises as explicit conditions on future work: claims never enter `ctx.auth` without either being pinned identity-only or firing event 4 on refresh; query-readable config joins event 2; auth-mode transitions rotate the incarnation (or an argument why epoch-advance suffices).

**7. MEDIUM (reach) — "Every auth-scoped view" under-reaches event 2, and "auth-scoped" is never defined.**
Evidence: §Dispositions scopes coarse-event quarantine to "every auth-scoped view of every user." A hot reload narrowing a filter (event 2) can strand rows on an **anonymous** subscription of a public or `optional-user` query — those rows are equally "rows the caller may no longer see," and nothing else re-delivers them (`apply_schema` leaves subscriptions live, per the ENG-23346 note in `src/ephemeral.rs:895-902`). Meanwhile "auth-scoped" — the term the blast radius, the dispositions table, and the no-regression pin all hang on — has no definition (function declares `authenticated`? input carries a user? an `Auth` dependency was captured?).
*Resolves with:* a one-line definition of auth-scoped, and a per-event reach matrix: event 1 reaches auth-scoped (or, per concern 1, table-scoped) subscriptions; events 2/3 reach **all** subscriptions of affected functions, anonymous included; event 4 reaches the named subject's sessions.

**8. LOW — `permissionFields` needs its conservative defaults pinned.** §Two orthogonal declarations restricts event 1 to `permissionFields` "when declared," but does not state that (a) an empty/absent `changed_fields` on an update must fire (unknown-fields is "unknown," and the matcher already treats it conservatively, `src/live_matcher.rs:357-359`), and (b) inserts and deletes of rows in a `permissionBacking` table always fire regardless of `permissionFields`. *Resolves with:* two sentences pinning both.

**9. LOW — Worked-table and vocabulary footnotes.** (a) `mine-OR-public` and the hierarchy join are not HostPlan-expressible today (filters are conjunctive; no joins) — both rows are necessarily Ibex handlers riding captured reads; a footnote prevents a reader from trying to declare them. (b) The `authScopeField` retainability condition ("retainable only if the assertion is enabled in its acceptance suite") couples safety to suite coverage — an L4 assertion catches a lying declaration only on workloads that exercise the lie; say "defense-in-depth," not "checked." (c) The shipped `permissionEpochBumps` vocabulary that v1 retires has live consumers (`demos/_kit/tests/provider-live-conformance.mjs:463`); the changelog should note the migration. (d) `SNAPBACK_PERMISSION_DEPENDENCY_UNCLASSIFIED` in LLP 0039's startup-code list is attempt-3 residue this abandonment orphans — add to the companion-obligations note. (e) Three names now denote one mechanism ("permission epoch" in code/wire, "authorization epoch" in the corpus, "authorization version" here); pick one and note the aliases.

## Suggestions

- **Per-backing-table authorization versions as the graduation rung before subject scoping.** Keep one durable version *per `permissionBacking` table* plus the global one for events 2–4; a fence becomes a small map keyed by load-time-known table names (collision-free — the mooted scope-key collision problem was a property of subject-derived keys, and does not apply). This targets live reach, retained deletion, *and* disconnected resume (a todo-only offline client stops resnapshotting because `gameMembers` churned) with zero subject derivation and zero old/new-row machinery. It composes with, rather than replaces, shadow-mode subject targeting.
- **Piggyback the current `(incarnation, epoch)` on every outbound envelope.** If every frame carries the current version, every message is a level-trigger carrier: a client observing version N+1 on *any* envelope self-triggers its fence sweep, and losing any particular wakeup frame stops mattering even before the obligation store lands. Cheap, and it makes the level-triggered claim mechanically true end to end.
- **Cite the "no shipped client read it" fact for `clear_retained`.** The code comment at `src/ephemeral.rs:773-775` records that no shipped client ever read the boolean — that is the rollout evidence that re-basing its semantics on `>= quarantine` (and sending `false` where today's overflow sends `true`) breaks nobody, and it belongs in §Dispositions' rollout paragraph.
- **Acceptance additions:** same-user re-login preserves fences and retained rows (the two-axis store's principal-scope promise); an anonymous subscription strands no rows across a narrowing hot reload; a pending optimistic mutation survives (or is explicitly stranded by) a not-proven-affected quarantine; a doctor smoke test for the undeclared-auth-dependence heuristic; and — if obligations are stored rather than derived — a crash between version advance and obligation creation.
- **Name the deadline wake as the future relaxation of the clock rule** (a tokio timer keyed on the min boundary timestamp is cheap on the local target), so the prohibition reads as staged, not permanent, and apps get told the sanctioned pattern (sweep-to-write) in the same breath.
- **Record the `AuthUser`/`Arg` prefix asymmetry** (`src/local.rs:3759-3761` vs `4029-4038`) in §Shadow-mode targeting as concrete evidence for the demotion — it is the sharpest available proof that the shipped subject targeting cannot be trusted, stronger than the unimplementable old/new derivation the document currently cites.

## Open questions

1. Can event-1 reach be keyed on read summaries / captured dependencies without any new trust assumption (concern 1) — and if not, what exactly is the additional risk beyond what live-correctness skips already accept?
2. What forces a `permissionBacking` declaration to exist for a retainable query (concern 2)? Is the binary per-read-table attestation acceptable authoring cost, and does it subsume OQ6?
3. Is ordinary session lifecycle inside or outside the authorization-event universe (concern 3)?
4. What discharges a client-scoped obligation covering multiple retained queries, and does v1 need a client acknowledgement wire surface at all if fences make destruction self-enforcing at next read (concern 5)?
5. When the first external provider lands, what pins provider claims out of `ctx.auth` — or their refresh into event 4 (concern 6)?
6. Should the fence be a per-table map from day one so item 8's retained re-enable does not have to migrate fence shapes later (suggestion 1)?
7. The document's own OQ5 (Cloudflare coordinator) — worth answering before Accepted only to the extent of confirming the contracts are *expressible* there; landing-order already confines v1 to the local target.

## Readiness verdict

Verdict: NOT READY

The core reframe is sound and verified — for the first time in four attempts, the residual concerns are about enforcement, reach, and cost rather than about a shape the model cannot express. But two concerns are material and unresolved in the current text: the retained-data safety chain rests on a declaration nothing forces (an omission-shaped false-negative channel that defeats the stated online-only confinement), and the v1 global-coarse design has an unstated consequence — routine membership writes destroying all retained data once item 8 lands — that the acceptance bounds only for live views, while a sound table-scoped alternative goes unexamined. The medium concerns (event-4 scoping, the self-contradictory clock rule, obligation discharge semantics, the unargued closure claim, event-2 reach) are each fixable with modest text, but several sit on load-bearing invariants. One more revision addressing these, and — per the document's own standard — a fresh round of review over the smaller diff, should get this to Accepted; the direction does not need to change again.

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

## Round 4 — 2026-07-12 (attempt six; FINAL — document frozen after this round)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` attempt six (sha256
`1f480e4f9ba7c9622ff47b2cdc0649d3a2214d8586e5a5f633734046febfc78e`).
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Claude Code CLI headless (`claude -p`), `claude-fable-5`
(`claude-fable-5[1m]`), effort `max`. Fresh non-interactive session.
**Date:** 2026-07-12
**Redacted:** No — reviewed locally.
**Method:** Fresh session, blind to all archived reviews. The brief carried the
full five-attempt failure history and instructed the reviewer that this was the
**final round** — the document freezes at whatever it says — and to be precise
about what is genuinely material versus polish.

**Author's freeze instruction (Charlie, 2026-07-12):** "fix the negative-delta hole
in 0053 … and run one more round, then freeze whatever it says."

### Review body (verbatim)

## Overall assessment

Attempt six is the first version of this mechanism whose architecture I could not break. The reframe is sound: I verified against `src/live_matcher.rs` that the shipped gate consults captured read dependencies first and lets their verdict win (`live_subscription_may_be_affected`, src/live_matcher.rs:112–156), treats an empty read summary as "all tables" (line 134), honors `authScopeField` only when literally `"userId"` and only as a fallback (line 139), and goes conservative on every unanalyzable predicate — so "the matcher wakes on any change to a table the query reads, and the re-query re-applies the query's authorization" is true for every *row-filtered* connected case, including the hierarchy and mine-OR-public shapes that killed attempts 2–3. The negative-delta/positive-delta asymmetry is the correct principle, and the document's claims about the shipped code are almost uniformly accurate — I verified the process-memory post-commit epoch map (src/local.rs:1411–1425, 3615–3623), the epoch-free seed path (src/local.rs:1151–1155), the bare-`u64` resume compare (src/local.rs:3717), the sticky-overflow drop (src/ephemeral.rs:884–893), the destructive drain (src/ephemeral.rs:910–924), the fire-and-forget retained writes (packages/snapback-contract/index.mjs:418–444, client-store.mjs:147–151), and the reset ABA (src/local.rs:1003).

But the document fails in a smaller version of the way attempt five failed: it states the right principle and then does not carry it into the two enforcement primitives that make it real. The obligation's discharge witness and the client fence are both specified as `(incarnation, epoch)` — a vocabulary that **does not move** for matcher-path removals, which are exactly the class attempt six exists to protect. As written, an obligation raised by a `public → private` flip can be discharged by acknowledging a snapshot computed *before* the flip, and a stale callback carries a *valid* fence past the check. Separately, the reframe silently assumes authorization always manifests as a **smaller result**, but LLP 0011's first authorization layer is function-level checks — a re-query that *throws* on lost membership lands in the fan-out-failure path, which the disposition table maps to `retain`, i.e. fail-open on a connected client. Both defects have precise textual fixes that do not reopen the architecture. The remaining concerns are coherence pins (the same-transaction durability claim is impossible for the matcher path; "auth-scoped subscription" is undefined; the closure argument's last step is a non sequitur that lands on the clock residual; design and acceptance contradict each other on whether ordinary deletes create obligations).

## Strengths

- **The reframe survives adversarial reading, and the code backs it** (§Summary, §Motivation, §Worked classifications). I attempted to construct a connected row-filtered shape the matcher misses and could not: conditional/data-dependent reads are covered because the branch condition is itself a captured read; binding-valued predicates evaluate to `None` and go conservative (src/live_matcher.rs:434–443); point-read dependencies wake cross-table joins (ENG-23420, src/live_matcher.rs:163–197); deletes carry the deleted row so hidden-row deletes prove disjointness without leaking (LLP 0020 implementation note, verified in `field_scope_change_is_disjoint`). The hierarchy row in the worked table is correct as stated.
- **The "honest note on what ships"** (§Safe by default) is *exactly* right against the code — `authScopeField` is `userId`-only, fallback-only, captured-deps-win (src/live_matcher.rs:139–151). A document that gets its own codebase right at this level of detail is rare, and it materially de-risks implementation.
- **Negative deltas are obligations; positive are best-effort** (§Negative deltas are obligations) is the correct minimal principle, and the failure analysis of the shipped queue it rests on is accurate: `push_durable` while `overflowed` is a silent no-op (src/ephemeral.rs:885–887), `drain()` pops before any delivery confirmation and resets the sticky flag (src/ephemeral.rs:910–923), and the HTTP drain's lost response is genuinely unrecoverable while the connection survives — unlike the WS path, where LLP 0032 S5.D5's "recovery by snapshot" applies.
- **The one-constraint framing and the lease honesty** (§The one constraint, §The lease) are the best sections in the document. Naming the CRL→OCSP→stapling→short-lived-certs arc, bounding the lease to honest clients, refusing to pretend it is anti-tamper, and gating hostile-client threat models on LLP 0043's encryption-at-rest question is exactly the honesty level this corpus's LLP 0008 bar ("false negatives are correctness bugs") demands.
- **Quarantine-then-prove** (§Dispositions) correctly fixes attempt four's cache-destruction storm while staying fail-closed, and giving `quarantine` a real producer resolves a long-dangling piece of the 0039 round-6 disposition design.
- **Machine-enforced retainability with the enforced/tested split stated honestly** (§The authorization-event universe): "declaration is enforced; truth is tested" is the correct epistemic status, and the L4-style convergence assertion for the one lie that can lose a wake is well-targeted (the shipped delta-membership `debug_assert` at src/local.rs:3566 is the right precedent to generalize).
- **Shadow-mode demotion of subject targeting** (§Shadow-mode targeting) is the right call, and its factual predicate is verified: `ChangedRow` carries a single row image; the journal stores full `row_json` readable in-transaction but subject to pruning (src/storage.rs:2262–2298), so "derive, compare, degrade to coarse" is the only honest v1 posture.
- **The mandatory-resnapshot-on-reconnect pin is free** — reconnect is already "a fresh subscribe, never a resume" (LLP 0008 §Realtime Delivery, P4 close-out), so the pin costs nothing today and correctly forecloses only the future delta-resume consumer for auth-scoped subscriptions.

## Concerns

1. **HIGH — The obligation witness and the client fence are epoch-vocabulary, which is blind to matcher-path removals; the discharge rule and the fence check are therefore satisfiable by stale state for exactly the removals attempt six was written to protect.** §Invalidation is an obligation pins discharge as "a successful superseding snapshot delivered *and acknowledged* under a satisfying `(incarnation, epoch)`," and §Client fences pins the fence as "the `(incarnation, epoch)` it was authorized under." A matcher-path removal (public→private flip, re-parent, ordinary delete) advances **no** epoch — the document says so itself. So: (a) *discharge race* — removal commits at version 100 and its delivery is lost (the premise of the mechanism); a snapshot computed at version 99 by a racing resubscribe arrives afterward and is acknowledged; it "satisfies" the unchanged `(incarnation, epoch)`, the obligation discharges, and the forbidden row is permanent on a connected client — the attempt-5 failure, reproduced one level up. (b) *fence race* — a callback that began before the removal carries the same unchanged pair, passes the fence, and repopulates the retained store; the shipped live path has per-subscription version-non-decreasing guards (LLP 0008 `applyDurable`), but `putRetainedQuery` overwrites unconditionally (client-store.mjs:147–151) and the proposed fence, as specified, adds no ordering for equal-pair writes. *Resolves with:* widening the witness and the fence to include the commit version (or a per-subscription monotone sequence): an obligation records the raising commit version, merge takes the max, discharge requires an acknowledged snapshot **computed at ≥ that version** under a matching `(incarnation, epoch)`; every fence-checked write (including retained-store writes) is additionally version-non-decreasing under an equal pair, with the pair change dominating version comparison.

2. **HIGH — Authorization expressed as a function-level denial produces a re-query *error*, not a smaller result, and the document routes that to `retain` — fail-open on a connected client.** The reframe's sentence "the re-query re-applies whatever authorization the query expresses" assumes shrinkage; LLP 0011 §Authorization Model's *first* layer is "function-level checks inside queries," and a natural authoring shape is an Ibex query that throws when a membership `ctx.db.get` comes back null. A kick then wakes the subscription via the captured `Row` dependency, the re-query **throws**, and the shipped path is `fail_subscription_fanout` (src/local.rs:3368–3376, 3579–3605) — which §Dispositions maps to `retain`: "resnapshot; **keep showing current rows meanwhile**." The resnapshot also fails (still denied), so "meanwhile" never ends: forbidden rows persist on a connected client with a failing resubscribe loop, no epoch (the worked table's hierarchy row explicitly tells authors no `permissionBacking` declaration is needed for join-mediated shapes), no obligation that changes anything, no reconnect, no lease. *Resolves with:* a third delivery class in §Negative deltas: a re-query outcome that is an **error or denial** on an auth-scoped subscription is treated as a negative delta — obligation-backed with disposition ≥ `quarantine` (typed `AUTH_PERMISSION_DENIED` immediately; untyped errors after a bounded retry, since a handler may throw a generic error for a denial), never `retain`. The §Dispositions producer column and the acceptance's obligation rows should carry the case.

3. **MEDIUM — The obligation durability claim is impossible for the matcher path, and the state machine's strongest sentence is therefore false where it matters most.** §Invalidation is an obligation: "stored server-side **in the same transaction as the authorization event that raised it**, so a crash between the two is impossible." Matcher-path removals are *discovered post-commit* in the fan-out (src/local.rs:1419–1425, 3284ff) — their obligations cannot be transactional with their cause. The crash window is in fact closed by a different mechanism (crash ⇒ connections die ⇒ reconnect ⇒ mandatory resnapshot), but the document neither says so nor distinguishes obligation durability by scope: subscription/connection-scoped obligations die with their scope at restart anyway (making durable storage for them pointless), while client-scoped obligations against retained data genuinely need durability. As written, an implementer either discovers the contradiction or builds durable per-delivery obligation writes into the fan-out hot path for no benefit. *Resolves with:* a per-scope durability model — enumerated-event obligations transactional with their cause; matcher-path delivery obligations raised post-commit with the crash window explicitly discharged by connection-death ⇒ reconnect ⇒ mandatory resnapshot; client-scoped obligations durable.

4. **MEDIUM — The closure argument's final step is a non sequitur, and the clock residual lands exactly on it; the Summary also contradicts the event universe about clock expiry.** §The authorization-event universe argues: an unenumerated source affects a query through data it reads (matcher wakes) or through something it does not read ⇒ undeclarable ⇒ non-retainable ⇒ online-only ⇒ "**mechanism 1 again**." But mechanism 1 wakes on changes to data the query *reads*; a source that affects the query through something it does *not* read (by hypothesis) never wakes the matcher — online-only or not. Online-only confines *retained/offline* damage (real and valuable); it does not summon the matcher for the connected view. The concrete instance is the clock: a JS `Date.now()`-mediated authorization predicate is undetectable at load (`ctx.auth` is materialized, not a host call — verified; JS clock reads leave no trace either), hence online-only, hence "safe" per the argument — yet a connected client keeps rows past expiry indefinitely, with no write, no wake, no reconnect. The document even *admits* this hazard ("a live client would keep access indefinitely") and then prescribes online-only, which does not remedy it. Meanwhile §Summary lists "a grant expiring on the clock" as something epochs exist *for*, while the event universe deliberately excludes it. *Resolves with:* (i) restating the closure argument over the **closed input surface of a query** — db state → matcher; `ctx.auth` → 0039 session lifecycle; args → static per subscription; code/schema → event 2; clock → named residual — which is the actually-sound version of the claim; (ii) stating the connected-online clock residual honestly (bounded only by app-level sweep cadence and reconnect, and undetectable for opaque handlers); (iii) fixing the Summary's example list; (iv) disambiguating whether `RuntimeNow`-in-auth-filters is refused outright for analyzable queries or demoted — the current triple "online-only, non-auth-resyncable, refused at manifest load" reads three ways.

5. **MEDIUM — "Auth-scoped subscription," the predicate that scopes the central rule, is never defined — and a declared-only reading recreates the attempt-5 hole on the exact class the fallback shoves everything into.** §Negative deltas applies the obligation rule to "an auth-scoped subscription"; §The authorization-event universe makes opaque `ctx.auth`-reading handlers *declare nothing*. If "auth-scoped" means "declares auth dependence," those online-only queries — where the conservative matcher is supposedly the safety net — get best-effort removals over the lossy outbox: a lost removal on a connected client, permanent, precisely attempt five's defect. *Resolves with:* a fail-closed definition pinned in §Two orthogonal declarations or §Negative deltas: every subscription is auth-scoped unless its function is explicitly `authorityIndependent`; undeclared ⇒ auth-scoped.

6. **MEDIUM — The design and the acceptance contradict each other on whether ordinary writes create obligations.** §Negative deltas: a removal is obligation-backed "whatever caused it — … or an ordinary delete." §Acceptance: "An ordinary write by one user advances no authorization version, **fires no obligation**, and clears no other client's rows." A user deleting their own todo is an ordinary write whose delivery removes a row the client holds — the design mandates an obligation; the acceptance forbids one. An implementer can satisfy at most one sentence. *Resolves with:* naming the two flavors (delivery obligations vs authorization-event obligations) and re-wording the acceptance pin to "no authorization-version advance, no coarse/quarantine obligation, zero resync amplification" — delivery obligations on one's own removals are cheap, expected, and discharged by the ack of the very delivery that carries them.

7. **MEDIUM — Obligation re-fire has no named trigger or bound.** §Invalidation is an obligation: "an unacknowledged obligation simply persists and re-fires on the next wakeup" — "wakeup" is undefined. A connected client whose hint frame was lost has no stated bound on when the removal lands; level-triggered state that nothing re-reads is edge-triggered in practice. The pieces for a bound exist (every drain could consult undischarged obligations; the shipped server has a defensive 30 s heartbeat, LLP 0008 §Realtime Delivery). *Resolves with:* pinning the re-delivery mechanism — every outbox drain and the heartbeat consult undischarged obligations for the connection — and stating the resulting promptness bound in §Acceptance.

8. **LOW — The LLP 0011 divergence is renamed rather than owned.** §Dispositions claims quarantine-then-prove is "the faithful reading" of 0011's ratified "clear … for sensitive retained slices." Quarantine (keep bytes, block reads) is a *justified narrowing* of "clear," not a reading of it — and this document's own header says "where [0011] pins a contract, it wins." 0039 already models the fix: companion dated addenda to 0011. *Resolves with:* a named 0011 dated-addendum obligation (alongside 0039's existing one) ratifying quarantine-for-retained as the successor to "clear," instead of the "faithful reading" claim.

9. **LOW — `permissionFields` needs the conservative rule for unknown `changed_fields`.** Journal-reconstructed changes carry an **empty** `changed_fields` by construction ("changed_fields is not journaled, so it is left empty," src/storage.rs:2262–2298), and the matcher treats empty-as-unknown conservatively (src/live_matcher.rs:357–366). The authorization-event check must pin the same rule — an update to a `permissionBacking` table with empty/unknown `changed_fields` **fires** the event — or a code path that loses field granularity silently loses authorization events. *Resolves with:* one sentence in §Two orthogonal declarations.

10. **LOW — The lease's honest-client clock-skew case is unnamed.** §The lease covers the hostile client that *lies* about its clock, but an honest client with a *wrong* clock (dead CMOS battery, drifted VM) silently extends the 24 h window too. *Resolves with:* naming the residual and, where the platform allows, pinning in-session enforcement to monotonic elapsed time from the server-issued grant rather than wall-clock comparison.

11. **LOW — Two implementation predicates of the negative-delta rule are unstated.** (a) Classifying a `live_replace` as row-removing requires the server to retain each subscription's last-delivered membership; the HostPlan delta path has it (dependency `rows`), and for Ibex the captured raw-read rows over-approximate the delivered result (safe direction — over-creates obligations), but the mechanism should be named. (b) Obligations discharge on **acknowledgement**, so the handshake's minimum-client-capability gate (§The lease, rollout pin) must cover ack support for *live* auth-scoped subscriptions in session mode, not only retained reads — an ack-incapable session client otherwise accumulates never-discharged obligations that re-fire forever. Also unstated: what supersedes the shipped function-level `permissionEpochBumps`/scope machinery (src/local.rs:4003–4051) once table-level `permissionBacking` plus the one commit hook land. *Resolves with:* a short "implementation predicates" note covering all three.

## Suggestions

- **Restate the closure argument as an input-surface enumeration** (see Concern 4's resolution). "A query is a function of (db state, ctx.auth, args, code/schema, clock); each channel has a named witness" is shorter, checkable, and answers Open Question 2 more convincingly than the event-source framing — a reviewer can ask "is the input surface closed?" of the runtime, which is a decidable question, instead of "is the event list complete?", which is not.
- **Consider making removals obligation-backed on *every* subscription**, not just auth-scoped ones. The predicate in Concern 5 exists only to exempt authority-independent queries from acks; a uniform rule deletes the predicate, the exemption, and one way to be wrong, at the cost of acks on public-data removals (which are also the difference between a deleted row vanishing and haunting a connected client forever — staleness, but the permanent kind).
- **Name the flicker cost of global-epoch quarantine on live views** in §Dispositions explicitly as a UX number the blast-radius acceptance must record: with one global epoch, every membership event hides every connected client's auth-scoped views for one resnapshot round trip (~50–150 ms at Valet baselines). The acceptance already measures disruption; saying "hidden-view duration per coarse event" is the metric would keep the shadow-mode graduation pressure honest.
- **Ship the retained-write version guard as the first client fence increment**: `putRetainedQuery` already receives `version` in its record (client-store.mjs) — refusing writes whose version regresses under an equal fence pair is a five-line change that closes the fence race for the store independent of the full coordinator barrier.
- **Add one line on the undeclared-restore epoch ABA**: 0039 names the undeclared-restore residual for sessions; the epoch inherits a cousin (a restored file re-advancing its epoch to a previously observed value under the preserved incarnation). Exposure is small — mandatory resnapshot covers reconnecting subscriptions; only the stale-render-vs-quarantine choice at boot is affected — which is exactly why it should be recorded as accepted rather than left for a future reviewer to rediscover.
- Attempt six's Status discipline — freezing with recorded known-unknowns rather than iterating indefinitely — is right, but given 0039 pins "0053 must reach Accepted before item 6 starts," the freeze note should say explicitly which recorded risks are *acceptance-blocking* versus *accepted residuals*, so the Accepted transition has criteria rather than vibes.

## Open questions

1. (Sharpened from Concern 1) What exactly does an acknowledgement name — a subscription snapshot version, an obligation id, or both — and which document owns the ack wire vocabulary given 0039's registry partition assigns wire/serde schemas to LLP 0051 D4 while 0053 "registers its own wire vocabulary"?
2. (Endorsing the document's OQ2, with the answer reframed) Is the *input surface* of a query function closed — i.e., can the runtime enumerate every channel by which a query's output can change (db, auth, args, code, clock) and point each at a witness? If Ibex query handlers ever gain another ambient input (a host call, an environment read), the closure argument must be re-derived; is that guarded by anything at the runtime boundary?
3. For the error-outcome class (Concern 2): what distinguishes a *denial* from a *transient failure* on the fan-out path, given handlers may throw untyped errors for denials — is bounded-retry-then-quarantine acceptable availability-wise, or does 0053 need a typed deny helper (0039's `AUTH_PERMISSION_DENIED` plumbing) as a prerequisite?
4. The document's OQ4 (lease default) and OQ5 (Cloudflare coordinator) stand; OQ5 deserves an explicit note that the coordinator's deploy-time subscription rebuild is *also* a resumption-from-non-live-state and therefore inherits the mandatory-resnapshot rule for free.
5. Does the obligation table need per-subscription scope keys that survive resubscription (the client re-subscribes with a *new* subscription id after every reconnect — LLP 0008 P4), or is connection/client scope plus mandatory resnapshot always sufficient? (I believe the latter, but the GC rule should say so.)

## Readiness verdict

Verdict: NOT READY

The architecture — matcher-carried live correctness, two orthogonal declarations, an enumerated event universe with machine-enforced online-only confinement, obligations for negative deltas, mandatory resnapshot, quarantine-then-prove, and an honestly-scoped lease — is sound, and nothing I found requires reopening it; after five failed designs, that is the headline. But two material correctness defects survive in the enforcement primitives: the obligation discharge witness and the client fence are specified in `(incarnation, epoch)` terms that never move for matcher-path removals, so both are satisfiable by stale state on exactly the class attempt six was written to close (Concern 1); and authorization expressed as a function-level denial routes through the fan-out-failure path to a `retain` disposition, which fails open on a connected client (Concern 2). Concerns 3–7 are internal-coherence defects an implementer would trip over (an impossible durability claim, an undefined scoping predicate, a non-sequitur closure step with a real clock residual on it, a design/acceptance contradiction, an unbounded re-fire). All have precise, local, textual resolutions stated above; with Concerns 1–7 resolved, this document is ready to freeze, and Concerns 8–11 plus the Suggestions may be recorded as non-blocking residuals in Status rather than fixed.

### Orchestrator verification notes — round 4 (outside the verbatim body)

**Verdict on the architecture, which is the headline:** *"The architecture —
matcher-carried live correctness, two orthogonal declarations, an enumerated event
universe with machine-enforced online-only confinement, obligations for negative
deltas, mandatory resnapshot, quarantine-then-prove, and an honestly-scoped lease
— is sound, and nothing I found requires reopening it; after five failed designs,
that is the headline."* No reviewer has produced an app shape this model cannot
express since the reframe landed in attempt four.

**Two material defects, both verified, both fail-open as written:**

- **The obligation discharged itself.** Discharge and the client fence were
  witnessed by `(incarnation, epoch)` — which, by the document's own design, never
  moves for a matcher-path removal. A snapshot computed *before* the removal (v99
  for a removal committed at v100) satisfies the unchanged pair, discharges the
  obligation, and leaves the forbidden row permanent on a **connected** client:
  attempt five's failure reproduced one level up, inside the mechanism built to
  prevent it.
- **A denied re-query showed forbidden rows forever.** LLP 0011's *first*
  authorization layer is function-level checks; the natural shape is a handler that
  throws when a membership lookup returns null. A kick makes the re-query throw →
  `fail_subscription_fanout` → a plain recovery resync → `retain` = "keep showing
  current rows meanwhile" — and the resnapshot throws too, so *meanwhile never
  ends*.

**Disposition — the honest freeze.** Freezing the document untouched would have
published a specification that is fail-open if implemented as written, which is
worse than no document. So the reviewer's **own prescribed resolutions** were
transcribed (commit-version witness; denial as a third negative-delta class;
per-scope obligation durability; fail-closed definition of "auth-scoped"; the
closure argument's non sequitur corrected and the clock named as a residual). These
are transcriptions, **not new design** — and the document's §Status says in plain
terms that **they are unreviewed**, that the next action is a review of them rather
than another design, and that the enforcement primitives (not the architecture) are
where this mechanism has now failed review twice running.

Final record: **six designs, five rejected, every defect found by an independent
reviewer and none by the author.**
## Joint consistency pass — 0039 ↔ 0053 — 2026-07-12

**Method:** Orchestrator-run cross-document check (not an independent review):
every cross-reference in both directions extracted and tested against the other
document's *current* text, plus an ownership sweep for concepts that could be
claimed by both or by neither.

**Why it was needed, stated plainly:** 0053 was redesigned six times during the
loop. Every time it moved, 0039's seam went stale — and because each document was
reviewed in isolation (by the author's instruction, correctly), no single-document
review could catch it. Two of the four defects below had already been caught inside
the individual loops; two were found only here.

### Findings

1. **0039 named 0053's *rejected* mechanisms as its owned model.** The seam said
   0053 "owns the dependency classification model … and the `resync_required`
   disposition." Classification was rejected in attempt 4 ("classification is the
   wrong primitive"); per-write `resync_required` is attempt 1 (the resync storm).
   0039 was describing, as its dependency, two designs 0053 had explicitly
   discarded. *Fixed:* 0039 names **outcomes only** and no mechanism — because 0053
   has moved six times and anything named there will go stale again.

2. **A category error that produced a live contradiction.** 0053's event 4 claimed
   "LLP 0039's session revocation calls into" it — routing a session loss through
   0053's *coarse-event → quarantine* path, while 0039 pins session loss to
   **delete**. They are different things and only sound alike: a **session**
   revocation ends an *identity* (authenticated → anonymous — 0039's authority
   transition; the client may hold nothing, so it deletes); a **permission**
   revocation narrows what a still-authenticated user may *see* (0053's
   authorization event; quarantine-then-prove). *Fixed:* 0053 removes the claim and
   states the distinction; 0039 owns session loss outright.

3. **The disposition enum was owned by neither, and item 5 needs it.** 0039 said
   "0053 owns what the dispositions mean" while requiring its coordinator to take a
   disposition at item 5 — which would have made items 1–5 depend on a 0053
   deliverable and **silently falsified the landing-independence claim**, the exact
   error the incarnation move had already corrected once. *Fixed:* 0039 owns the
   **enum** (a coordinator interface type; at item 5 the only value it produces is
   `delete`); 0053 owns **when each disposition is produced** and the escalation
   rules (item 6).

4. **A pinned decision was still described as open.** 0053 now *pins* the
   `authorizedUntil` lease (24 h default) and the `userId`-only retainability
   restriction; 0039 still described both as decisions to be made before item 8.
   *Fixed:* 0039 defers to the pins; landing item 8 is gated on 0053 being
   **reviewed**, not on an open decision.

### Landing-order integrity — re-verified after the fixes

Items 1–5 and 7 now depend on **no** 0053 deliverable: the incarnation is 0039's
(moved in round 7), the disposition enum is 0039's (moved here), session loss is
0039's own `delete`, and item 5 needs no quarantine, no obligation machinery, and
no epoch. The claim that the settled core can land and be proven while 0053 is
under review is **true as of this pass** — it was false twice before, both times
because a primitive drifted across the seam unnoticed.

**Also recorded:** 0039's landing order now states that 0053 is **frozen at Draft
with known-unreviewed enforcement fixes**, so item 6 is blocked — not as a
formality, but because 0053's enforcement primitives have failed review twice and
building them as written would build a fail-open mechanism.

## Round 5 — 2026-07-13 (ENG-24592 enforcement gate)

**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, `claude-fable-5[1m]`, effort `max`
**Method:** CLI runner, fresh foreground-only session, read-only tools; prior review artifacts supplied (not blind)
**Session id:** `6a723460-9fcc-4699-be2d-49cb4868ffa5`
**Reviewed SHA-256:** `e64dcb731745776511a8c85a571802548012a0f102554108f89a25da6c308cd7`
**Transcript SHA-256:** `8f89b9014fc05ffafe1ed271c6d98284dac5fa94bf2d3f0af2784222fc327aa4`
**Redacted:** no

All verification is done. Here is the review.

---

# Review: LLP 0053 — Authorization invalidation (Claude family, ENG-24592 gate)

**Reviewed:** `llp/0053-authorization-invalidation.rfc.md` at the current worktree revision, judged against `llp/0039-auth-vertical-slice.rfc.md` (seam and landing order), all prior `llp/reviews/0053-authorization-invalidation.{fable,codex}.md` artifacts (not blind — this is a gate review of known fixes), and direct source verification of the matcher, fan-out, outbox, client store, resume, wire, codegen, and runtime surfaces. Scope per the gate: the eight unreviewed enforcement fixes; the architecture is settled and I did not attempt a seventh design.

## Overall assessment

The architecture holds. I attempted no re-opening and found no reason for one: the negative-delta principle, the fail-closed auth-scoped definition, per-scope durability, and the corrected closure argument are all the right *shape*, and the reasoning recorded for each is sound. The failure is one level down, and it is the same failure §Status predicts for itself: **the prescribed fixes were transcribed into the explanatory prose but not into the normative artifacts** — the obligation record, the merge rule, the client fence, the dispositions producer table, and above all §Acceptance still encode the pre-fix design. A team that implements from the record, the table, and the acceptance rows — which is what those sections are for — builds both fail-open traces the round-4 review found, while §Status claims they are closed. Two findings are HIGH for exactly that reason; a third HIGH is an acceptance sentence that flatly forbids the obligation the central rule mandates, on the document's own canonical example. Separately, two factual baselines have gone stale against the shipped code (the client retained-write path now serializes and CASes; `Date.now()` is already refused at codegen and denied at runtime, so the named clock residual points at the wrong surface — the real one is `ctx.runtime.now()`).

For calibration: the parallel GPT-family gate review (codex round 4, 2026-07-13) and this review converge independently on the same two HIGH enforcement defects. Everything here is fixable with local text; nothing requires reopening the architecture.

## Strengths, with exact sections

- **§Negative deltas are obligations; positive deltas are best-effort** — the general rule ("the shrinking of the result set is the security event, whatever caused it") and the denial bullet ("an error or denial outcome … is obligation-backed with disposition ≥ `quarantine`, never `retain`") are the correct minimal principles, and the denial bullet's description of the shipped path is accurate: a throwing re-query lands in `fail_subscription_fanout` (`src/local.rs:3958`, reason `live_refresh_failed`; substitution site at `src/local.rs:4247` with reason `permission_resync_serialize_failed`).
- **§Negative deltas — the fail-closed "auth-scoped" definition** ("every subscription is auth-scoped unless explicitly declared `authorityIndependent`; undeclared means auth-scoped") closes the declared-only hole precisely, and the text correctly identifies why the opposite reading is attempt five's defect in disguise.
- **§Invalidation is an obligation — the Discharge paragraph** is the right fix stated with the right reasoning: the callout ("the witness must be the commit version, because that is the only thing that actually moves when a row leaves a result set") is exactly correct. The defect (Finding 1) is that this paragraph is the *only* place the fix lives.
- **§Invalidation is an obligation — per-scope durability** is honest engineering: the blanket same-transaction claim really is impossible for post-commit matcher discoveries, the crash-window-closed-by-reconnect argument is valid, and refusing durable writes on the fan-out hot path is the right cost call.
- **§The authorization-event universe — the corrected closure argument** ("an unenumerated event source cannot corrupt retained data, and can leave a connected view stale") repairs the non sequitur without overclaiming; the enforced-vs-tested split ("declaration is enforced; truth is tested") remains the correct epistemic posture.
- **§Dispositions (quarantine-then-prove) and §The lease** remain sound from prior rounds; the lease's honest threat model is still the best-written safety text in the corpus.
- **§Status** — the freeze discipline, the explicit unreviewed list, and "the enforcement primitives are the risk" framing made this gate review efficient and targeted. That practice should be kept.
- **The 0039 seam** (LLP 0039 §Permission dependencies, §Landing order) is correctly drawn: outcomes only, incarnation and disposition enum owned by 0039, item 6 explicitly blocked pending this review, items 1–5 and 7 verifiably free of 0053 deliverables.

## Findings

### HIGH

**1. The commit-version witness exists only in the Discharge prose; the normative obligation record, merge rule, client fence, and acceptance still specify the epoch pair — and §Status claims otherwise.**

*Evidence.* The record still reads `witness: (incarnation, epoch)` (0053 §Invalidation is an obligation, ~line 451); Identity/merge raises only `max_disposition` with no rule for the causing-version floor (~457–459); §Client fences still defines the fence as "the `(incarnation, epoch)` it was authorized under" with no version component and no ordering rule for equal-pair writes (~594–599); §Acceptance still says "an obligation is discharged only by a superseding snapshot under a satisfying `(incarnation, epoch)`" (~705–706). §Status nonetheless claims "Obligation discharge **and the client fence** … Now witnessed by **commit version**" (~780–784) — true for the discharge paragraph, false for the record, merge, fence, and acceptance. The fence section's code baseline is also stale: retained writes are now serialized per key and the store compare-and-sets by `(stream, version)` (`packages/snapback-contract/index.mjs:471–483`, `client-store.mjs:567–587`) — but that CAS applies only when a current record exists, so after a quarantine/delete removes the record, a delayed pre-removal write proceeds unconditionally. The shipped CAS does not close the race the fence must close; a tombstone/fence that survives deletion is still required.

*Failure trace.* Removal commits at version 100; the pair does not move. A racing resubscribe's snapshot computed at 99 is acknowledged afterward; it satisfies the record's unchanged pair and the acceptance row, and the obligation discharges — forbidden row permanent on a connected client, the exact trace the fix was transcribed to kill. Fence side: quarantine deletes the retained record; a delayed version-99 callback finds no `current`, passes the CAS vacuously, and repopulates the store under the unchanged pair. Merge side: removals at 100 and 105 merge with no rule preserving the 105 floor; an ack at 102 discharges both.

*Resolution.* Make the witness composite in every normative site, not just the prose: the record carries `(incarnation, epoch)` **plus version stream and minimum commit version**; merge takes the max disposition **and** the max causing version within a stream; pair/stream change dominates version comparison; every fence-checked write (including retained-store writes) is version-non-decreasing under an equal pair, checked against a persisted quarantine/delete tombstone that survives record removal; acceptance discharges only on an acknowledged snapshot satisfying the *composite* witness. Update the fence section's code baseline (serialized + CAS, tombstone still missing) and make §Status's claim true. This is a protocol pin required before implementation.

**2. Denial/error is still normatively routable to `retain`: the dispositions producer table and §Acceptance never received the third delivery class.**

*Evidence.* The rule (§Negative deltas, ~196–209) says error-or-denial ⇒ obligation-backed, ≥ `quarantine`, never `retain`. The producer table (§Dispositions, ~513–517) still maps unqualified "ordinary recovery resync (`outbox_overflow`, **fan-out retry**)" to `retain` and contains no error/denial producer. §Acceptance's obligation-durability block has no denial case — no typed-deny row, no untyped-throw row, no repeated-failing-resnapshot row. The shipped path makes the ambiguity concrete: every re-query failure funnels through `fail_subscription_fanout` (`src/local.rs:3946/3958/3970`, `4164`), which emits exactly the "recovery resync" the `retain` row names.

*Failure trace.* A kick wakes a membership-gated query whose handler throws on the null membership lookup. The implementer, holding the producer table, maps the fan-out failure to `retain` — "keep showing current rows meanwhile." Every resnapshot throws too; "meanwhile" never ends. Forbidden rows persist on a connected client behind a failing resubscribe loop: the round-4 HIGH-2 trace, alive in the table the implementer will actually code from.

*Resolution.* Add the denial/error producer row (≥ `quarantine`, obligation-backed) and qualify the `retain` row to outcomes that are provably not authorization-negative (overflow with no swallowed negative delta — the escalation rule already covers the swallowed case — and `authorityIndependent` subscriptions). State whether untyped errors get a bounded retry before quarantine and name the bound. Add acceptance rows: typed `AUTH_PERMISSION_DENIED`, untyped throw, repeated failed resnapshots, lost/overflowed quarantine delivery, and substitute-resync disposition inheritance for the denial case.

**3. §Acceptance forbids the obligation the central rule mandates ("fires no obligation"), and its restart row contradicts mandatory resnapshot; the 0039 seam mirrors both.**

*Evidence.* §Negative deltas (~188–192): a delivery that removes any held row is obligation-backed "whatever caused it — … or an ordinary delete." §Acceptance (~675–684): "An ordinary write by one user advances no authorization version, **fires no obligation**, and clears no other client's rows — in todo, todo-v2, **mine-OR-public**, …" and "the pin is *no epoch, no obligation, no resnapshot beyond what ships*." The `public → private` flip in mine-OR-public is this document's canonical negative delta — the round-3 defect the whole rule exists to close. Second half: §Design pins resnapshot for "every resumption from a non-live state … process restart, page reload …" (~236–246), while §Acceptance says an ordinary restart "does not force retained subscriptions to resnapshot" (~715–717). LLP 0039 carries the same two phrases at the seam ("Ordinary writes do not resync," ~1018–1023; "must not force every retained subscription to resnapshot," ~1012–1015).

*Failure trace.* An implementer writes the acceptance test as specified: assert zero obligations for the mine-OR-public flip. A correct implementation fails the test; the "fix" that passes it recreates the permanent lost-removal defect — the acceptance suite becomes a machine for blessing the fail-open build. The restart row similarly licenses rendering an auth-scoped retained view after a resume without the revalidation §Design mandates.

*Resolution.* One vocabulary distinction, applied in both documents: **delivery obligations** (per-subscription, raised by any result-shrinking delivery, discharged by the ack of the delivery that carries them, cheap, expected) versus **authorization-event obligations** (coarse, epoch-witnessed). Reword the no-regression pin to "no authorization-version advance, no coarse/quarantine obligation, zero resync amplification — delivery obligations on one's own removals excepted." Reword the restart rows both places to "an ordinary restart does not invalidate retained data or force quarantine-before-read; any subsequent live resumption still resnapshots — that is the reconnect rule, not the incarnation." I rate this HIGH rather than the parallel review's MEDIUM because acceptance text is the artifact implementations are tested against, and the contradicted sentence sits on the document's central fix.

### MEDIUM

**4. Per-scope obligation identity is under-pinned: the scope field is a category, "keyed durably" contradicts the non-durable scopes, and enumerated-event obligations have no target-enumeration or multi-query discharge story.**

*Evidence.* The record carries `scope: subscription | connection | client` — a discriminant, not an identifier (~449). Identity says "one obligation per `(client, scope)`, keyed durably" (~457) while Durability makes subscription- and connection-scoped obligations explicitly non-durable (~470–474); the §Negative deltas bullet also calls every negative delta "durable," which the per-scope split then correctly walks back. "Enumerated-event obligations are written transactionally with their cause" never says how the causing transaction enumerates its targets (offline retained clients are not enumerable from inside a commit unless the durable authorization version itself is the projection source). No rule says which snapshot discharges a client-scoped obligation spanning N retained queries.

*Failure trace.* An implementation keys obligations by transient subscription id; reconnect mints a fresh id (reconnect is a fresh subscribe — LLP 0008 P4), the old scope is GC'd, and a retained query silently loses the durable quarantine it still needs. Or: a coarse event commits, per-client obligations are materialized post-commit despite the transactional claim, and a crash leaves no durable object to reproject them from.

*Resolution.* Pin an event-scope matrix: the transactionally durable cause (the authorization version itself), the post-commit live projection (subscription/connection scopes, non-durable, safe via reconnect-resnapshot), and durable client/query-scoped state for retained data — with the actual scope discriminator, its behavior across resubscribe/reconnect/restart/GC, and the per-query discharge rule for client-scoped dispositions. Clarify that "durable" in §Negative deltas means "persistent until discharged," which the per-scope split then refines.

**5. Acknowledgement and re-fire have no protocol contract, and the legacy capability gate covers retained reads only — a disposition-ignoring live client defeats quarantine.**

*Evidence.* Discharge requires delivery *and acknowledgement*; re-fire happens "on the next wakeup" — "wakeup" is undefined, and no promptness bound exists in §Acceptance. The client→server socket vocabulary has no acknowledgement variant at all (`src/live_wire.rs:146–177`: subscribe/publish/delete/unsubscribe/ping). The rollout pin (§The lease, ~580–583) gates only "session-mode retained reads" on client capability, while `quarantine` requires a *connected* client to hide live rows; the shipped kit ignores `clear_retained` entirely and answers `resync_required` with `void resubscribe(...)`. The shipped 120 s subscription reaper plus HTTP polling supplies the sharpest instance: a reaped subscription's later polls return an empty, healthy-looking drain.

*Failure trace.* The sole removal hint is lost on a quiet connection; the obligation persists but nothing ever re-reads it — level-triggered state nobody consults is edge-triggered in practice. Or: a session-mode client that predates dispositions holds an auth-scoped live view through a coarse event; it never hides, never acks, and accumulates never-discharged obligations forever.

*Resolution.* Protocol pins before implementation: (a) every outbox drain, connection open, subscribe, and the existing heartbeat consult undischarged obligations for the connection, with a stated promptness bound in §Acceptance; (b) a poll/drain against an unknown or reaped subscription returns a typed resnapshot-required signal, never an empty healthy drain; (c) what an acknowledgement names — scope identity, composite witness (pair + stream + version), disposition — and that discharge is compare-and-discharge against the current obligation, stale acks failing; (d) the handshake capability gate covers disposition-and-ack support for **all** session-mode auth-scoped live subscriptions, not just retained reads. Exact wire encoding can stay with the implementing spec; the semantic contract cannot.

**6. The clock residual names the wrong surface: `Date.now()` is already refused and denied; the real opaque surface is `ctx.runtime.now()` — and §Acceptance overclaims blanket manifest refusal.**

*Evidence.* 0053 claims "a JavaScript `Date.now()`-mediated authorization predicate is undetectable at load … a JS clock read leaves no trace" (~394–397; repeated in §Status ~793–797). Verified false: codegen bundle admission rejects `Date.now`/`new Date` (`packages/snapback-codegen/index.mjs:1901`, `BUNDLE_UNSUPPORTED_TIME`), and the deterministic Ibex tier denies `Date.now` and zero-arg `new Date()` at runtime (`src/runtime.rs:1756–1780`). The surviving sanctioned clock is `ctx.runtime.now()` (`packages/snapback-harness/ctx-bootstrap.js:495–501` → host op `"runtime.now"`, `src/runtime.rs:749`, wall-clock-seeded at `src/runtime.rs:483–488`). Because it is a **host call**, it is *not* traceless — it is observable at invocation, so runtime denial or capture-triggered demotion for subscribable/retainable functions is available enforcement, stronger than the "authoring guidance plus doctor diagnostic" the text settles for. Meanwhile §Acceptance (~695–697) says "a query whose authorization depends on the clock is refused at manifest load" — unqualified, contradicting the Design's own honest scoping to the declarable `RuntimeNow` form.

*Failure trace.* The residual test as the RFC frames it (`Date.now()` in a handler) fails at codegen and cannot demonstrate the claimed behavior; conversely an opaque handler calls `ctx.runtime.now()`, publishes a time-limited result, and the connected view goes permanently stale — while the acceptance row claims such queries are refused at load.

*Resolution.* Name the three surfaces and their enforcement stages: declarable `RuntimeNow` in auth filters → load-refused (`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`); ambient `Date` → codegen/runtime-denied (already shipped); `ctx.runtime.now()` → either pinned as runtime-denied in subscribable/retainable handlers (which would close the connected-view residual for Ibex) or explicitly admitted as *the* named residual with the doctor keyed to the observable host call. Align Summary, Design, Acceptance, and Status; scope the acceptance row to what is actually refused.

**7. The negative-delta trigger — detecting a shrinking `live_replace` — is unpinned for general Ibex output.**

*Evidence.* The rule fires on a delivery that "removes any row the client is known to hold." The subscription record retains input and captured read dependencies, not last-delivered logical output; the Ibex fan-out builds `LiveReplace` from the fresh query output with no comparison against prior deliveries (`src/local.rs:3953–3966`). Captured raw-read rows over-approximate only when output rows are dependency rows; a projecting/aggregating/synthesizing handler breaks that mapping, so raw-read comparison cannot prove an output row was removed.

*Failure trace.* An Ibex query synthesizes output; a re-query at v100 omits a previously delivered output row; no dependency-level comparison detects the removal, no obligation is raised, the replacement frame is lost on the destructive drain (`src/ephemeral.rs:951–1053` sticky overflow; destructive drain unchanged) — permanent, with the mechanism nominally in place.

*Resolution.* Pin one predicate before implementation: retain each auth-scoped subscription's last-delivered logical membership (with defined output-row identity), **or** conservatively obligation-back every auth-scoped `live_replace` (safe direction; costs acks on non-shrinking deliveries). Enforcement detail, not architecture — but it decides the obligation volume and must be in the RFC.

**8. Quarantine's client-state semantics contradict the clear barrier: "keep bytes, recoverable" versus "remove overlays and queues" — unspecified for pending mutations, and multiplied by the global epoch.**

*Evidence.* §Dispositions: quarantine "hide from render immediately and block reads; keep bytes; release on a superseding snapshot…"; "Cost is a hidden view and a re-query, not a destroyed cache." §Client fences: the barrier — "persisted atomically with the quarantine/delete" — is "hide live rows → **remove overlays and queues** → commit the durable transition → then permit resubscription," undifferentiated by disposition. Nothing states what happens to a pending optimistic queue on a not-proven-affected view, the common case under a global coarse event.

*Failure trace.* Routine lobby churn in the card game fires a coarse event; every user's coordinator runs the barrier; every user's in-flight optimistic edits and queued mutations are destroyed on what quarantine's own rationale says is "mostly a false positive." The recoverability that justified quarantine over delete is silently lost for exactly the state users care about losing.

*Resolution.* A per-disposition client-state matrix (live rows / retained bytes / optimistic overlays / pending queue): quarantine hides and *suspends* overlays and queued work pending revalidation (released or stranded-for-discard on proof); delete destroys. Add the pending-mutation dimension to the blast-radius acceptance metrics.

### LOW

**9. The fail-closed auth-scoped rule has no acceptance row, and `authorityIndependent` has no declared surface.** §Acceptance never tests that an *undeclared* function's removals are obligation-backed, nor the `authorityIndependent` opt-out; and the declaration itself appears only in prose — §Two orthogonal declarations never says where it lives (function-level manifest field? which vocabulary?). *Failure trace:* a suite passes while obligations apply only to declared-auth functions — the opaque-handler hole reopened. *Resolution:* acceptance fixtures for undeclared ⇒ auth-scoped and for the explicit opt-out; pin the declaration's surface and name alongside `authScopeField`/`permissionBacking`.

**10. `permissionFields` still lacks the conservative unknown-fields rule.** Journal-reconstructed changes carry empty `changed_fields` by construction, and deletes carry the preimage with no field list; the matcher already treats empty-as-unknown conservatively. §Two orthogonal declarations (~282–291) never pins the same for the authorization-event check. *Failure trace:* a journal-reconstructed update (or a delete — the canonical kick) intersects an empty field list, and the event is suppressed. *Resolution:* two sentences — inserts and deletes on a `permissionBacking` table always fire; updates with empty/unknown `changed_fields` fire; field narrowing applies only to updates with known, provably disjoint fields.

**11. The offline/boot pin maps every stored-pair mismatch to quarantine-then-release, while the dispositions table makes reset and declared restore `delete` producers.** (§Retained and offline, ~616–618 vs §Dispositions.) An incarnation mismatch at boot is indistinguishable, under the pinned rule, from an epoch advance — the client quarantines and releases-on-snapshot where the table demands destruction. End state is fail-closed either way (the superseding snapshot replaces the data), so this is coherence, not a leak — but pin it: incarnation mismatch ⇒ `delete` (or record why quarantine-then-supersede is deliberately sufficient).

**12. LLP 0039 carries stale seam vocabulary.** The Open Questions hand-off (~1519–1523) still moves "whether the classification model needs a fifth class" (classification was rejected in attempt 4) and "what `authorizedUntil` default ships" (pinned at 24 h; only the number's ownership is open) to 0053. And once Finding 3's delivery-vs-event vocabulary lands, the seam's "ordinary writes do not resync" and the restart sentence need the same qualification. *Failure trace:* a landing planner treats rejected classification work or the settled lease as unresolved prerequisites. *Resolution:* replace the paragraph with 0053's actual open questions; mirror Finding 3's rewording.

## Open questions

1. What composite value does an acknowledgement name — scope identity, `(incarnation, epoch)`, version stream, commit version, disposition — and which document owns its wire schema, given 0039's registry partition assigns wire/serde schemas to LLP 0051 D4 while 0053 "registers its own wire vocabulary"?
2. What stable identity names client/query-scoped obligations across resubscription, reconnect, multiple tabs, and restart (Finding 4's discriminator)?
3. Is `ctx.runtime.now()` in subscribable/retainable handlers to be runtime-denied (converting the connected-view clock residual into a refusal, since it is an observable host call) or deliberately admitted as the named residual? The current text assumes the residual is undetectable; it is not.
4. For general Ibex output (Finding 7): retain last-delivered logical membership, or conservatively obligation-back every auth-scoped `live_replace` — and what is the acceptable ack amplification of the conservative choice?
5. Once denial ⇒ quarantine, what remains a legitimate `retain` producer for an auth-scoped subscription, and do untyped transient errors get a bounded retry before quarantine (availability vs. fail-closed) — and who owns the bound?
6. Does quarantine suspend or strand pending optimistic mutations (Finding 8), and does that answer change the blast-radius acceptance metrics that gate shadow-mode graduation priority?

## Recommended next step

Revise LLP 0053 in place — no seventh design; nothing above touches the architecture. One revision should: carry the composite commit-version witness into the obligation record, merge rule, client fence, §Acceptance, and §Status (Finding 1); add the denial producer row and denial acceptance cases (Finding 2); introduce the delivery-vs-event obligation vocabulary and fix the two acceptance sentences, mirrored into 0039's seam (Findings 3, 12); pin the per-scope identity matrix, ack/re-fire/capability contract, the clock surfaces, the `live_replace` shrink predicate, and the per-disposition client-state matrix (Findings 4–8); and fold the LOW pins into acceptance (9–11). Then run one focused independent review of that diff — these fixes will be the third consecutive set of author-side enforcement edits, and this document's own §Status records that unreviewed enforcement text is exactly where it fails. Keep LLP 0039 landing item 6 blocked until that review passes.

**Safe to implement as written: no.** The normative sections still specify both fail-open traces. **After the HIGH corrections and the MEDIUM protocol pins above are made — with the LOW items folded into acceptance — the enforcement design is safe to implement without a seventh design.** This review does not accept the RFC on the author's behalf.

## Verdict

**NOT READY**


## Round 6 — 2026-07-13 (paired blind confirmation of the revised enforcement gate)

**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, `claude-fable-5[1m]`,
effort `max`, read-only tools
**Method:** Fresh foreground-only session; independent adversarial confirmation
of the exact frozen candidate. Prior review artifacts were forbidden. The
reviewer read the RFC, governing LLPs, and source tree and edited nothing.
**Session id:** `4215db0d-53af-4d21-8990-9e9258c88acb`
**Reviewed SHA-256:**
`fd0499240ede7a67d71edd86a13bd930de5620e8c1467da7c7160cbccd6a6592`
(the runner denied the reviewer's shell digest command; the orchestrator
verified the stable worktree digest immediately before and after the run).
**Review-body SHA-256:**
`8ca220a4c235d1737f5b4873f9a02c6cf0daf7042f0ebd322539f010e2fee595`
**Redacted:** no

### Review body (verbatim)

I've completed verification across the RFC, the governing LLPs (0008, 0011, 0013, 0020, 0032, 0039, 0043, 0051), and the source tree. Every material source-grounding claim I checked is accurate. My remaining analysis is protocol-level. Here is the review.

---

# Independent adversarial review — LLP 0053, ENG-24592 focused confirmation gate

**Digest reviewed:** `fd0499240ede7a67d71edd86a13bd930de5620e8c1467da7c7160cbccd6a6592` (as asserted by the review request). I could not independently recompute the hash — shell access was denied in this session — so I state precisely what I did review: the complete working-tree file `llp/0053-authorization-invalidation.rfc.md`, 1252 lines, read in full, matching the 2026-07-13 ENG-24592 enforcement-gate revision described in its own header and §Status (which names prior-round SHAs `e64dcb…` and `5deb62…`). No file under `llp/reviews/` was read; nothing was edited.

**Verdict: NOT READY** — one protocol-correctness defect (HIGH) plus material acceptance, dependency, and enforceability gaps. All are bounded edits within the existing design; none reopens the architecture.

## Reasoning, concisely

The document's spine is correct and its source grounding is unusually honest — I verified the shipped-behavior claims directly and they all hold: destructive drain and overflowed-push no-ops (`src/ephemeral.rs:1159, 1189, 1006-1047`), the kit ignoring `clear_retained` and mapping recovery resync to keep-rendering-meanwhile (`demos/_kit/client.mjs:979-986`, `src/local.rs:4180-4189`), the matcher's captured-dependency-first order and `userId`-only `authScopeField` (`src/live_matcher.rs:121-152`), `ChangedRow` single row image and `changed_fields` semantics including empty-on-journal-reconstruction (`src/storage.rs:152-160, 3305`), post-commit process-memory epochs and the epoch-free seed path (`src/local.rs:1085, 1452-1456, 4196-4208`), bare-`u64` `!=` resume comparison (`src/local.rs:4285-4305`), the retained-store CAS shape and `writeServerRows` retention-before-disposed-check ordering (`packages/snapback-contract/client-store.mjs:567-579`, `index.mjs:486-494`), the three clock surfaces (`src/manifest.rs:1283`, `src/runtime.rs:749, 1776, 1820-1830`), DK-3 `remove` identification (`src/live_wire.rs:80-93`), the LLP 0008 bar and L4 pattern (0008:163-164, 261-265), LLP 0011's layers and ratified resubscribe (0011:140, 232-249), LLP 0032 P4's no-ack-drain decision (0032:1256-1259), and the demo-corpus claim (only todo/todo-v2 exist; their declarations match the worked rows exactly — `demos/todo/snapback/functions.mjs:24-33`, `demos/todo-v2/snapback/functions.mjs:27-33`).

The composite witness, denial routing, scope matrix, connection roots, retirement, ACK-after-commit, and fence machinery are internally coherent under every interleaving I could construct — with one exception: the protocol makes client-side `scope_state` (revision high-waters, retired lifecycle) durable forever while leaving server-side scope issuance in process memory with no freshness pin, which re-creates the ABA class this revision set out to close, one level up. That, plus the lease having zero acceptance coverage, an unowned ephemeral-room invalidation surface that 0039's item-6 promise depends on, and two operative constants referenced as pinned but defined nowhere, is enough to hold the gate.

## Findings

### HIGH

**H1 — ScopeId reuse across server restarts turns the durable client fence into a fail-open filter (revision-high-water / retired-lifecycle ABA).**
Anchors: §Invalidation is an obligation — ScopeId/issuance (lines 496-516), Identity and revision ("A revision high-water survives discharge for as long as the scope id can recur", lines 524-529), scope matrix ("deliberately not disk-durable", lines 543-560), Authenticated retirement (lines 571-585), §GC (lines 636-640); §Client fences (lines 765-791, esp. "The durable minimal instance/generation/scope high-water survives…" and "A retired lifecycle bit is equally durable"); §Acceptance Version durability (lines 1029-1038, no reuse row).
The text pins non-reuse for `revision` and `query_instance_id`, persists per-`ScopeId` high-waters and a durable `retired` bit in the shared store, and explicitly contemplates scope-id recurrence — but never pins that `connection_generation` (hence `Subscription`/`Connection` ScopeIds) is unique across server lifetimes, while pinning that server-side obligation and retirement state is *not* disk-durable. Failure scenario: server restarts and re-issues generation values (nothing forbids a counter restarting); a client's durable fence holds `scope_state` for a numerically equal dead scope at high-water R5 (or durably `retired`). A real matcher removal then projects as the aliased new scope's R1; the client's serialized transition compares "revision only with that scope's high-water" and drops it as stale (or rejects it via the retired bit, which "no old owner can turn active again"). The 5-second level-triggered re-fire re-sends a frame the client discards forever: a permanent forbidden row on a healthy connected client — the exact failure class the document exists to close, reproduced at server-continuity granularity. Bounded resolution: one pin plus one acceptance row — `connection_generation` is never reused across server lifetimes (e.g., carries a durable monotone boot/stream component), and/or durable client `scope_state` for `Subscription`/`Connection` scopes is keyed to the issuing server continuity and dropped on continuity mismatch; acceptance: server restart with re-issued generations against a populated durable fence still delivers, applies, and discharges a fresh obligation.

### MEDIUM

**M1 — The lease has zero acceptance coverage.**
Anchors: §The lease (lines 698-749: "required v1 mechanism", 24-hour default, capability reporting, ceiling opt-in, expiry refusal, server-side enforcement); §Dispositions (line 653: lease expiry → durable delete tombstone); §Acceptance (lines 910-1055 — no lease row; the only mention is incidental at lines 1034-1036).
The document calls the lease "the security boundary for every offline device" and holds everything else to "measured not asserted," yet the acceptance suite never tests: client read refusal at expiry, the durable `ClientQuery` delete tombstone on expiry-without-revalidation, server refusal of revalidation-free service on an expired lease, renewal on successful revalidation, the default/ceiling appearing in capability facts, or §GC's rule that lease expiry is not a tab-death proof. Failure scenario: an implementation ships item 8 with a lease that renders but never refuses, and the only offline bound silently does not exist. Bounded resolution: add one acceptance block covering those six behaviors.

**M2 — Ephemeral-room authorization invalidation is neither covered nor disclaimed, and 0039's item-6 promise depends on it.**
Anchors: §Summary (lines 21-23), card-game worked row (line 884), §Non-goals (lines 894-908 — rooms absent); LLP 0039:1294-1298 ("a removed player keeps receiving the game **until item 6 lands**"); LLP 0013:308-315, 327-352 (per-subscriber `authContext`/`visibleKeys` membership cache; "auth dependency changes" as a `resync_required` cause); LLP 0032:955-962 (the ownerless `AuthRevoked`/`AuthChanged` room variants removed "until real").
0053 is the corpus's authorization-invalidation owner, but its obligations cover only durable query scopes. Rooms deliver auth-gated ephemeral state through a cached membership snapshot; the shipped auth-change room hooks were removed as ownerless; 0053 never mentions the surface. Failure scenario: the proving demo's kick — 0053's own worked row — quarantines the board query while the kicked player's room subscription keeps streaming opponents' presence/cursor state on a connected client, with no epoch, no obligation, no resnapshot; meanwhile 0039 records that item 6 closes the removed-player leak. Bounded resolution: one paragraph — either project enumerated events and `permissionBacking`-derived membership changes into room authorities as LLP 0013's "auth dependency" resync (snapshot re-authorization included), or add an explicit Non-goal naming 0013/0039 as owner and correct the card-game acceptance row and 0039's item-6 claim to match.

**M3 — Two operative constants are referenced as pinned but defined nowhere.**
Anchors: line 233-236 ("the 15-second live freshness budget"; also §Acceptance line 1001-1002 "within the freshness budget"); line 710-711 ("Lengthening it past a pinned ceiling requires an explicit, documented opt-in").
LLP 0008 pins only "a client freshness budget" with no number (0008:586-588, alongside a 30 s defensive heartbeat); no corpus document pins a 15-second budget or any lease ceiling. Both constants are load-bearing (the bounded-retry contract and the offline security ceiling) and unimplementable as written without inventing values. Failure scenario: two implementers pick different budgets/ceilings and both claim conformance; the acceptance rows referencing the budget are untestable. Bounded resolution: own both numbers in this document (one sentence each) or cite the owning document; wire the ceiling into Open Question 4's ownership ask.

### LOW

**L1 — The LLP 0008 supersession has no named companion amendment.**
Anchors: lines 641-645 (supersedes LLP 0032 P4) and 621-623 (5-second session-mode cadence); LLP 0032:1255-1259 records that the no-ack-drain decision lives in LLP 0008 §Realtime Delivery, and 0008:581-588 still pins loss-recovered-by-snapshot and the 30 s heartbeat. Implementing 0053 leaves the corpus self-contradictory unless 0008 is amended; 0053, unlike 0039, carries no companion-obligations note. Resolution: add one (0008 amendment; the 0012/0051-D4 registrations 0039 already tracks).

**L2 — The LLP 0011 "sensitive retained slices clear" reinterpretation is asserted, not ratified.**
Anchor: lines 694-696. 0011:245-246 says "clear them before resubscribing"; quarantine keeps read-blocked bytes, and 0053 both declares 0011 wins where it pins a contract (line 77-78) and unilaterally declares quarantine "the faithful reading." The pending 0011 addendum 0039 tracks (0039:1306-1307) covers other topics. Resolution: extend that dated addendum to ratify quarantine-as-clear for permission-change invalidation.

**L3 — The typed-denial production surface is unnamed.**
Anchors: lines 230-236, 589-593; §Acceptance 996-1004. The delete-vs-quarantine fork hangs on `SNAPBACK_AUTH_PERMISSION_DENIED` being producible, and compare-and-discharge even requires proofs "authorized for that producer," but the document never says who can produce the typed code (the shared invocation gate? an app-facing typed-denial API?). LLP 0011's natural function-level check — the very shape cited at line 222-224 — throws untyped and therefore can only ever quarantine. Fail-closed, but the delete path may have no reachable producer. Resolution: one sentence naming the producer(s) and owner (0011/0004), and whether app code may signal it.

**L4 — No acceptance row for the boot-path "pruned/unknown disposition history ⇒ delete-before-read" rule.**
Anchor: lines 839-844 vs §Acceptance (fences/tombstones and Version durability cover compaction, recreation, restart, and reset/import, but not pruned-history or missing-witness delete-before-read). Resolution: add the row.

## Architecture

**The architecture is sound.** Matcher-carried live correctness with obligations for negative deltas, two orthogonal declarations, the closed event universe with machine-enforced online-only confinement, the composite authorization/data witness, mandatory resnapshot on any non-live resume, quarantine-then-prove, and the honestly-scoped lease survive every attack I constructed; the composite-witness discharge rules are coherent under merged removals, epoch-only causes, cross-scope coexistence, cross-tab ACK ownership, and denial floors. Nothing above requires reopening it — H1 is a missing freshness pin inside the existing scope-id design, and the rest are coverage and seam obligations.

## Items 6 and 8

**No — items 6 and 8 may not unblock on this text as it stands.** H1 is an operative protocol defect an implementer would build; M2 leaves 0039's own stated item-6 outcome (the removed player stops receiving the game) only partially deliverable; M1 and M3 leave item 8's security boundary untested and under-specified. All named resolutions are bounded edits. After they land, nothing I found calls for a seventh design round: one more focused confirmation of the amended text should suffice to unblock item 6, and item 8 alongside it (item 8 additionally awaits item 7, which this text correctly does not depend on — its item-5-keyed queue fence with the item-7 descriptor as an optional later equality axis is consistent with 0039's landing order).


## Round 7 — 2026-07-13 (final paired blind confirmation of the operative gate)

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

**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, requested
`claude-fable-5[1m]`, effort `max`; recorded model usage was
`claude-fable-5`; read-only tools.
**Method:** Fresh foreground-only session, blind adversarial confirmation. Prior
review artifacts were forbidden. The reviewer read the operative candidate,
companion amendments, governing LLPs, and source and edited nothing.
**Session id:** `7AB35371-C509-49D1-84E2-08153EB655BE`
**Review-body SHA-256:**
`520db0dff8e7777a212dea705dfe536fe0e24f670cacc801ee8b080fdfea1dda`
**Redacted:** no

### Review body (verbatim)

All verification passes are complete — the 0053 candidate read in full, all five companion amendments checked, the 0039 seam and activation matrix compared verbatim, and every sampled source-grounding claim checked against the shipped code. Here is the confirmation report.

---

# ENG-24592 — LLP 0053 enforcement gate: paired blind confirmation (Fable half)

## Verdict: **READY**

Zero blocking findings survived adversarial verification. Two LOW, non-blocking observations are recorded below with evidence and bounded resolutions. Readiness is reported only; acceptance is the author's decision and is not made here.

## Provenance and scope of this review

The six operative-candidate SHA-256 hashes were **supplied by the runner**; I have no Bash in this session, so I could not recompute them. This review binds to the working-tree bytes at these exact paths, which the runner attests are the hashed candidate:

- `llp/0053-authorization-invalidation.rfc.md` — **read in full** (all 1,814 lines)
- `llp/0000-snapback.explainer.md` — header/ledger (1–30, 320–364) and follow-on index (815–834)
- `llp/0008-local-first-sync-and-realtime.rfc.md` — header, §Authorization-Aware Sync + dated amendment (441–524), §Realtime Delivery notes, Validation, Status (600–711), L4 definition (262–268)
- `llp/0011-auth-and-permissions.rfc.md` — §Local-First and Realtime Implications, ratified answer + 2026-07-13 addendum, Validation, Status (230–393)
- `llp/0013-ephemeral-realtime-state.rfc.md` — 2026-07-13 amendment + surrounding section (520–609), Status (860–883)
- `llp/0039-auth-vertical-slice.rfc.md` — Summary/Target scope (1–160), Ephemeral rooms + §Permission dependencies (950–1130), Landing order/activation matrix/deferred obligations/Non-goals/Acceptance/Status (1270–1654)

Blindness held: nothing under `llp/reviews/` was read, and nothing was edited. Source consulted for enforceability: `src/ephemeral.rs`, `src/local.rs`, `src/live_matcher.rs`, `src/live_wire.rs`, `src/storage.rs`, `src/value_expr.rs`, `src/manifest.rs`, `src/runtime.rs`, `src/warm_vm.rs`, `packages/snapback-contract/{client-store.mjs,index.mjs}`, plus targeted reads of LLP 0051 §D4, LLP 0043 §Status, LLP 0008 L4.

## Adversarial confirmation, per gate item

**1. Narrow corpus precedence and amendments — CONFIRMED.** The root ledger (0000:336–349), 0008 amendment (0008:465–493, Status 708–711), 0011 addendum (0011:261–293, Status 379–387), 0013 amendment (0013:538–564, Status 879–883), and 0039 seam (0039:53–58, 1006–1120) all state the same acceptance-gated rule: 0053 controls invalidation mechanics **once Accepted**; server authority, fail-closed stale handling, user-switch wipe, and fresh-authorized-snapshot fundamentals stay ratified; only the universal-epoch / generic-`resync_required` / trust-epoch-on-reconnect clauses are superseded; items 6 and 8 stay blocked meanwhile. The section names 0053 claims precedence over exist (0008:441 §Authorization-Aware Sync, 0008:549 §Realtime Delivery, 0011:222 §Local-First and Realtime Implications). The session-revocation exclusion is mirrored, not contradicted: 0039:1088–1098 owns session-loss `delete` and 0053 excludes it from the event universe.

**2. Closed protected-query input profile — CONFIRMED.** The profile is a capability allowlist with default-deny at both gates (load-time and host invocation, on initial run and rerun), a recursive IR walk refusing `RuntimeNow`/`RuntimeId` in every expression position, a five-class exhaustive host-op registry with unknown/future ops denied, a sealed null-prototype frozen mode-specific `ctx.auth`, an ambient-capability-free realm with named negative fixtures (aliases and computed access tested), and fresh-or-reset-equivalent module state with the DK-4 pool explicitly disqualified. I probed for residual mutable inputs — clock, randomness, module lexicals, imported singletons, timers, locale/env, network, secrets, non-pinned config, ephemeral reads — every one lands in a denied class or an enumerated channel (matcher wake, event 2, 0039 authority fence). Client-supplied arguments are immutable per query instance, so they cannot mutate behind the matcher. The closure claim as stated (no mutable input can strand a connected result) holds. Grounding: `RuntimeNow`/`RuntimeId` are real IR kinds (manifest.rs:1282–1283; value_expr.rs:143–149), `runtime.now`/`runtime.id` are real host ops (runtime.rs:749, 771), `Date.now`/zero-arg `new Date()` denial ships today (runtime.rs:1769–1776), and the warm-VM sweep resets globals but cannot reach module-scope lexicals (warm_vm.rs:5–13, 102–105) — exactly why the doc routes protected queries to the fresh-VM path.

**3. Composite witnesses, obligations, ACK/discharge, denial/error — CONFIRMED.** The state machine survives the adversarial interleavings I constructed: v99 snapshot cannot discharge a v100 removal (data floor); revision-R ACK cannot discharge merged R+1; scopes' revision domains never compare; a `Connection` overflow root clears only when all N children discharge; `data: None` cannot weaken a same-stream floor; incarnation/stream changes are accepted only from the authenticated bootstrap expectation; ACK binds to `(scope, revision, witness, disposition, proof)` and is sent only after the owning boundary applies. The overflow design is coherent precisely because obligations are state outside the queue: a `retain` on overflow recovery is legal only when *no* pending auth-scoped shrink/error obligation exists — and any lost removal by rule left one pending, so the disposition math is safe. Denial is a third delivery class with exactly three trusted producers and an unforgeable host brand; untyped errors quarantine immediately with a bounded episode and never fall back to `retain`. Grounding of the motivating defects: sticky `overflowed` early-return drops (ephemeral.rs:1006–1008, 1052–1056, 1080–1085), overflow clears every lane and emits unconditional `clear_retained: true` that "no shipped client read" (ephemeral.rs:1015–1038, comment 1023–1025), `fail_subscription_fanout` maps failures to a plain recovery resync (local.rs:4164–4185).

**4. Authenticated never-reused boot/scope identities, bounded crash-safe frontiers — CONFIRMED.** `IssuerId` = durable monotone boot-sequence reservation + 128-bit nonce, MAC'd under a stable protocol key; scope sequences and connection generations are consumed-before-publish reservations a crash can never re-issue; retirement comes in two authenticated forms, requires a satisfying fresh snapshot before folding, applies max pending dispositions first, and leaves frontiers unchanged on crash (third boot repeats fail-closed). Durable growth reduces to scalar frontiers plus capped active/unresolved scopes; retry episodes are excluded from that argument and bounded by their own caps. The million-churn, double-crash, forged-MAC, and numeric-counter-reuse acceptance rows (0053:1474–1485) cover the ABA the prior round found. The shipped-resume weakness this replaces is real and correctly described: bare `u64 !=` epoch comparison with a trusted `"retained"` resume path (local.rs:4285–4305, 2307–2339).

**5. AuthorizedLease — CONFIRMED.** Issuance is one linearization point inside the same commit-order gate as writers: exact app-data-head equality, authorization-pair equality, activation-hash equality, and an empty pending-obligation set, all-or-discard with no retry against the old snapshot; an obligation-resolving snapshot never carries a lease. Renewal is never ambient. Both clocks have durable rollback high-waters (`SNAPBACK_AUTH_CLOCK_ROLLBACK` server-side; client delete-before-read); the client deadline is derived from request-start elapsed time so delay only shortens validity; clamps (session/provider), overflow, and malformed cases fail issuance or delete-before-read. The 24-hour default and hard maximum are pinned as constants, with larger configuration rejected. The `public → private` race is pinned in both orders (0053:1567–1575), which is the sharp case: auth-pair equality alone can never accept a stale data head. The threat model is stated honestly — bounds honest offline clients; no defense against a hostile holder of the bytes (LLP 0043's open encryption question, explicitly not solved here).

**6. Durable bounded retry episodes and retirement — CONFIRMED.** Attempt reservation is transactional and pre-invocation; the 15-second window is fixed at first failure and survives re-fire, reconnect, revision merge, and restart; crash after reservation consumes the attempt and *shortens* the window; server clock rollback exhausts fail-closed. Storage is hard-capped (10,000 global / 1,024 per authority-store) in the same auth-control transaction, refuses new keys at capacity with `SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY` and **no** handler run, never safety-evicts (eviction would reset the three-attempt limit), frees a slot only by transferring the resolution proof in one transaction, and rebuilds malformed counters from the bounded table. The availability-for-boundedness trade is stated, not hidden.

**7. Room authorization invalidation linearized — CONFIRMED.** The two-phase protocol closes every window I could construct: the dependency-indexed registry ticket is installed atomically with affected-room enumeration; registration and initial snapshot installation go through the same admission gate, so a racing registration either becomes registry-visible before the ticket (enumerated and quiesced) or observes it and publishes nothing — **there is no enumerate-then-register gap**, the exact hole named in the gate. Publish/mutation, enqueue, destructive drain, and final send each take a single-use permit compared with the generation *atomically with the act*; envelopes carry the generation; drain checks under the outbox lock and send re-checks under the serialized sender gate, so a frame drained pre-barrier cannot escape post-commit. Rollback compare-removes only the exact ticket (overlapping writes covered); ambiguous commit keeps sinks closed until durable reconciliation, and timeout never guesses rollback; crash after commit destroys the process-local room and forces fresh authorization. No registry/room mutex is held across the commit, and L9 acceptance proves unrelated-room liveness. Acceptance schedules (a)–(d) plus the fifth registration-race schedule (0053:1415–1434) pin all of it.

**8. Item 5/6/7/8 activation matrix and capability refusal — CONFIRMED.** The matrix is **verbatim identical** in 0053:870–878 and 0039:1325–1332, including the item-7 no-admission-change row and item-7-may-precede-item-6. `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` refusal at items 1–5, must-understand `authInvalidationProtocol: 1` for every session-mode auth-scoped live surface (legacy connected clients closed), separate `authorizedLeaseProtocol: 1` for item 8, and `clear_retained` demoted to a versioned compatibility projection are consistent across 0053, 0039 (961–1005, 1513–1553), and the rollout acceptance.

**9. Acceptance coverage and source-grounded implementability — CONFIRMED.** Every mechanism has an acceptance pin, including everything the prior NOT READY rounds flagged as missing: pinned constants (the v1 table), typed-denial trusted/forged/untyped fixtures, pruned-history and retained-boot delete-before-read matrix, lease field/MAC/clock/race coverage, retry-episode churn bounds, boot-continuity/million-churn frontiers, the kick trace with adversarial schedules, and the blast-radius measurement. Every source-of-truth claim I sampled — fifteen of them — verified exactly against the shipped code:

| 0053 claim | Verified at |
|---|---|
| sticky `overflowed` drops pushes; drain-destructive outbox | ephemeral.rs:1006, 1052, 1080 |
| overflow emits unconditional `clear_retained: true`; no shipped client reads it | ephemeral.rs:1026–1038 |
| `fail_subscription_fanout` recovery resync | local.rs:4164–4185 |
| `authScopeField` is `userId`-only | live_matcher.rs:139 |
| captured `Row`/`MissingRow`/`Query` deps consulted first | live_matcher.rs:165–176 |
| `ChangedRow.changed_fields` exists and is consumed | live_matcher.rs:352–380 |
| epoch map is process memory advanced post-commit | local.rs:531, 1085; refresh_read_epochs local.rs:3644–3653 |
| seed does no epoch processing | local.rs:1452–1456 |
| resume trusts bare-`u64` epoch equality (`!=`) | local.rs:4302–4303, 2326–2339 |
| journal is postimage-only; deletes record no `row_json` | storage.rs:1244, 3643–3655 |
| `putRetainedQuery` CAS lacks a generation; rejects only strictly-lower | client-store.mjs:567–587 |
| `writeServerRows` retains before its disposed/boundary check | index.mjs:486–490 |
| `RuntimeNow`/`RuntimeId`, `runtime.now`/`runtime.id`, `Date.now`/`new Date()` denial | manifest.rs:1282–83; runtime.rs:749/771/1769–76 |
| L4 convergence pattern, 0051 D4 registry, 0043 M1/M2, 0020 Phase 4 anchor | 0008:262–266; 0051:596; 0043:250; local.rs:2260 @ref |

## Non-blocking observations (LOW, no resolution required before acceptance)

1. **LOW — 0013's amendment summarizes only the post-commit half of the room protocol.** Evidence: 0013:541–549 says a *committed* backing change "projects" `RoomAuthorityResync { authorization, minCommitVersion }` and describes suspension "before another publish/fanout," without the pre-commit ticket/barrier/quiescence phase, and omits `room_authority_generation` from the record. Failure trace if misread in isolation: an implementer building from 0013 alone could ship the post-commit-callback design 0053 §room explicitly rules out (the drain/send leak window). Why non-blocking: 0013:538–539 assigns the producer/ordering contract to 0053 item 6 by name, and 0039's deferred obligation 9 (0039:1415–1423) independently pins the commit-ordered barrier, so precedence is unambiguous. Bounded resolution: on 0013's next routine revision, add one clause ("…installs and quiesces exact-ticket barriers before the causing commit, per 0053") — no design change.

2. **LOW — writer-side quiescence wait couples auth-changing commit latency to room sink acts (including a final send).** Evidence: 0053:504–519 (prepare-phase permit wait) with the abort rule "if … quiescence cannot be established, the write does not commit." Failure trace: a wedged sink act stalls, then aborts, an authorization-changing write — an availability cost, never a leak; the document frames the fail-closed cost as "temporary suspension" and L9 acceptance bounds unrelated liveness. Bounded resolution: the item-6 implementing spec (0039 obligation 9) should pin the per-sink act bound/timeout that makes "cannot be established" definite; nothing in the RFC needs to change.

## Explicit gate answers

- **Does the architecture remain sound?** Yes. This revision changes no architectural element — matcher-carried live correctness, two orthogonal declarations, the closed event universe, obligation-backed negative deltas, mandatory non-live resnapshot, quarantine-then-prove, and the bounded lease all stand, and I found no app shape or interleaving the model cannot express. Everything new is enforcement detail inside that settled frame, which is what the freeze demanded.
- **May items 6 and 8 unblock?** From this reviewer's standpoint, yes: the enforcement contract is complete, internally consistent, consistent with its companions, and implementable against the shipped code as read. Mechanically, unblocking still requires the author to move 0053 out of Draft/FROZEN to Accepted (item 6 starts only then; item 8 additionally requires items 5, 6, and 7 landed), per the activation matrix both documents pin.
- **Can ENG-24592 close?** Yes, contingent on two things this report cannot supply: concurrence of the paired blind confirmation's other half, and the author's own status decision. The gate's ask — focused independent confirmation of the bounded revision on its exact bytes — is satisfied by this half with a READY result and no blockers.

Per the review protocol, this is a readiness report only: I do not accept LLP 0053 on the author's behalf, and I wrote no artifact and made no edit anywhere in the tree.


## Round 8 — 2026-07-13 (focused exact confirmation of the ClientQuery correction)

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

**Reviewer family:** Claude
**Provider / runtime:** Claude Code 2.1.207, requested
`claude-fable-5[1m]`, effort `max`; recorded model usage was
`claude-fable-5`; read-only tools. 29 input tokens, 407,933 cache-creation
tokens, 2,087,610 cache-read tokens, and 46,336 output tokens.
**Session id:** `f0c83579-ad40-42ab-b020-08e99e70e773`
**Date:** 2026-07-13
**Review-body SHA-256:**
`8f01ca0e9136f75be88f0fb594f1b34bd58b353d319ab19df431c6f13131b660`
**Redacted:** no
**Method:** Fresh blind focused confirmation of the exact operative corpus.
Prior review artifacts and secret material were forbidden; the reviewer read the
candidate and relevant source with read-only tools and edited nothing. An earlier
run against superseded hashes was interrupted before verdict and is not recorded
as a review.

### Review body (verbatim)

# ENG-24592 — Independent final focused review: LLP 0053 ClientQuery identity/retirement correction and companion seam

**Reviewer basis.** Read-only review of the exact operative corpus in this working tree. This session has no shell access, so per the review charter I did not attempt to recompute digests; the following SHA-256 values are asserted by the orchestrator for the files I reviewed:

| File (read in full or at cited sections) | Asserted SHA-256 |
|---|---|
| `llp/0000-snapback.explainer.md` | `7957a27102d55ae3197e55d90553980c0d0fd0275f7df80547d7670501bcda03` |
| `llp/0008-local-first-sync-and-realtime.rfc.md` | `f101a489c1e3d477b5f9c0322b6336827d8600930db67294d35dd32bb3b0b1ac` |
| `llp/0011-auth-and-permissions.rfc.md` | `0045e02cec94cf101cfbb459edd180b1985ebe4f5d06dfcc95484730829623b1` |
| `llp/0013-ephemeral-realtime-state.rfc.md` | `7447ed8b282e3ddda17663230903a2420c0394842cfcc2c3cb5039ff521630bb` |
| `llp/0039-auth-vertical-slice.rfc.md` | `869c32c1d99c29bad14df40c7a6014e509b4b86c630cdf0f2881e3dfc4ad7824` |
| `llp/0053-authorization-invalidation.rfc.md` | `eb1c624c5a06facaaa32d51e0e5e6793d1ae68e532a36b64a8fb51f3391e1568` |

LLP 0039 (2,301 lines), 0053 (1,938 lines), and 0013 (894 lines) were read end to end; 0000/0008/0011 were read at their authorization-invalidation amendment sections plus surrounding context. Implementation source inspected for factual enforceability: `src/ephemeral.rs`, `src/local.rs`, `src/storage.rs`, `packages/snapback-contract/client-store.mjs`. Nothing under `llp/reviews/` was opened and no file was edited.

## Verification of the nine gate points

**1. `query_instance_id` carried coherently — CONFIRMED.** Both `Subscription.namespace` and the `ClientQuery` scope carry the exact instance id (0053 ~640–694), allocated from a store-wide durable monotone allocator for retained keys and a never-reused process allocator for live-only state (~1274–1281). It is bound into: revision high-waters (a `ClientQuery` high-water survives until that exact instance's terminal retirement, ~715–717); tombstones (the scope/durability matrix pins "the exact `ClientQuery` instance" for both authorization events and lease expiry, and the lease-expiry tombstone "cannot target a later instance at the same canonical key", ~740–742); compare-and-discharge (explicitly includes `query_instance_id` for `ClientQuery`; a retired-instance token is stale even when store, key, revision, and witness match a recreated instance, ~834–842); leases (a dedicated field plus the isolation paragraph, ~1037/1067–1074); every callback/write (captures `(query_instance_id, authority_generation, query_generation)` and compare-and-commits all three, ~1303–1306); and store state (`QueryAuthorizationState` carries the id and `active | retiring` lifecycle, ~1244–1271). The identity-domain rule in the client lease-clock path (~1162–1174) selects the exact current instance before any comparison. No residual two-field `ClientQuery` reference remains.

**2. Terminal retirement is crash-safe and non-forging — CONFIRMED.** The `active → retiring → finalized` transition (~779–818) is: (i) one atomic step that advances both `query_generation` and `queue_generation`, applies the maximum pending disposition, destroys payload/lease/lease-request/accepted snapshot/overlays/live boundaries, and makes queue custody discard-only; (ii) a crash-recoverable `retiring` marker retaining exact pending token state and owner-continuity ids; (iii) map/fence removal only after already-issued terminal-delete tokens complete idempotently and recorded owner continuities end, preserving the allocator high-water. Crash before/during each step resumes the correct branch without rendering, replaying, or exposing bytes. Retirement "never synthesizes an ACK, release proof, or permission proof"; snapshot/quarantine resolution "is never ACKed by retirement." A recreated key gets a new id, old-instance obligations/proofs/ACKs/callbacks/leases are rejected before lookup, and "no old owner can turn a retiring instance active again" (~1283–1286). Server-side staleness of retired-instance tokens (point 1) closes the other direction.

**3. Missing/mismatched/retiring/delayed frames fail closed pre-allocation — CONFIRMED.** Missing, absent, or mismatched instance state rejects the frame "without allocation or any disposition/generation change" before frontier or map lookup; only explicit subscribe/retention initialization allocates (~1289–1296, 1275–1277). `retiring` accepts exactly two enumerated inputs (~800–806). Delayed frames at or below retired issuer/scope frontiers drop before lookup; delayed old-pair/old-stream frames are ignored and cannot increment a generation (~727–731); an absent key rejects without allocation and a recreated key rejects the old full scope before lookup (~940–943).

**4. RetryEpisode identity survives same-key recreation without extra attempts — CONFIRMED, and deliberately so.** The episode key is authority subject + canonical client-store/query key + witness floor — explicitly *not* scope id, revision, or instance id (~866–869). "Query-instance retirement or recreation also reattaches the same canonical-key/witness episode and cannot erase or reset an unresolved or exhausted budget"; old-instance resolutions must reproject through the current full scope and their tokens never transfer (~871–875). Attempts are transactionally reserved (3 total within 15 s of first failure), re-fire/reconnect/restart/revision changes create no attempt, a reservation crash shortens the window, clock rollback fail-closes at quarantine, and only an explicit authority-checked manual retry with a fresh idempotency id opens a new episode. Acceptance pins retirement and same-key recreation retaining the same attempt count/deadline (~1595–1598).

**5. GC bounded across million-key churn — CONFIRMED.** Durable safety reduces to one store-wide monotone allocator scalar, one minimal state per extant query, one boot-sequence frontier per incarnation, one scope-sequence frontier per current live instance/issuer, and exact entries only for bounded active/unresolved scopes; tombstone-body compaction retains only the minimal current-instance fence, terminal retirement removes per-instance state, and no historical instance set or per-key frontier is retained — identity-based rejection (never-reused ids) is what makes dropping per-key high-waters safe against delayed frames, which is precisely the incompatibility the Codex HIGH named (~927–949). `RetryEpisode` storage is excluded from the frontier argument and separately bounded by transactional hard caps (10,000 global / 1,024 per `(authority_subject, client_store_id)`), never safety-evicted, with fail-closed `SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY` admission that runs no handler attempt (~879–895).

**6. Acceptance coverage — CONFIRMED.** The lifecycle-identity block (~1542–1561) covers I1 → retire → I2 with crashes before/during/after each step and both cleanup branches (idempotent terminal-delete ACK only after the destructive commit; snapshot/quarantine never ACKed by retirement, finalization waiting on owner continuity); two tabs sharing I1 failing old captures; delayed I1 obligations/resolutions/ACKs/callbacks/renders/queue ops rejected before lookup and unable to mutate I2; and one million unique-key and same-key cycles bounded to allocator-scalar-plus-extant state. Extinct-scope owner continuity is adversarially covered (tabs A/B, ~1563–1571), boot continuity with forged-MAC rejection and double-crash (~1573–1584), delayed leases and old-lease isolation in the AuthorizedLease matrix — an I1 lease cannot install into/renew/quarantine/delete I2, a missing/corrupt current-I2 lease deletes before read, and retirement destroys lease plus request reservation at the terminal transition (~1658–1670).

**7. Activation matrix and ownership boundaries — CONFIRMED.** The four-row session-activation matrix is word-identical in 0039 (lines 1515–1523) and 0053 (~918–925), both self-labeled as identical: 1–5 activate with auth-scoped live refused (`SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`), +6 unlocks live via `authInvalidationProtocol: 1`, +7 changes no admission, +8 unlocks retained/offline via the lease/store capability. 0039's landing item 6 now reads "LLP 0053 supplies and owns its own item-6 authorization-invalidation fence; this document asserts no queue-fence keying to item-5 custody or generation" — the stale attribution is gone, consistently through §Status and §Changelog. 0053 keeps the item-6 query fence (`query_generation`) separate from item 5's `QueueAuthorizationState` custody, which item-6 quarantine only adds suspension roots to, with the queue CAS "independently of `query_generation`" and item 7 an optional extra axis (~1003–1015). The corrected companion sentence — item 6 owns the live quarantine outcome, item 8 extends it to retained/offline through `AuthorizedLease`/store — is present in 0039 §Permission dependencies (~1226–1230) and matches 0053. The dated amendments in 0000 (ratification ledger, lines 336–349), 0008 (§Authorization-invalidation amendment, lines 465–493), and 0011 (ratified narrow addendum, lines 261–293) all pin 0053 precedence *on acceptance*, preserve the fail-closed/fresh-snapshot fundamentals, and keep items 6/8 blocked while 0053 is Draft/FROZEN.

**8. LLP 0013 mirrors the pre-commit room barrier — CONFIRMED.** The 2026-07-13 amendment (0013 lines 538–574) mirrors 0053 §Ephemeral room authority invalidation exactly: unique dependency-indexed registry ticket installed before the authorization-changing commit; protected-room registration/initial-snapshot interlock with that ticket; matching room-authority barriers and quiescence of every already-admitted sink permit, with abort on targeting/install/quiescence failure; no registry or room lock across the commit; rollback compare-removing only the exact ticket; ambiguous commit leaving barriers pending until durable reconciliation; commit finalizing to level-triggered `RoomAuthorityResync` with cause version and generation; and room mutation, publish/fanout enqueue, destructive drain, and final HTTP/WebSocket send each generation-checked atomically with the act ("a check released before the act is non-conforming"). Fresh durable snapshot + LLP 0039 authority re-resolution, atomic rebuild-or-unregister, ACK-after-boundary-commit, heartbeat re-fire, process-death fresh authorization, the preserving-adapter obligation, and continued `KeyMode::Custom` refusal all match. The validation-requirements list carries the kick fixture and the conservative unknown-dependency/crash/adapter proofs (lines 829–837), and §Status keeps capability refusal required until item 6 is accepted and implemented.

**9. No merge debris or stale current-state contradiction — CONFIRMED.** No conflict markers anywhere under `llp/`. Status/changelog claims are current and honest: both RFCs remain Draft/FROZEN, 0053 states its bounded ClientQuery edits are pending exactly this focused confirmation, and no document claims acceptance or authorizes implementation. Every as-shipped code claim I spot-checked matched source:

- Destructive `drain()` resets the sticky `overflowed` flag; pushes while overflowed early-return without enqueueing; overflow emits `clear_retained: true` unconditionally (`src/ephemeral.rs:1005–1219`) — the shipped-queue facts the obligation design is built against.
- Resume compares bare `u64` permission epochs with `!=` (`src/local.rs:4285–4305`), matching 0053's ABA claim, and the code/wire vocabulary is "permission epoch" as the naming note says.
- The live resume/unsubscribe ownership guard short-circuits when the stored owner is empty (`src/local.rs:2293–2305`), as 0039 asserts.
- `PublishRequest`/`DeleteRequest` carry `session_id`/`user_id`/`custom_key` as siblings of a required `auth`; `SubscribeRequest` carries required `auth` only (`src/ephemeral.rs:442–471`).
- `ChangedRow.changed_fields` exists and is populated (`src/storage.rs:159` ff.); `fail_subscription_fanout` is the shipped failing-requery recovery path (`src/local.rs:4164`).
- The client store serializes through `navigator.locks` and fails closed without it, and `putRetainedQuery` rejects only a strictly-lower same-stream version with no invalidation generation (`packages/snapback-contract/client-store.mjs:469, 567–587, 747–754`) — exactly the "useful but insufficient" baseline 0053 describes.

## LOW residuals (nonblocking)

1. **LLP 0013 amendment wording:** "no declaration may suppress the event in v1" could, read in isolation, be taken to conflict with 0053's event 1, where a known update proved disjoint from `permissionFields` does not fire. In its room-targeting context (the room's own declaration cannot opt out of projection; unknowns target coarsely) it is consistent, 0053 owns the producer contract, and any misreading errs conservative (extra reauthorization, never a leak).
2. **Casing drift in the mirrored resync record:** 0013 spells `minCommitVersion`/`roomAuthorityGeneration` where 0053 spells `min_commit_version`/`room_authority_generation`; both defer exact wire encoding to the LLP 0051 D4 registration, so this is cosmetic.

## Conclusion

The single remaining GPT/Codex blocker — `ClientQuery` lacking a never-reused `query_instance_id`, making delayed old-instance frames and bounded GC incompatible — is closed coherently end to end: identity is carried through every scope, comparison, lease, callback, and store structure; the retirement lifecycle is crash-safe and cannot forge ACKs or reach a recreated instance; frames fail closed before allocation; retry budgets survive recreation without granting attempts; and GC reduces to scalars plus current bounded state, with acceptance pinning each of these adversarially. The two corrected companion sentences and the rebased LLP 0013 seam are in place and consistent across 0039, 0013, 0053, and the 0000/0008/0011 amendments. No material correctness, security, internal-coherence, or implementability blocker remains. Status transitions remain the author's alone; nothing here accepts either RFC on the author's behalf.

**READY**
