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
