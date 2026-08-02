# LLP 0147 compiled microclient review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — instructed not to read any `llp/reviews/` artifact
concerning LLP 0147, blind to this RFC's codex artifact. SHA-pinned target and
instruction capsule. No tests executed; every anchor read directly.
**Instruction capsule SHA-256:** `d05c9bca226b508106b9571aac0c9e2e813b4cc5355a6fe59a1508296ae1cf8d`
**Target:** `llp/0147-compiled-microclient.rfc.md` (828 lines, Draft)
**Target SHA-256:** `2156eca984980d2614d2ba2796fb25e2f4f87498bb6f72edae276ba312b5726a`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 86
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review — LLP 0147: Ahead-of-time compiled microclient (round 1)

**Reviewer:** independent LLP reviewer (Fable family), read-only, per capsule `capsule-r1.md`.
**Target:** `llp/0147-compiled-microclient.rfc.md`, 828 lines, SHA-256 `2156eca9…b5726a` (verified against the capsule pin).
**Blindness:** no file under `llp/reviews/` matching `0147` was opened, grepped, or listed beyond the directory name. `llp/reviews/0145-*` artifacts were available but this review relied on `llp/0145-client-bundle-architecture.research.md` itself.
**Method:** claim-by-claim verification against the working tree by code reading (no tests were executed). Every anchor below was read directly.

## 1. Overall assessment

**NOT READY — by a narrow margin, on factual precision, not on design.** The architecture is sound and unusually well-verified: the asymmetric trust split (codegen proves static facts, the server proves runtime facts, the client keeps only future-event mechanisms) matches the seams that actually exist in the tree, and nearly every load-bearing codebase claim I checked is true at the cited altitude. The document is honest about nonclaims, inherits LLP 0145's adjudications (D-A through D-D) correctly, and avoids both of the failure modes 0145's loop hit (the `authorityIndependent` carrier error in either direction, and an unsatisfiable 11b-style gate). But two factual claims are not exactly true against the shipped code, and this program's bar makes factual truth non-negotiable: D4's unconditional "compare before … acknowledgement, receipt creation" is falsified by the settled-mutation replay path, which gate 12's "including rollout interleavings" then inherits as an ambiguous fixture expectation; and §Packaging names a diagnostic code that does not exist in the code table, in direct tension with the document's own no-minting rule. Both fixes are a handful of lines. A round-2 READY is the expected outcome.

## 2. Strengths

All items below are **verified against source** unless marked *(inferred)*.

- **The five-carrier generation-binding claim is true end to end** (§Motivation, D4; capsule check 1). Generated references carry the complete `expectedGeneration` object (`demos/all-aboard/snapback/generated/api.mjs:29-35`), and the packaged client repeats it on all five request kinds: query (`packages/snapback-client/index.mjs:4916-4924`), authorized-lease query (`:5098-5111`), action (`:5118-5126`), mutation (`:5618-5624`), live subscribe (`:5876-5881`). LLP 0012 §Call-time generation binding (`llp/0012:871-907`) says exactly what 0147 attributes to it.
- **Refusal semantics and success facts are exactly as claimed** (D4 items 4-5; capsule check 3). `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with `"subcause": "generation"` and both tuples in details: `src/local.rs:194-204`. Server-derived `facts.activeGeneration`, sessions-only, never copied from the request: `src/local.rs:150-168`, `src/server.rs:17737-17745`.
- **Selection-then-comparison ordering holds on every fresh path** (capsule check 2). Query: `src/local.rs:5406-5407`; read-lane query against one pinned manifest snapshot: `src/local.rs:20285-20311`; mutation: `src/local.rs:10983-10984` (before prepare/commit); action: refused at staging before dispatch, with `SNAPBACK_UNKNOWN_FUNCTION` preserved first (`src/local.rs:15251-15294`); authorized lease: `src/local.rs:13185-13198`; live subscribe: `src/local.rs:13196-13199`; live re-run pins the subscription's assertion (`src/local.rs:18258-18261`); deployment activation retires generation-bound subscriptions with `resync_required` reason `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` (`src/local.rs:19015-19095`). The one exception is Finding F1.
- **Dev-mode tolerance is real** (D4; capsule check 4 first half). `active_mode != Sessions → Ok(())` with an explicit compatibility comment: `src/local.rs:176-187`.
- **The LLP 0053 drift is inherited correctly, not papered over** (capsule check 4 second half). The dated dev-mode carve-out D-A commissioned has landed in the working tree (`llp/0053:8-18`), ratifying sessions-gated obligation delivery. 0147's D5 `auth-obligation` row (sessions posture + any live selection) and D7's staging table match the reconciled state, and the first spike claims no obligation behavior.
- **The D3 boundary table is true for the arms Micro targets** (capsule check 5). Ingress: `@ref LLP 0131` argument validation before any plan step, dispatch, or buffered write — mutations `src/local.rs:11482-11486`, nested mutations `:11617-11619`, actions `src/local.rs:17928-17931`. Egress: query results validated before publication handoff (`src/local.rs:23055-23060`); host-plan mutation results validated on the dry-run preview while writes are provisional (`:11514-11517`); Ibex mutation results validated before `commit_buffered_writes_idempotent_guarded` (`:11548`, `:11563`), so a result-contract failure means the transaction never commits — the "rolls back" claim is accurate; action results validated after external effects but before result handoff (`src/local.rs:17970-17981`), matching D3's honest non-rollback language and LLP 0108's own text (`llp/0108:440-447, 701`).
- **The egress-universality question is anticipated, not dodged** (capsule check 6). The Cloudflare arm implements no result-contract validation (zero hits in `cloudflare/src/`) and its closed capability registry cannot even express the contract capability ids (`cloudflare/src/coordinator.js:122-132`) — but D3's guard clause ("operations whose server target does not advertise the required argument and result contract capabilities refuse profile admission," lines 311-314) covers exactly this, the capability ids are real and registered (`src/manifest.rs:6107-6110, 6177-6178`), and D7 independently forecloses hosted Micro. The known Cloudflare fan-out defect (`issues/20260801-cloudflare-live-fanout-uses-declared-tables.md`) is therefore out of Micro's claimed surface. See Finding F6 for the one seam this leaves open in the failure-family list.
- **Size figures and budget inheritance are exact** (capsule check 7). 70.1 kB gzip: `llp/0145:265` (250.9/70.1/60.2, reproduced by two round-1 reviewers per `llp/0145:240-247`); the 20/25 kB gates restate `llp/0145:1514-1515` verbatim.
- **The `./online` claim is true** (capsule check 8). The subpath exists (`packages/snapback-client/package.json:63-66`) and re-exports the full-semantics `SnapbackClient` from the root (`packages/snapback-client/online.mjs:8-12`), so D1's "narrowing would be breaking" is correct.
- **D7 gets the `auth/live` rule right — the point 0145's loop got wrong twice** (capsule check 9). LLP 0096 §2.2: "Authority independence is a compiled server fact not projected to protocol clients … always offering is the conformant rule" (`llp/0096:223-231`); the §7 floor is `auth/rr` always, `auth/live` when live is selected, `auth/sender` for browser-class sender-constrained (`llp/0096:685-712`); the WebSocket-upgrade carrier D7 names is real (`llp/0096:139, 501`). D7's stricter "any live function" form is the correct client-side materialization of §7's "auth-scoped" condition given non-projectability, and the document says why.
- **"No sessions surface on the Cloudflare arm" is doubly verified** (capsule check 10): `supportedAuthModes: ["dev"]` in `cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:8-10`, and LLP 0096 §7's own timing note (`llp/0096:741-743`).
- **The D5 module table survives an irreducibility audit** (capsule check 11). I found no module listed conditional that is irreducible in a posture omitting it, and none listed always-present that is avoidable; `authority-fence` always-on is well argued in D6 (cancellation is not a substitute), and the external-bearer paragraph matches 0145's sessions-row caveat (`llp/0145:1342-1352`).
- **The gate set contains no 11b-style unsatisfiable gate** (capsule check 12, most of it). Gate 16's "routed" fixture language is backed by LLP 0095 §2.2's real per-tuple routing (`llp/0095:441-449`); the demand-release/delayed-authority families Phase C names are 0145's documented corpus gaps (`llp/0145:26`); gate 21 restates the per-OS rule rather than demanding LLP 0064's seven-fact Online receipt; gate 22 inherits D-B's relative-bar design. Gate 12's one ambiguity is Finding F1.
- **D2 is achievable, and the change it requires is named** (capsule check 13). Today's generated entries embed `argumentSchema` and contract hashes in the runtime-imported module (`demos/all-aboard/snapback/generated/api.mjs:12-46`; interpreted at `packages/snapback-client/index.mjs:10962-11002`), so the Micro entry cannot be today's emission — and Phase B explicitly commissions the new generated runtime/declaration entry. No unnamed change is required.
- **Citations are real** (capsule check 14). All 21 Related-header LLP numbers exist in `llp/` with matching slugs; all six inline links resolve; the admin claim traces correctly ("0127 decision 4, recorded in LLP 0115": `llp/0115:132-133, 484-485`); the LLP 0114 phrase D3 amends exists verbatim (`llp/0114:264`); LLP 0108's "no new expected-operation protocol in v1" exists (`llp/0108:701`). *(Minor Related-header omissions: Finding F7.)*
- *(Inferred, not deeply verified:)* the LLP 0129 persistence-default sentence in §Status and authority, and D6's attribution of the equal-data-version witness rule to LLP 0095 (I verified the rule's text in LLP 0096 §2.2 and its fixture class, not 0095's judge definition).

At RFC altitude: the asymmetric trust split is sound; the Full/Micro two-composition cost is honestly priced in §Costs and mitigated by shared routed fixtures (gate 16); the rejected alternatives are fairly characterized against 0145's evidence (mangling breakage, the F4 manifest tax, the startup-only TOCTOU); and the Phase B stop rule in §Ratification is exactly the right shape for a byte-floor program.

## 3. Findings

**F1 — MATERIAL. D4's unconditional atomic-refusal claim is falsified by the settled-mutation replay path, and gate 12 inherits the ambiguity.**
- *Defect:* D4 states the sessions server "must … compare the expected and active generation before argument evaluation, handler execution, acknowledgement, receipt creation, or mutation effects" (lines 327-335), but the shipped mutation route consults the client-mutation settlement cache **before** the generation check and, on a hit, returns the original result and creates a receipt with no comparison at all.
- *Evidence:* `src/local.rs:10928-10979` — the settlement branch (`@ref LLP 0043#settlement-consumption…: "A committed settlement is independent of the continued existence of executable code"`) runs first; `client_mutation_result` lookup at `:10949`; receipt creation at `:10967`; `validate_expected_generation` is reached only on a cache miss at `:10983-10984`. The settlement identity excludes the generation (`ClientMutationIdentity::for_authority(id, name, input, authority_instance_id)`, `:10944-10949`). The fresh-execution path's settlement lookup has the same shape (`:11031-11043`). So in sessions mode, a retry of an already-committed mutation carrying a stale `expectedGeneration` receives success plus a receipt — a rollout interleaving in which the server does not refuse.
- *Why it matters:* 0147 claims to "adopt the landed per-invocation generation tuple" (line 115-116), so its description of that mechanism must be true; this is precisely a "rollout interleaving" in gate 12's words (lines 708-710), and a fixture written to gate 12's plain reading (old generation ⇒ refuse) would fail against correct shipped behavior. The behavior itself is arguably right — the effect happened while the asserted generation was active, and refusing the replay would manufacture false ambiguity — but the RFC currently mandates something the code deliberately does not do. It is reachable from Micro v1 if the `idempotent` retry class (lines 544-550) is realized with `clientMutationId`, which is the only shipped mutation idempotency mechanism (`src/manifest.rs:5693-5703`). Note LLP 0012:880-888 shares the same overstatement, so the fix may warrant a dated 0012 clarification too.
- *Resolution:* two or three sentences in D4 naming the settled-replay carve-out (replayed settled mutations re-acknowledge their original outcome without fresh generation admission, per LLP 0043's settlement independence; no new effects occur); state whether Micro v1 mutations carry `clientMutationId` (see F4); qualify gate 12 so its fixtures assert refusal for *fresh* admissions and settled-replay re-ACK for the replay interleaving.

**F2 — MATERIAL. §Packaging names a diagnostic code that does not exist, violating the document's own no-minting rule.**
- *Defect:* "`SNAPBACK_CAPABILITY_UNAVAILABLE` reserved for genuinely dynamic target mismatches" (lines 607-609) names a code with zero occurrences in the codebase; the registered code for a target lacking a required capability is `SNAPBACK_CAPABILITY_UNSUPPORTED` (`src/local.rs:3593, 3603, 4112`).
- *Evidence:* repo-wide grep finds `SNAPBACK_CAPABILITY_UNAVAILABLE` only in LLP 0145 (line 1757, where the slip originates) and LLP 0147. Meanwhile §Compile and generation failures says "this RFC does not mint names without the code-table owner" (lines 524-526).
- *Why it matters:* the program's bar is that every factual claim about the codebase must be true; presenting an unregistered name as "reserved" is exactly the confabulation class this loop screens for, and it contradicts the document's own rule three hundred lines earlier.
- *Resolution:* either cite `SNAPBACK_CAPABILITY_UNSUPPORTED` or explicitly mark the name as proposed-pending-registry. Consider a one-line errata note to LLP 0145.

**F3 — DETAIL. Client behavior on success with mismatched `facts.activeGeneration` is unspecified.** §Runtime contract says the runtime "compares any returned `facts.activeGeneration` with the request generation before publication" (lines 536-538) but never says what the comparison does on mismatch. The mismatch is reachable: F1's settlement replay, and the benign race where facts are computed in a second lock acquisition after invocation (`src/server.rs:17737-17745`), so a rollout can land between admission and facts. D6's conservatism list should name the outcome (e.g., treat as a deployment transition: publish nothing, surface a structured diagnostic or resnapshot). Implementation-phase in mechanism, but the *policy* belongs in D6's list, which is why it is worth one sentence now.

**F4 — DETAIL. Micro v1's mutation idempotency mechanism is unnamed.** The `idempotent` retry class requires "a declared idempotency mechanism" (lines 547-550) without saying what one is; the only shipped mechanism is `clientMutationId` settlement (LLP 0043), and D5's absence list ("durable outbox, offline replay, optimistic settlement," lines 381-382) invites the misreading that it is excluded. One sentence: Micro v1 mutations may carry `clientMutationId` for transport-ambiguity retry only (no durable outbox), or may not — but say which. Interacts with F1's carve-out either way.

**F5 — DETAIL. The gate preamble's "all applicable gates" leaves a formal loophole against §Summary.** §Summary makes sessions composition a graduation requirement (lines 51-54), but "applicable" (line 670) is undefined; a dev-only profile could read gates 10-12 and 16-21 as inapplicable and claim graduation. One sentence — "product graduation always includes the sessions-composition gates; local-dev-only evidence never graduates" — closes it and matches D4's existing intent (lines 349-354).

**F6 — DETAIL. §Compile and generation failures lacks the failure family D3's guard clause depends on.** D3 promises profile-admission refusal when the target does not advertise the argument/result contract capabilities (lines 311-314), but the failure list (lines 511-523) has no "target missing required contract capability" family — the closest entries cover a *function* missing its contract and a *live* route capability. Since gate 7 tests exactly the listed families, the guard D3 leans on for arm safety (including the Cloudflare case) would ship without a negative fixture. Add the family.

**F7 — DETAIL. Related header omits LLPs the body load-bears on.** LLP 0010 (diagnostic registry, cited line 524), LLP 0115 and LLP 0127 (the admin decision, lines 395-397), and — once F1 is fixed — LLP 0043 (settlement independence) are absent from the Related list (lines 12-15). All cited numbers that *are* present are real with matching slugs.

**F8 — DETAIL. D3 asserts an envelope-check list that OQ8 then treats as open.** D3 fixes what the Micro runtime "still validates" (lines 292-295) while OQ8 asks which checks are "the minimum sufficient client defense" (lines 811-812). Not a contradiction if D3 is a v1 floor and OQ8 asks about future narrowing — but say so, since as written a reader cannot tell whether the list is decided.

No BLOCKING findings. Nothing in D1-D7 is internally inconsistent beyond the items above; the implementation sequence's dependencies (React seam held to Phase D behind the LLP 0114 amendment; sessions in Phase C before any capability-class proposal) are consistent with the decisions and gates.

## 4. Suggestions (non-blocking)

- **Gate 12 could positively require the settled-replay fixture** once F1's carve-out is written: same `clientMutationId`, generation rotated between commit and retry, expect original result + `facts.activeGeneration` showing the new pair. That converts the carve-out from an admission of imprecision into a tested honesty property — very much this document's style.
- **D4 could note the facts-race explicitly** (facts are current-at-response, not admission-atomic) in the same sentence that resolves F3; it costs one clause and pre-empts a future reviewer re-deriving it.
- **§Packaging's migration-recipe sentence** could point at the capability/nonclaim table as the object agents diff when choosing Full vs Micro — the RFC's agent-consumer story (in §Benefits) is otherwise carried entirely by diagnostics.
- Growth-budget note: all findings above resolve in well under the ~20% budget; F1+F2 together are roughly ten lines of edits plus two gate-wording adjustments.

## 5. Open questions the document should answer

1. Does Micro v1 carry `clientMutationId`, and therefore the settled-replay semantics? (F1/F4 — should be answered in the body, not left open.)
2. What does the Micro client do when a successful response's `facts.activeGeneration` differs from its request generation? (F3 — belongs in D6's policy list.)
3. Which generation-failure family covers a target that does not advertise `args_contract_v1`/`result_contract_v1`? (F6.)
4. The existing OQ list (1-9) is otherwise well-chosen; OQ7's "no change until measured pressure" and OQ3's inherited D-C posture are exactly right. I found nothing decided in the body that should have been open, beyond the F8 clarification of D3-vs-OQ8 direction.

## 6. Readiness verdict

**NOT READY.**

Grounds: two MATERIAL factual-precision defects (F1: D4's atomicity claim contradicted by the shipped settlement-replay path, inherited into gate 12; F2: a nonexistent diagnostic code presented as reserved, against the document's own minting rule). Both are inexpensive to fix and neither indicts the architecture; the six DETAIL findings are implementation-phase or single-sentence matters. With F1 and F2 resolved (and F4-F6 addressed or explicitly deferred), this reviewer would expect to return READY without reservation: the design is thought through as far as it can be without running code, which is this program's bar.

## Orchestrator verification (outside the verbatim body)

Spot-checked independently before applying:

- **F1 CONFIRMED**, and the author pass found it independently. `src/local.rs:10933-10981`
  returns the cached settlement and records a receipt before
  `validate_expected_generation` at `:10984`.
- **F2 CONFIRMED.** Repo-wide, `SNAPBACK_CAPABILITY_UNAVAILABLE` occurs only at
  `llp/0145:1757` and `llp/0147:608`. The registered code is
  `SNAPBACK_CAPABILITY_UNSUPPORTED` (`src/local.rs:3593, 3603, 4112, 4623`).
- **F7 CONFIRMED** by the author pass independently.
- **The "no BLOCKING findings" conclusion is refuted by the codex family**, which found
  the unvalidated `live_delta` publication path that this review's D3 strengths
  paragraph passed over. The author pass found it independently before either review
  landed. See the round-1 journal.


## Round 2 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; delta-scoped — permitted to read this artifact's round-1 section (own
family) and instructed not to read the codex artifact or the super-refine
journal. SHA-pinned target and instruction capsule. No tests executed.
**Instruction capsule SHA-256:** `bc89a587ce0ba8368225dc95379b838cdb424c6e35632bdee1602a5c946924a4`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.2, 970 lines, Draft)
**Target SHA-256:** `4380d0f338321b878a98c3a6aa91f120788d53cc8c5364670f8ba77e17ab496c`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 17
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review — LLP 0147: Ahead-of-time compiled microclient (round 2, v0.2)

**Reviewer:** independent LLP reviewer (Fable family), read-only, per capsule `capsule-r2.md` (target SHA-256 `4380d0f3…7ab496c` verified against the pin; 970 lines; repo `main` at `67628399`).
**Blindness:** `llp/reviews/0147-compiled-microclient.fable.md` (own family, round 1) was read; `llp/reviews/0147-compiled-microclient.codex.md` was not opened, grepped, or inspected. No 0147 super-refine journal was read.
**Method:** claim-by-claim verification against the working tree by direct code and corpus reading; no tests executed. Every anchor cited below was read in this session unless explicitly marked as carried from round 1 or inferred.

## 1. Overall assessment

**NOT READY — narrowly, on two propagation defects the v0.2 rewrite itself created, not on the design.** Both round-1 blockers are genuinely resolved in the decisions: D4 now describes the shipped settled-replay behavior exactly as the code implements it (verified to the line), and its authority argument from LLP 0108 §B is a correct reading of that spec; D3 now tells the truth about the delta-lane egress gap, files it, gates it red, and sequences the server fix as a Phase B precondition — and this honesty does not undermine D1–D7 as a composition, because the trust claim is conditioned, live-selecting profiles are blocked by gate 11a, and non-live profiles are untouched. The `clientMutationId` removal is a sound, code-compatible decision that makes the carve-out unreachable from Micro v1 (verified: the settlement branch requires a present id). Every change the Revised header claims is present in the body, and every codebase claim I checked in the rewritten sections is true — with one exception. The two remaining defects are exactly the class the capsule predicts for a one-pass rewrite of this size: gate 11a's positive arm forecloses a fix option that D3 and OQ10 both hold open, and §Motivation still asserts, unqualified, the egress universality that v0.2's own D3 retracts. Both are one-to-three-clause fixes. A round-3 READY should be routine.

## 2. Strengths

Verified against source in this session unless marked otherwise.

- **Blocker 1 is resolved, and D4's new text is exact.** The shipped mutation route consults the settlement cache before it selects a function: the settlement branch spans `src/local.rs:10933-10981` (lookup at `:10949`, receipt recorded at `:10967-10976`), function selection (`self.function(name)?`) happens at `:10983`, and `validate_expected_generation` at `:10984` — reached only on a cache miss, precisely as D4 (llp/0147:381-386) now says. "Without comparing generations at all" is right because `ClientMutationIdentity::for_authority(id, name, input, authority_instance_id)` excludes the generation (`:10943-10948`). "The path dispatches no handler and produces no new effect" matches both the empty-changes commit (`:10958-10966`) and the in-code design comment ("only a cache miss proceeds to active function selection. This path never dispatches a handler," `:10928-10932`, carrying an LLP 0043 settlement-consumption `@ref`) — so "deliberate and correct" is evidenced, not asserted.
- **D4's authority argument reads LLP 0108 §B correctly.** §B ("No new expected-operation or compatibility protocol in v1," `llp/0108:701`) removes `ExpectedOperationV1` from the slice (`:703-705`), and the quoted sentence — "Existing mutation settlement identity, lookup order, acknowledgement, retention, replay, and garbage collection remain exactly as governed by LLP 0043" — is verbatim at `llp/0108:711-713`. The adjudication "LLP 0043 governs settlement recovery, D4 governs fresh admission" (llp/0147:392-394) is the correct partition.
- **"Unreachable from a Micro v1 client" is verified at the code level.** The settlement branch is entered only under `if let Some(id) = client_mutation_id.as_ref()` (`src/local.rs:10933`), and the parameter is `Option<String>` (`:10918`) with a server-synthesized receipt id on the None path (`:11010-11012`) — so a client that never sends the field is both fresh-admission-only and wire-compatible with the shipped route. Gate 12's negative fixture ("proves the generated client never emits one," llp/0147:830-831) is the right proof obligation for that.
- **Blocker 2 is resolved as an RFC matter, with every factual element checked.** The LLP 0108 quote in D3 is verbatim (`llp/0108:440-441`); the delta lane copies committed rows into wire ops (`row: op.row.clone()`, `src/local.rs:19551-19562`) and serializes at `:19594`, with zero `validate_handler_result`/`result_contract` references anywhere in `:19195-19700` (grep-verified); the full query path validates before the publication effect guard (`:23055-23060`); the reachability premise holds because authored contracts take precedence over the table default (`packages/snapback-codegen/result-contracts.mjs:594-595`); and the ticket exists with the three fix shapes and their costs, as OQ10 claims (`issues/20260801-live-delta-frames-bypass-result-contract-validation.md`, §Candidate fixes). Making closure a D3 precondition with gate 11a declared red (llp/0147:326-329, 818-821) and Phase B doing the server work (llp/0147:728-732) is the honest composition; the Consequences re-pricing ("makes every hole in that seam a Micro correctness bug," llp/0147:898-903) is exactly the right admission.
- **The retry-class retirement is internally complete.** `idempotent` appears only as the deliberately-absent class (llp/0147:634-640); D4, D6's ambiguity rule, §Runtime contract's two classes, gate 12, and gate 15 are mutually consistent (llp/0147:396-404, 486-488, 624-632, 826-834, 840-841); the profile artifact carries no orphaned field. D4's cross-reference to D5's disclaimed surface (durable outbox / offline replay / optimistic settlement, llp/0147:451-453) checks out.
- **The diagnostic-code fix landed correctly.** `SNAPBACK_CAPABILITY_UNAVAILABLE` survives only in the Revised header describing its own removal (llp/0147:23); the body cites the registered `SNAPBACK_CAPABILITY_UNSUPPORTED` (llp/0147:693-696), real at `src/local.rs:3593, 3603, 4112, 4623`.
- **The new target-capability failure family is grounded.** The family is in §Compile and generation failures (llp/0147:595-597), gate 7a tests it (llp/0147:796-799), the capability ids are real and fail-closed (`src/manifest.rs:1966-1977, 2144-2150`), and the "second independent reason" about the Cloudflare arm is exactly true: `supportedCapabilities: ["live_subscriptions"]` and nothing else (`cloudflare/generated/capability.manifest.cloudflare-do-sqlite-v8.json:18-20`).
- **New corpus citations are real.** OQ10's economy attribution: LLP 0090 D1 ("The primitive," `llp/0090:240`) with O(changed rows) refresh (`llp/0090:309`), corroborated by the delta-lane code comment citing LLP 0090 D1 (`src/local.rs:19564-19569`). Phase A's "LLP 0063 Workstream 8's committed cost-attribution manifest": `llp/0063:1749, 1776`. Motivation's LLP 0145 OQ20: `llp/0145:102, 1878`.
- **The graduation-preamble loophole is closed as commissioned** (llp/0147:766-772), gate 15a matches D3's envelope floor item for item (llp/0147:331-336 vs 842-847), OQ8 is now unambiguous about direction (llp/0147:945-947), and the Revised header's change list is a complete and accurate description of the body — I found no claimed-but-absent or absent-but-claimed change.
- **Gate 11b is satisfiable** — it is not a new unsatisfiable-universal gate. The enumeration universe is closed by construction: client-bound publications are serializations of a known envelope family (e.g. `LiveEnvelope` variants, `src/local.rs:19594`), so "enumerated and shown to cross the seam" is a finite audit of frame constructors plus one witness per path, not a proof of a negative. *(Assessment; the closed-universe premise is verified for the live lane, inferred for the remaining response bodies.)*
- Carried from round 1, text unchanged in v0.2: the five-carrier generation claim, refusal semantics and `facts` derivation, fresh-path ordering across all five request kinds, dev-mode tolerance, the D5 irreducibility audit, D7's `auth/live` rule, size figures, and the `./online` claim. *(Round-1 verified; spot-rechecked only where v0.2 touched adjacent text.)*
- One unstated strength worth recording: D6's facts-mismatch refusal composes safely with D4 — after a mid-request rollout, a re-submission from the now-stale Micro client is refused at fresh admission, so the conservative policy cannot cause a duplicate effect in sessions mode even though v1 has no settlement dedupe.

## 3. Findings

**F1 — MATERIAL (v0.2 regression). Gate 11a's positive arm forecloses OQ10's option 3 and contradicts D3's own acceptance of it.**
- *Defect:* Gate 11a requires that in the narrowed-contract fixture "a contract-valid change still **deltas** … in the same fixture" (llp/0147:816-818), but OQ10 holds open "refusing the delta lane for narrowed contracts in favor of a validated replacement" as one of three candidate fixes (llp/0147:951-954), and D3 itself blesses that shape: "until the delta lane validates — **or refuses in favor of a validated replacement** — …" (llp/0147:326-328). Under option 3 the fixture's subscription has a narrowed contract, so the contract-valid change arrives as a replacement and no delta frame exists; the positive arm fails as written.
- *Why it matters:* This document's own discipline is that the gates are fixed so a follow-on Plan "cannot silently change the contract" (llp/0147:101-103). As written, either OQ10 is fake-open (option 3 is dead on arrival against a gate), or the gate must be quietly reworded at fix time — exactly the silent-rescoping the RFC forbids. Three normative texts disagree about whether refuse-with-replacement can graduate.
- *Resolution:* Make the positive arm fix-neutral — e.g. "a contract-valid change still reaches the subscriber promptly, as a delta or as a validated replacement where the chosen fix refuses the lane for narrowed contracts, so a fix cannot pass by suppressing publication" — or deliberately foreclose option 3, deleting it from OQ10 and from D3's parenthetical and stating that gate 11a requires preserving the delta lane. Either is one edit; the document must pick one. (The ticket's acceptance section shares the wording; mirror it there when the RFC lands, though the ticket is outside this review's target.)

**F2 — MATERIAL (v0.2 incomplete propagation). §Motivation still asserts, unqualified, the egress universality that D3 retracts.**
- *Defect:* Under the frame "Snapback **already performs** most application-specific proof outside the browser" (llp/0147:113-115), the bullet reads "[LLP 0108] validates results server-side before query/live publication, before mutation commit, and before action-result publication" (llp/0147:119-121). On the live-delta path this is false — the very finding v0.2 accepts: "It does not honor it on the live *delta* path" (llp/0147:321-323; code at `src/local.rs:19551-19594`).
- *Why it matters:* This program's bar is that every factual claim about the codebase must be true, and this is the same claim class that made round 1 NOT READY. The revision qualified the sibling generation bullet in the same list ("for every *fresh* admission…", llp/0147:130-133) but left this bullet untouched, so a reader of §Motivation alone is told the premise D3 spends three paragraphs correcting. Reading it as a claim about the spec rather than the server does not survive the "already performs" lead-in.
- *Resolution:* One clause — e.g. "…before query/live publication (on the snapshot and re-run paths; the delta-lane exception is a shipped defect D3 records and gates), before mutation commit, and before action-result publication." Net growth ~1 line.

**F3 — DETAIL (v0.2-introduced text). D6's facts-mismatch rationale misstates the risk on the sessions path, and the diagnostic's honesty class for effectful operations is unnamed.**
- *Defect:* The bullet justifies refusal as avoiding "a typed value from an artifact the client never compiled against" (llp/0147:494-496), but on the benign path the same bullet describes — rollout landing between admission and response facts — fresh admission already compared generations before execution, so the value provably came from the artifact the client *did* compile against; the foreign-artifact risk exists only in dev mode, where generation is tolerated. Separately, for a mutation the refused publication converts a known server-side commit into "a structured diagnostic" (llp/0147:490-491) of unspecified class.
- *Why it matters:* The policy itself is defensible (uniform conservatism; and per the strength noted above, the stale client cannot double-submit in sessions), so no decision is defective — but the rationale should not overstate, and the diagnostic for an effectful operation must carry may-have-committed semantics so an application does not read it as failure.
- *Resolution:* Reword the rationale clause (net zero) and add one clause naming the diagnostic's indeterminate-outcome semantics for mutations/actions, e.g. by folding into the existing ambiguity bullet's vocabulary (llp/0147:486-488).

**F4 — DETAIL (v0.2 regression, same class as round-1 F7). Related omits LLP 0090, which OQ10 now load-bears on.**
- *Evidence:* OQ10 cites "LLP 0090 D1's per-changed-row economy" (llp/0147:955-956); the Related list (llp/0147:31-34) lacks LLP 0090 while the companion ticket's own Related includes it.
- *Resolution:* Add `LLP 0090` to Related. Zero-growth header edit.

**F5 — DETAIL. §Costs does not price the one real product cost of the no-`clientMutationId` decision.**
- *Defect:* Dropping settlement means every transport-ambiguous mutation is an application-visible indeterminate outcome with no safe retry, where Full absorbs the same blip silently via LLP 0043 replay. D4 and §Runtime contract specify the mechanism honestly (llp/0147:396-404, 624-632), and Phase B fixtures it, but §Costs (llp/0147:890-905) prices resnapshot traffic and dual maintenance, not this UX consequence.
- *Why it matters:* The capsule's question — does the decision cost something unpriced — has exactly this answer. The decision itself is right for a byte-floor v1 (settlement custody is real bytes plus the ack lifecycle plus the carve-out semantics), but the consequences section should carry it.
- *Resolution:* Extend the existing "conservative Micro client" cost bullet (llp/0147:894-895) with one clause — displacement-friendly, no new bullet needed.

No BLOCKING findings. All eight round-1 Fable findings (F1–F8) are resolved in v0.2, each verified above or in §2; I found no other v0.2-introduced factual error, dangling cross-reference, or gate/decision mismatch — gate numbers cited from D3/D4/OQ8/Consequences (7a, 11a, 11b, 12, 15a) all exist and say what the citing text claims.

## 4. Suggestions (non-blocking)

- **Name gate 11b's enumeration anchor** — "every constructor/serialization site of a client-bound envelope type" — so "enumerated" has a mechanically checkable universe rather than an auditor's judgment. One clause inside the existing gate text.
- **Commission the dated LLP 0012 clarification alongside the LLP 0114 amendment.** `llp/0012:880-888` still states the unconditional pre-effect comparison that D4 now correctly carves out (round-1 verified; unchanged). D3 already models the pattern of commissioning a projection amendment on acceptance (llp/0147:360-364); D4 could do the same in one sentence. Not blocking because 0147 nowhere claims 0012 states the carve-out.
- **State the D6/D4 composition explicitly:** one clause noting that a facts-mismatch refusal cannot lead to a duplicate effect in sessions because the stale client's re-submission fails fresh admission. It converts F3's worry into a designed property, in this document's style.
- Displacement accounting per the capsule: F1, F3 (first half), and F4 are net-zero rewordings; F2, F3 (second half), and F5 are one clause each, absorbable into existing sentences/bullets — total growth well under one percent.

## 5. Open questions the document must answer

1. Does gate 11a deliberately require preserving the delta lane (foreclosing OQ10 option 3), or is the fix choice genuinely open? (F1 — currently the document answers both ways.)
2. What diagnostic class does a Micro runtime surface when a *mutation's* success envelope carries mismatched `facts.activeGeneration` — and does it state that the effect may have committed? (F3.)
3. The existing OQ set (1–10) is otherwise well-formed; OQ10 is the right way to hold the delta-fix choice open *once F1 makes the gate consistent with it*, and I found nothing else decided in the body that should be open or open that should be decided.

## 6. Readiness verdict

**NOT READY.**

Grounds: F1 (a v0.2-introduced contradiction between gate 11a, D3, and OQ10 over whether refuse-with-replacement can graduate — a coherence defect in normative text under the RFC's own gate-stability rule) and F2 (an unqualified §Motivation universality claim that the revision's own accepted finding falsifies — the same factual-truth class that blocked round 1). Both are clause-level fixes with no design consequence; the three DETAIL findings are single-sentence matters. The architecture, both blocker resolutions, the carve-out's code-level accuracy, the retry-class retirement, and the new gate structure are verified sound. With F1 and F2 resolved, this reviewer expects to return READY: the design is thought through as far as it can be without running code, and what remains is making every sentence of the document say so consistently.

## Orchestrator verification (outside the verbatim body)

- **F1 and F4 CONFIRMED**, and both were found independently by the codex family, blind.
- **F2 CONFIRMED.** §Motivation's LLP 0108 bullet was not propagated when D3 was
  rewritten; the sibling generation bullet in the same list was. Fairly charged
  as a v0.2 propagation failure.
- **F3 CONFIRMED and the reasoning is correct**: in sessions mode fresh admission
  compares generations before execution, so a mid-request rollout still yields a
  result computed by the artifact the client compiled against. The v0.2 rationale
  overstated the risk. The dev-mode caveat the finding adds is also right.
- **F5 CONFIRMED**; the codex family reached the same conclusion as its
  suggestion 3, blind.
- The codex family, blind to this review, additionally found that D4's "no
  conflict to adjudicate" claim is **false against LLP 0012**, which still states
  the settlement-relevant ordering unconditionally (`llp/0012:881-884`) where
  LLP 0043 states the opposite (`llp/0043:286-296`). This review raised the same
  0012 text only as a non-blocking suggestion. The orchestrator accepts the
  higher severity: v0.2 resolved the LLP 0108 half and wrongly declared the whole
  conflict gone.


## Round 3 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; delta-scoped — permitted to read this artifact's prior rounds (own
family) and instructed not to read the codex artifact or the super-refine
journal, which the reviewer confirms it did not open.
**Instruction capsule SHA-256:** `84f555a976cc459df834189110460d5ec2fc26cc67b50e2f4fd3b2d6b3e4699f`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.3, 1031 lines, Draft)
**Target SHA-256:** `07f915fc2510a45ad38722f8bab06d722235f1935e3b7af85679a1880c428c7e`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 26
**Status:** completed
**Verdict:** READY (with one MATERIAL to apply before acceptance)

## Verbatim review

# Review — LLP 0147: Ahead-of-time compiled microclient (round 3, v0.3)

**Reviewer:** independent LLP reviewer (Fable family), read-only, per capsule `capsule-r3.md`.
**Target:** `llp/0147-compiled-microclient.rfc.md`, 1031 lines, SHA-256 `07f915fc…428c7e` (verified against the capsule pin; repo `main` at `67628399`, target untracked, read from the working tree).
**Blindness:** `llp/reviews/0147-compiled-microclient.fable.md` (own family, rounds 1–2) was read. `llp/reviews/0147-compiled-microclient.codex.md` and `llp/reviews/0147-compiled-microclient.super-refine.md` were not opened, grepped, or inspected.
**Method:** claim-by-claim verification of every v0.3 change against the working tree by direct code and corpus reading; no tests executed. Every anchor cited was read in this session unless explicitly marked as carried from rounds 1–2 or as inferred.

## 1. Overall assessment

**READY.** For the first time in this loop, the document's factual layer is true everywhere I checked. All seven v0.3 changes are present, and each one I verified is correct against its referents: D4's rebuilt conflict statement quotes all three specs accurately and the shipped code sides with LLP 0043 exactly as claimed; the commissioned LLP 0012 clarification is scoped to cover both of that section's conflicting sentences and nothing more; gate 11a's fix-neutral arm admits all three OQ10 fixes while remaining falsifiable in both directions, and the companion ticket's acceptance section now mirrors it; the gate 15a / D3 narrowing lands precisely on LLP 0095's tolerance floor — including its "tolerance is not a license for known kinds" counterexample — with the unknown-kind fixture genuinely present and seeded for gate 16 to import; the retry restatement leaves no carried-field residue anywhere in the document; gate 12's reconciliation obligation rests on a shipped behavior I verified (the replay arm does return current-active facts); and the round-2 propagation and pricing fixes all landed. What remains is one MATERIAL defect — a v0.3-introduced safety absolute in D6 that does not survive two reachable interleavings — plus two clause-level DETAILs. I return READY despite the MATERIAL because it differs in kind from the defects that blocked rounds 1 and 2: those were falsehoods in the factual layer (a mechanism description contradicted by shipped code; a fabricated diagnostic code; a three-way normative contradiction; a retracted claim still asserted). This one is an overreaching inference drawn *from correctly stated facts*, it is contained by the document's own adjacent normative rule (the mandated may-have-committed diagnostic makes blind retry non-conformant regardless of the clause), no gate or decision cites it, and its fix is a one-clause scoping edit that requires no re-verification against code. That meets the bar: "thought through as much as we can without writing code" is not "no flaws," and a fourth full round over one clause would be disproportionate. The finding must still be applied before acceptance.

## 2. Strengths

Verified against source in this session unless marked otherwise.

- **D4's conflict statement is true on all three referents, quote by quote.** LLP 0012 §Call-time generation binding states its rule unconditionally — "an unequal asserted pair refuses before handler, acknowledgement, receipt, or mutation effects" is verbatim at `llp/0012-headless-integration-contract.spec.md:883`, and the section (`:871-907`) contains no settlement carve-out; the only "settlement" mention elsewhere in 0012 (`:861`) is an unrelated demo description. LLP 0043's quoted ordering is a fair elision of `llp/0043-offline-replay-retention.rfc.md:286-294`, including "A hit republishes the stored result without handler dispatch" and "A miss then uses ordinary active-function selection." LLP 0108 §B's deferral is verbatim at `llp/0108-inline-handlers-and-result-contracts.spec.md:711-713`. The shipped code sides with 0043 and against 0012's letter: settlement lookup and receipt creation at `src/local.rs:10933-10981`, function selection at `:10983`, `validate_expected_generation` only at `:10984`. "LLP 0012 is the document that disagrees with both LLP 0043 and the implementation" (llp/0147:423-424) is exactly right.
- **The commissioned LLP 0012 amendment is well-scoped — neither too broad nor too narrow.** LLP 0012's paragraph contains *two* sentences the settlement path violates: the generation rule and "Selection runs first so a removed or unknown function keeps `SNAPBACK_UNKNOWN_FUNCTION`" (`llp/0012:881-882` — a pre-GC settlement hit for a removed function republishes with no selection at all). D4's commission (llp/0147:426-431) covers both: fresh-admission scoping handles the first, and "what a replay returns … for a removed function" handles the second. The parenthetical's LLP 0043 answer is verbatim-true: "after authenticated ACK GC, replay of an id whose function was removed returns `SNAPBACK_UNKNOWN_FUNCTION`" (`llp/0043:294-296`). The four non-mutation carriers have no settlement path, so fresh-admission scoping is a no-op for them — not too broad.
- **Gate 12's reconciliation claim is grounded in shipped behavior, not speculation.** The settlement-replay arm flows into the same facts-bearing response path as fresh commits: `StagedRecordedMutation::Done` (`src/local.rs:10977-10980`) reaches the `Ok(output)` arm where facts are computed (`src/server.rs:18838-18851`), and facts are the *current* active pair (`src/local.rs:150-168`). So a post-rotation replay really would return a success envelope whose facts differ from the request generation, and D6's rule as written really would suppress it — the reconciliation obligation (llp/0147:885-889) names a real future conflict and correctly defers it to the measured successor.
- **Gate 11a is fix-neutral and still gates.** Negative arm: no delta and no replacement carrying the contract-invalid row. Positive arm: a contract-valid change reaches the subscriber as a validated delta or a validated replacement (llp/0147:863-873). I walked all three OQ10 fixes through both arms: each passes both; a suppress-everything non-fix fails the positive arm; a publish-everything non-fix fails the negative arm. The gate is falsifiable and forecloses nothing. *(Analytical, over verified code facts.)* The companion ticket's acceptance section was reworded to match, including the explicit note that requiring a delta would foreclose fix 3 (`issues/20260801-live-delta-frames-bypass-result-contract-validation.md:109-120`).
- **The gate 15a / D3 narrowing lands exactly on LLP 0095.** The tolerance floor is real: "unknown envelope kinds are skipped, never fatal … Fixtures: `negative.unknown_kind.skipped`, `negative.unknown_field.tolerated`" (`llp/0095-client-lifecycle-and-conformance.spec.md:315-320`), and the unknown-kind fixture is **seeded** (`llp/0095:475`), so "gate 16 imports that fixture" is true, not aspirational. Critically, 0095 itself says "Tolerance is not a license for known kinds — T-DB is the counterexample" (`llp/0095:318-319`), which is precisely the known/unknown split gate 15a now draws. I also checked the composition the capsule asked about: 0095's malformed-known-payload prescriptions (T-DB forced resync, `llp/0095:210-221`) require *more* than 15a's "structured error and publish nothing," not something contradictory — and gate 16 supplies the more. No collision remains.
- **The retry restatement is complete.** A full-document sweep finds no residue of a carried retry field: every mention (llp/0147:670-689 and the header) is consistent with kind-derived policy, the descriptor example is `{ kind, name }` (llp/0147:301-302), and the profile-artifact field list (llp/0147:609-626) has no retry member. The deliberately-absent-`idempotent` paragraph correctly names what a future declared class would require, and the only shipped idempotency mechanism claim carries from round 1 (verified then at `src/manifest.rs:5693-5703`).
- **D6's rewritten facts-mismatch rationale is now factually right where v0.2 was wrong.** "The value came from the artifact the client compiled against" is true at the code level: the function is cloned from the manifest at `src/local.rs:10983` under the same admission that passed `validate_expected_generation` at `:10984`, so a rollout landing mid-execution cannot swap the handler. "In sessions mode it did [commit]" is true — a success envelope implies the commit succeeded. The indeterminate-outcome class round 2 asked for is present (llp/0147:534-536). The one residual overreach is Finding F1.
- **Both round-2 propagation defects are fixed.** §Motivation's LLP 0108 bullet now carries the qualification (llp/0147:140-144: "honored on the snapshot and re-run paths, with one shipped delta-lane exception D3 records and gates"), and §Costs prices the manual-retry consequence with the explicit author-facing warning (llp/0147:949-956). The delta-lane defect itself remains real in the working tree — zero `validate_handler_result`/`result_contract` hits in `src/local.rs:19195-19700` (re-verified by grep this session) — so D3's red gate is still honest.
- **Bookkeeping is clean.** LLP 0090 is in Related (llp/0147:52); gate 11b has its mechanical enumeration anchor (llp/0147:877-879); "no conflict to adjudicate" survives only in the Revised header describing its own removal (llp/0147:33); the header's ten-item change list matches the body one for one — I found no claimed-but-absent or absent-but-claimed change; and all v0.3-added cross-references (gates 7a/11a/11b/12/15a/16, "OQ10's three shapes," "the same commissioning pattern D3 uses for LLP 0114") resolve.
- Carried from rounds 1–2, text unchanged in v0.3 (spot-rechecked only where adjacent text moved): the five-carrier `expectedGeneration` claim, refusal semantics, dev-mode tolerance, the Cloudflare capability manifests and the "second independent reason," the D5 irreducibility audit, D7's `auth/live` rule, the size figures, `./online`, and the authored-contract-precedence reachability premise.

## 3. Findings

**F1 — MATERIAL (v0.3 regression). D6's "cannot cause a duplicate effect" absolute is falsified by reachable interleavings; the fresh-admission fence it cites is transient, not permanent.**
- *Defect:* D6 justifies "it is safe to re-decide by hand" with "a stale client's resubmission is refused at fresh admission, so conservatism here cannot cause a duplicate effect even without settlement dedupe" (llp/0147:540-542) — but the fence holds only while the rotated generation stays active and the client stays stale, and neither condition is durable.
- *Evidence:* Generation identity is purely content-derived — `validate_expected_generation_against_manifests` compares only manifest-derived hashes with no deployment nonce (`src/local.rs:158-175`) — so an operator rollback that re-activates the byte-identical prior artifact re-admits the stale client's retry, which then commits a second effect (no `clientMutationId`, no dedupe). Worse, the fence's expiry is *designed*: §Costs itself requires "lockstep regeneration in sessions deployments" (llp/0147:957-958), so the mainline recovery path un-stales the client, after which a hand retry is admitted under the new generation and duplicates. Both interleavings are but-for caused by the suppression: had the client published the (provably correct, committed) success, no retry would occur. The bad-deploy-then-rollback sequence is exactly when facts-mismatch diagnostics spike, so the window is not exotic. Full is immune in the same scenario via LLP 0043 settlement replay (`llp/0043:286-296`) — which is why "even without settlement dedupe" is the clause that overreaches.
- *Why it matters:* This is the exact claim the capsule directed scrutiny at, and it is a safety guarantee stated in a Decision. Its falsity is *contained* — D6 mandates the may-have-committed diagnostic in the same bullet (llp/0147:534-536), so a conformant implementation still warns the user, and §Costs already prices manual-retry duplication for the sibling ambiguity case with the same diagnostic class — but a documentation author reading D6 alone would tell applications that facts-mismatch retries are mechanically safe, which is false outside the fence window.
- *Resolution:* Scope the clause. Replace "so conservatism here cannot cause a duplicate effect even without settlement dedupe" with words to the effect of: "so conservatism cannot cause a duplicate effect *while the rotated generation remains active and the client remains stale*; once the deployment reverts to the byte-identical prior artifact or the client is regenerated, a hand retry shares the duplication exposure §Costs prices — which is why the diagnostic's may-have-committed semantics, not the fence, is the load-bearing protection."
- *Displaces:* the existing final clause of the bullet (llp/0147:540-542); net growth ≤ 2 lines, and Suggestion S1 below offers a net-negative offset in the same bullet.

**F2 — DETAIL (v0.3-introduced text). D6's "one policy across dev and sessions" rationale invokes a dev case that cannot occur.**
- *Defect:* The bullet says "The uniform refusal is chosen for one policy across dev and sessions rather than because the value is suspect" (llp/0147:538-540), but the facts-mismatch trigger is unreachable in dev: dev targets omit `facts.activeGeneration` entirely (`llp/0012:892-893`; `src/local.rs:155-157` returns `None` for any non-sessions mode), so there is no dev behavior to unify and the uniformity argument does no work. The document's own §Runtime contract is careful here ("compares **any returned** `facts.activeGeneration`," llp/0147:661-663); the D6 rationale is not.
- *Why it matters:* The operative rationale (deployment-transition semantics, honest indeterminate outcome) stands on its own; a vacuous justification clause in a Decision invites the next reviewer to re-derive exactly this.
- *Resolution:* Delete the clause or reword to "chosen as deployment-transition policy rather than because the value is suspect." Net-negative displacement inside the existing sentence.

**F3 — DETAIL (v0.3 regression). §Runtime contract's justification sentence contradicts its own list three lines later.**
- *Defect:* "…there is therefore no operation a Micro v1 client may safely retry after ambiguity" (llp/0147:673-674) is immediately contradicted by the first class it introduces: "`read`: queries may retry under the ordinary bounded transport policy" (llp/0147:676-677). Queries are operations, and an ambiguous (timed-out) query is safely retryable — that is the entire content of the `read` class.
- *Why it matters:* Self-correcting within the paragraph, so no implementer will get it wrong, but it is a literal falsehood in the sentence that justifies the two-class design.
- *Resolution:* One word: "no *effectful* operation" (or "no mutation or action"). Zero-growth in-place edit.

No BLOCKING findings. All five round-2 findings (F1–F5) are resolved and verified above; both round-2 suggestions the author took (the gate 11b anchor, the LLP 0012 commission — correctly upgraded from suggestion to acceptance requirement once the conflict proved real) landed well. I found no other v0.3-introduced factual error, dangling cross-reference, foreclosed open question, or gate/decision mismatch. One provenance note in fairness to the author: F1's defective clause implements my own family's round-2 suggestion 3, which proposed the same absolute; the overreach originates there, and round 3's job was to catch it.

## 4. Suggestions (non-blocking)

- **S1 (pairs with F1, net-negative):** D6's facts-mismatch bullet can cite §Costs rather than restate safety — "shares the manual-retry exposure §Costs prices" — letting the F1 fix land while shortening the bullet.
- **S2 (for the commissioned LLP 0012 amendment, not this document):** LLP 0012 already says "Successful sessions calls and subscriptions echo the server-derived pair" (`llp/0012:890-891`), which — read literally — already answers the replay-facts question the amendment must state (a replay is a successful sessions call; the shipped code echoes the current active pair, `src/server.rs:18838-18851`). The amendment should make the replay case explicit under that existing sentence rather than mint a new rule.
- **S3:** When the successor composition performs gate 12's reconciliation, the F1 rollback interleaving (byte-identical generation revert re-admitting a stale retry) deserves a named fixture alongside the replay interleaving — it is the other place where content-addressed generation identity and retry safety interact. One clause in the successor's scope; nothing for this RFC.

## 5. Open questions the document must answer

1. None new beyond F1's scoping: the document must say *when* the fresh-admission fence holds (while the rotation is active and the client stale) rather than implying it is permanent. The fix in F1 answers it.
2. The existing OQ set (1–10) remains well-formed. OQ10 is now genuinely open — gate 11a admits all three shapes, and the option-two economy note matches the ticket's cost analysis. OQ8's direction is unambiguous. I found nothing decided in v0.3 that should be open, and nothing open that v0.3 silently decided.

## 6. Readiness verdict

**READY.**

Grounds: every load-bearing factual claim I checked in v0.3 — three spec referents quoted verbatim-accurately, the shipped settlement/facts/delta-lane code behavior, the LLP 0095 tolerance floor and its seeded fixtures, the ticket's acceptance mirror, the retry-field sweep, and the completeness of the Revised header — is true, and the two rounds of self-inflicted revision defects have converged to zero in the factual layer. The one MATERIAL finding (F1) is an overreaching inference from true premises, contained by the document's own mandated diagnostic semantics, load-bearing for no gate or decision, and repairable by a one-clause scoping edit specified above precisely enough to apply and verify without a further review round; the two DETAILs are a deletable vacuous clause and a one-word contradiction fix. All three resolutions displace or shrink text, respecting the binding growth budget. The design has been thought through as far as it can be without running code — which is this program's bar — and F1 should be applied before or at acceptance.

## Orchestrator verification (outside the verbatim body)

- **F1 CONFIRMED**, and the codex family, blind, found the same clause defective
  by a different route and rated it BLOCKING. Its sharper version: for a mutation
  the server commits and records the outcome *before* it reads response facts
  (`src/local.rs:11227-11300`, `src/server.rs:18822-18851`), so v0.3's
  "may have committed" was not merely over-strong — it was false. v0.4 therefore
  goes past this review's scoping fix and **inverts the rule to publish the
  result**, which removes the retry incentive that both families' counterexamples
  depend on. This review's own honest provenance note — that the defective clause
  implements its round-2 suggestion — is the reason the inversion, not the
  scoping, is the right repair.
- **F2 CONFIRMED and applied** (clause deleted; the sessions-only nature of the
  comparison is now stated once, in §Runtime contract).
- **F3 CONFIRMED and applied** ("no *effectful* operation").
- **S1 and S3 adopted**; S2 is guidance for the commissioned LLP 0012 amendment
  and is carried to that landing, not to this document.


## Round 4 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only; delta-scoped,
own-family artifact only; the reviewer confirms it did not open the codex
artifact or the journal.
**Instruction capsule SHA-256:** `48396a9d52eaad71a4a66f773797b8fee349e8b82c992c4e2d279cca72e90f63`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.4, 1031 lines, Draft)
**Target SHA-256:** `d18213a8d8c2322635e37c5b07fefd46b0d7966e067905ce7b82faa9c4c292d7`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 22
**Status:** completed
**Verdict:** READY

## Verbatim review

*(Full text recorded below; the summary of grounds is preserved verbatim from
the reviewer's own §1 and §6.)*

**§1 Overall assessment — READY.** "The D6 inversion — the decision change this
round exists to test — is correct, and every factual premise it stands on is
true against the shipped code, verified independently this session: fresh
admission compares generations before function effects
(`src/local.rs:10983-10984`), the mutation commit completes in one lock
acquisition and response facts are computed only afterward in a second one
(`src/server.rs:18822-18844`), facts derive from the current active manifests
and are omitted entirely outside sessions (`src/local.rs:150-168`, `:155-157`),
and the same post-invocation facts race is reachable on the query route
(`src/server.rs:17711-17740`). The hazard the old suppression rule might have
been protecting against does not exist: mismatch detection is a race artifact,
so a response computed a millisecond before rotation carries matching facts and
publishes identical bytes — suppression never provided an invariant for queries,
live results, or effectful operations; it only converted a timing accident into
a behavioral difference, and that difference is precisely what manufactured the
duplicate-effect retry both families' round-3 counterexamples depended on."

**Findings:** two DETAIL, no MATERIAL, no BLOCKING.

- **F1 — DETAIL (v0.4-introduced text).** The new bullet's blanking rationale —
  "because subsequent frames will come from the successor artifact" — is not
  what a stale sessions client will observe: activation retires every
  generation-asserted subscription with `resync_required` reason
  `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` (`src/local.rs:19019-19048`), and "a
  fresh subscribe using predecessor artifacts receives the same HTTP refusal"
  (`llp/0012:897-899`) — so the mandated resnapshot terminates in a structured
  generation refusal until the application regenerates, not in successor-artifact
  frames.
- **F2 — DETAIL.** Gate 18's "without exposing predecessor data" can be read to
  conflict with gate 12's mandated publication of a predecessor-generation
  result; scope it to "predecessor **live state as current**."

**Suggestions:** sync the companion ticket's "promptly" wording with gate 11a's
bounded virtual-time deadline (S1); record that suppression could never be a
protection because mismatch detection is race-timing (S2); note the deterministic
interposition seam for gate 12's fixture (S3).

**§6 Readiness verdict — READY.** "…the decision change under review … is
verified sound against the shipped code at every factual anchor it cites, closes
both families' round-3 counterexamples at the mechanism level rather than the
wording level … The two findings are DETAIL-grade wording precision with
zero-growth displacing fixes, neither identifies a defective decision, and
withholding READY over them would be manufacturing a fourth round."

## Orchestrator verification (outside the verbatim body)

- **This READY was wrong, and the loop caught it.** The codex family, blind,
  returned NOT READY on a BLOCKING: the interleaving v0.4's D6 asserted — a
  deployment rotating between a mutation's commit and its response-facts read —
  is **forbidden** by LLP 0058's sessions activation barrier. This review
  verified that the two-lock seam exists (`src/server.rs:18822-18844`) and
  called it "a deterministic interposition seam," but did not check whether
  *activation* can actually interpose there. It cannot: activation blocks until
  `in_flight == 0` (`src/auth/admission.rs:639-667`) and the admission lease is
  retained through the response body's final sink (`src/server.rs:9611-9620`),
  while the facts read re-validates that same admission
  (`src/server.rs:18838-18841`, `:17735-17738`). Verifying that a code seam
  exists is not the same as verifying that the scenario reaching it is
  reachable — the round-5 capsule carries that calibration forward.
- **F1 CONFIRMED and materially upgraded.** The codex family independently
  reached the same conclusion and rated it MATERIAL: an automatic resnapshot
  loop on a stale immutable client cannot succeed. v0.5 states the rule directly
  — a deployment transition blanks, signals, and stays unreadable until the
  application regenerates — rather than repairing the rationale clause.
- **F2 CONFIRMED and applied**, and the underlying tension dissolved: v0.5 no
  longer publishes a predecessor-generation result at all.
- **S1 and S3 carried to the implementation ticket; S2 is moot** — the
  race-timing argument it offered is exactly the premise round 4 refuted.


## Round 5 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only; delta-scoped,
own-family artifact only (which at read time contained rounds 1–3; the round-4
section had not yet been appended, so the round-4 READY was known to it only
through the capsule's calibration note). The reviewer confirms it did not open
the codex artifact or the journal.
**Instruction capsule SHA-256:** `ef509d7ab6470221d76749d62daf908b06f3530ed0a242ca0608c8ecbb498d16`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.5, 1050 lines, Draft)
**Target SHA-256:** `9fc8db29d849a63c1b7dd42eb31709193ac781a0f8fb2fd9d911ec1199e4c859`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 39
**Status:** completed
**Verdict:** READY (with one MATERIAL to apply before acceptance)

## Verbatim review

*(Recorded in condensed form: the reviewer's §1 verdict paragraph, both
findings in full, and the §6 grounds, verbatim; the strengths section is
summarized with its verified anchors preserved.)*

**§1 Overall assessment — READY with one MATERIAL, a v0.5 regression.** "The
central question round 5 must decide is whether v0.5 over-corrected the v0.4
inversion, and the answer is no: the protocol-violation classification is
exactly right for the profile this RFC specifies, and I verified every link in
its argument chain against source." Verified anchors: LLP 0058 quotation
verbatim (`llp/0058:913-915`); the activation barrier blocks while any
predecessor invocation is counted (`src/auth/admission.rs:661-676`); the counted
root lives inside the HTTP response body so quiescence covers facts assembly
(`src/server.rs:9611-9638`); facts read inside the request's own admission with
explicit re-validation on **all four** facts-bearing carriers — query, mutation,
action, and authorized-lease, the last computing facts atomically in the same
lock acquisition as its generation-validated capture (`src/server.rs:17736-17740`,
`:18838-18844`, `:18908-18916`, `:18234-18243`); the no-overtake property
directly tested (`src/auth/admission.rs:1475-1524`; `src/server.rs:26760-26866`);
dev omits the fact (`src/local.rs:155-157`). "I probed every interleaving I could
construct — quiescence timeout, long-running detached actions, read-lane queries,
identity-equal redeploys, mid-flight staging — and none produces a success
envelope whose facts differ from a Micro v1 request's asserted generation."

One additional verified strength worth preserving: retirement is gated on
`activation_changed`, which is manifest/deployment equality
(`src/local.rs:4855-4857`; `src/storage/auth_mode.rs:1025-1026`), "so a
byte-identical no-change redeploy retires nothing and cannot false-positive the
stale-artifact signal. I checked this specifically because it would have been
the cheap counterexample to the new bullet; the shipped code already
distinguishes the case."

**F1 — MATERIAL (v0.5 regression). The deployment-transition bullet's
recovery-window absolutes are falsified by the operator-rollback interleaving
this loop itself confirmed in round 3, and v0.5 dropped every trace of that
knowledge.** Three statements assert the refusal window ends only at
regeneration. "All three are false under a reachable interleaving: after A→B
rotates the client stale, an operator rollback that re-provisions the
byte-identical A artifact re-activates the client's asserted generation, and
from that point resubscribes and calls are *admitted*, before any
regeneration." Evidence: generation comparison is purely content-derived, no
deployment nonce (`src/local.rs:158-167`, `:170-203`); the B→A rollback is an
ordinary same-mode provisioning with `activation_changed = true`
(`src/storage/auth_mode.rs:1025-1026`). "v0.5 contains no occurrence of
'rollback,' 'revert,' or 're-activates' in this context (repo-verified sweep)."
Contained, because the policy — blank, signal, stop — is safe under every
interleaving including rollback, and no gate cites the absolute.

**F2 — DETAIL (v0.5-introduced text). D6's classification bullet does not carry
the v1/no-settlement scoping that D4 and gate 12 both do, so a
settlement-adopting composition inheriting it verbatim would re-create the
suppressed-committed-success problem.** "…true only because Micro v1 sends no
`clientMutationId`. On the shipped server, a post-rotation replay of a settled
mutation is a *conforming* success whose facts (current active pair) differ from
the request's asserted generation… the re-scope duty is attached to the *gate*
but not to the *classification*, and D6 is the sentence a client implementer
reads."

**Suggestions.** S1: a stale client calling a function the successor removed
observes `SNAPBACK_UNKNOWN_FUNCTION`, not `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH`,
because selection runs before generation comparison — a taxonomy-completeness
gap in D6's observation enumeration. S2: gate 12's no-overtake arm can seed from
the existing tests rather than re-deriving a harness, and the rollback
interleaving deserves a named fixture in whichever composition first claims
recovery behavior.

**§6 Readiness verdict — READY, with F1 applied before acceptance.** "the
question this round existed to answer — did v0.5 over-correct? — is answered no,
with every link of the repair verified against LLP 0058's text, the admission
controller, the retained-body mechanism, all four facts-bearing carriers, and
the shipped tests; the classification is true for every request the specified
client can emit, and I could construct no interleaving that falsifies it. The
one MATERIAL defect is a v0.5 regression in the companion bullet… It differs in
kind from the defect that invalidated the v0.4 pass — it misdescribes when
refusals *end*, not whether a forbidden scenario exists; the policy it justifies
is safe under every interleaving; no gate depends on it."

## Orchestrator verification (outside the verbatim body)

- **F1 CONFIRMED** and applied. It restores knowledge this loop had already
  established in round 3 and the v0.5 rewrite dropped — a real regression class
  worth naming: a correction can delete a previously-verified fact along with
  the wrong text around it.
- **F2 CONFIRMED**, and the codex family, blind, found the same defect and rated
  it **BLOCKING**. The orchestrator takes the higher severity: a falsely
  universal claim about server behavior is the class that has blocked every
  round of this loop. v0.6 scopes D6 to fresh admissions explicitly and extends
  gate 12's re-scope clause to name D6's classification.
- **S1 applied** (the removed-function channel is now named in D6); **S2 applied**
  to gate 12's fixture-seeding sentence and carried to the follow-on Plan.


## Round 6 — 2026-08-01 (final round)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only; delta-scoped,
own-family artifact only (rounds 1–5). The reviewer confirms it did not open the
codex artifact or the journal. Per the round-5 calibration it audited the
**reachability** of every scenario the document asserts and the
**unreachability** of every scenario it excludes, not just the cited code seams.
**Instruction capsule SHA-256:** `c472e0557c65aba941485b72ad87e95721e0b1c652c1500e43f22b36856a2ff6`
**Target:** `llp/0147-compiled-microclient.rfc.md` (v0.6, 1062 lines, Draft)
**Target SHA-256:** `a8d534eab5d598a14e4c1de7ff67e2baa61f026ba2062853456499c1ba8cd8ab`
**Repo revision at review start:** `main` `67628399` (target file untracked)
**Tool uses:** 34
**Status:** completed
**Verdict:** READY

## Verbatim review

*(Recorded in condensed form: the §1 verdict, the sole finding in full, the
suggestions, and the §6 verdict and author recommendation, verbatim; the
strengths section is summarized with its verified anchors preserved.)*

**§1 Overall assessment — READY.** "All five v0.6 changes are present, and every
one is true against its referents — I verified each at the line, including the
referents no prior Fable round had anchored." The settlement-replay exception:
LLP 0043's ordering quoted fairly (`llp/0043:286-296`), the shipped lookup
precedes generation comparison and receipt creation (`src/local.rs:10933-10984`),
the exception unreachable here because the branch is gated on
`if let Some(id) = client_mutation_id.as_ref()` (`:10933`), and gate 12
re-scopes both itself and D6's classification. The rollback exit: comparison is
pure content equality with no deployment nonce (`src/local.rs:185-203`), and
retirement is gated on `activation_changed` (`src/local.rs:4855-4857`;
`src/storage/auth_mode.rs:1025-1026`), so a B→A rollback is an ordinary
activation re-admitting the predecessor's assertions. The one-fresh-subscribe
rule "matches LLP 0095 exactly, and more than matches it: T-RESYNC mandates
`→ RESYNC_PENDING → resubscribe` and adds that 'recovery is identical for every
reason and an unknown reason must not change the transition' (`llp/0095:237-241`),
so the Micro client *may not* skip the resubscribe by special-casing the reason
string." Requiring the sessions fact "breaks nothing… a sessions-composition
client against a mistargeted dev endpoint fails closed, which is the correct
direction."

Additional strengths verified fresh this round: the quiescence **timeout** path
aborts the transition via `retire_and_reopen` rather than proceeding over live
predecessors (`src/auth/admission.rs:678-689`) — "the barrier fails closed, so
even the pathological interleaving cannot overtake"; and D4's commissioned
correction target is real and truly false as written — the mutation-envelope
comment claims comparison "before any receipt/ACK or handler effect"
(`src/manifest.rs:5681-5683`), which the settlement hit violates, while the
sibling `FunctionCallRequest` comment is unconditional but true because queries
and actions have no settlement path, "so the commission is scoped exactly right."

Interleavings probed for the exclusion audit: "quiescence timeout (aborts —
fails closed), rollback-before-the-one-subscribe (subscribe succeeds; D6's 'on
its refusal' conditional handles it), byte-identical no-op redeploy (retires
nothing), activation's private projection admission… None falsifies a v0.6
claim."

**F1 — DETAIL. D6's first bullet points at the wrong bullet: "two bullets down
states why" is false — the bullet that states why is six bullets down.** "It is
a factual statement about the document's own structure, and it is wrong; a
reader following the pointer lands on an unrelated rule… but it identifies no
defective decision and touches no gate." Marked "present in v0.6, origin
undetermined," since prior versions are not in the tree to check.

**Suggestions.** S1: "cannot resnapshot while it remains stale" is outcome-true
but sits in mild tension with the mandated attempt; "cannot *complete* a
resnapshot" removes the pedantic reading. S2: LLP 0012 has subscriptions echo
the pair too, so §Live operations could say whether the subscribe acknowledgement
falls under the required-fact rule. S3: land the LLP 0012 clarification and the
`src/manifest.rs:5681-5683` comment correction in one commit, "the kind of
implementation-facing restatement that will otherwise re-seed the same defect in
a future reader."

**§6 Readiness verdict — READY.** "the factual layer of v0.6 is true everywhere
I checked, and this round checked the hard part — scenario reachability, not
just seam existence… The one finding is a broken internal pointer with a
zero-growth fix; it blocks nothing."

**Author recommendation (verbatim).** "Apply F1's one-phrase fix (and optionally
S1/S2) as editorial edits — no further review round is warranted for them — then
**accept this RFC and commission the follow-on Plan with Phase A**. At
acceptance, execute the document's own commissioned obligations as one
coordinated landing set: the dated LLP 0012 fresh-admission clarification
together with the `src/manifest.rs:5681-5683` comment correction (D4), and the
dated LLP 0114 Micro-projection amendment (D3). Do not treat gate 11a's red
status as an acceptance blocker — the RFC deliberately sequences the delta-lane
server fix into Phase B and blocks only live-selecting *graduation* on it, which
is the honest composition. Six rounds have converged: rounds 1–3 burned out the
factual defects, rounds 4–5 stress-tested and corrected the one genuinely hard
semantic rule (D6's facts classification) in both directions, and v0.6's scoping
is the fixed point — true universally within fresh admissions, with both
conforming exceptions named. The design has been thought through as far as it
can be without running code; the remaining risk is empirical (the 20/25 kB
floor, the delta-lane fix shape, Metro/Hermes parity), and the document already
routes every piece of it through a gate."

## Orchestrator verification (outside the verbatim body)

- **F1 CONFIRMED and applied** (the deployment-transition bullet is six bullets
  below, not two; the pointer is now named rather than positional). **S1
  applied** in the same phrase. **S2 and S3 carried** to the acceptance landing
  and the follow-on Plan.
- The codex family, blind, also returned READY on this revision, with one DETAIL
  of its own — the Cloudflare "and nothing else" claim, false of the all-aboard
  manifest — likewise applied. **The loop converged dual-READY on v0.6.**
