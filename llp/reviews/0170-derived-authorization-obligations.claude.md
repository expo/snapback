# LLP 0170 review — claude family

**Target:** `llp/0170-derived-authorization-obligations.rfc.md`
**Reviewed revision:** `2eed016afda9b34ede4f3ecc5631e6ba1a0420f1`
**Capsule sha256:** `b77ed4910c7973d9…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Independence:** **NON-INDEPENDENT** — the claude family drafted this document. Launched with an adversarial-provenance instruction; reduced weight.
**Topology:** independent loop (not lockstep)

---

## Round 1 — 2026-08-04

## What is good

- **The central observation is right and precisely stated.** "The generator already sees the entire manifest… what is missing is the inference" is the correct framing, and it is why this is worth doing at all. The three-row table in Motivation is an honest self-assessment: two structural wins, one vigilance win, and it names the vigilance one as the gap rather than claiming credit for it.
- **Diagnostic quality is promoted to a design requirement, not an implementation note.** Making "dischargeable in one obvious edit" load-bearing, with `degraded <fn>` named as the existing precedent, is the difference between a safety feature and an authoring tax.
- **"Waiver must be cheaper than a wrong predicate but more expensive than silence"** is the correct principle. My concern below is that §2 doesn't implement it, not that it's wrong.
- **§4 (authorization surface artifact) is the strongest and cheapest piece.** Runtime-endpoint → build-artifact is a small change with a real property (authorization changes appear in a diff). It could ship alone and be worth the document.
- **Discipline about neighbours.** The non-goals correctly push maturity to LLP 0134, refusal codes to LLP 0144/0171, and predicate evaluation to LLP 0056/0100. The evidence boundary note is doing real work.

## Concerns

**1. [MATERIAL] §2 — the analysis is undefined for the inline-JS function tier, which decides whether the mechanism is buildable.**
"Codegen computes whether the operation's declared authorization constrains its result to the caller's ownership path" is tractable for declarative/IR operations, where the predicate is structure the generator can match. For an inline-JS handler that issues its own reads, deciding whether the query is caller-scoped is not decidable in general. The RFC never says which tiers the rule applies to. The two possible answers give completely different documents: if JS handlers are in scope, most of them land in **Underdetermined** and authors mass-waive, which destroys the artifact's signal; if they're out of scope, the headline claim ("an operation that returns rows a principal does not own must be constrained… or codegen refuses") is false for a whole tier, and the chess-style hole persists there.
*Fix:* decide and state it in §2. The defensible version is: the obligation applies to declarative operations; JS-tier operations are **Underdetermined by construction** and require an explicit declaration (`authz: { scopedBy: <relation> }` asserted by the author, recorded in §4) rather than a free-text waiver. That keeps the artifact honest about which discharges are checked and which are asserted.

**2. [MATERIAL] §1 — the four-form taxonomy has no discharge for role-based reads, and the repo ships a demo that needs one.**
Consider `demos/rbac`-shaped code: a table with `owner: { via: appMembers }` and an operation gated by `requireRole('admin')` that legitimately reads all rows. That predicate does not resolve to the row's ownership derivation, so §2 returns **Underdetermined**, and the only exits are a waiver or flipping the table to `unscoped`/`public`. The single most common legitimate broad-read pattern in an RBAC system is pushed into the escape hatch on day one — which is exactly the outcome §2 says is "strictly worse." This is where the n=1 evidence shows: chess has two-participant games and a clean relation; ownership-path-or-nothing fits that domain and does not obviously fit audit logs, moderation views, admin consoles, or role-gated reads.
*Fix:* add a fifth form — discharge by role predicate against the same membership relation (`owner: { via: R }` is discharged by *either* a self-scoped predicate on R *or* a `requireRole` on R at a declared role). Then re-check the taxonomy against at least one non-chess shape before Accepting.

**3. [MATERIAL] §2 + OQ5 — the waiver is unbounded, and the only thing that would make the refusal bind is left open.**
`authz: { waived: "<reason>" }` accepts any string, is never reviewed, and turns every refusal into an emit. Acceptance #6 ("CI fails on a widened surface with no corresponding waiver") means *adding a waiver is the documented way to make CI pass*. The document's primary consumer is agents (the guide context is `audience: agent-first`), and for an agent facing a generation error, `waived: "TODO"` is unambiguously the cheapest edit in the system — cheaper than reading the schema to find the relation. So the design principle in §2 is inverted in practice: waiving is cheaper than *both* a wrong predicate and silence. OQ5 asks whether a waiver should require a scoped grant (LLP 0055) — that is not an open question, it is the decision that determines whether §2 has teeth.
*Fix:* decide OQ5 in this document. Minimum viable: a waiver must name a table and an operation, must not be addable by the same edit that introduces the operation (i.e. CI fails on *new operation + new waiver* in one diff), and the waiver count is a tracked number in §4 that CI can ratchet.

**4. [MATERIAL] §1 — table-level `public`/`unscoped` silently discharge obligations for operations that do not exist yet.**
§1 argues `owner: public` must stay one word because "if the safe thing is more typing than the unsafe thing, this design fails." That principle is applied to the wrong side: `public` is the *permissive* declaration and it is now the cheapest token in the language, and it is durable — a table declared `public` in month one discharges every read operation added in month twelve, after the table's contents have changed. This is a fail-open path the RFC creates. §1 also never states how `owner: unscoped` interacts with §2's three outcomes (presumably it makes the obligation vacuous — i.e. it is a permanent table-wide waiver, strictly broader than the per-operation one, and obtained with a single string).
*Fix:* state in §2 what each `owner` form does to the three outcomes. Require §4's artifact to record table-level ownership, not just per-operation discharge, so that a `{via: R}` → `public` flip registers as a widening in Acceptance #6's CI check — as written, the artifact schema ("for every operation…") may not capture it, which would make the CI check blind to the largest possible widening.

**5. [MATERIAL] §1 — the largest breaking change in the document has no migration path.**
"Absence is not a fourth option. A table with no `owner` and at least one principal-facing read is an error" breaks every existing app on upgrade, and every table in it. §5's much smaller break gets a careful two-release `degraded`-then-error plan. §1 gets nothing. If OQ6 also resolves toward subsuming `authScopeField`, that is a third simultaneous break.
*Fix:* give §1 the same two-release shape as §5, and sequence it: §5's migration and §1's migration should not land in the same release, or authors get two unrelated generation errors from one upgrade.

**6. [MATERIAL] OQ6 — §2's definition of "Discharged" presupposes an answer to a question the document leaves open.**
§2 says discharge happens when "the operation's `authScopeField` or membership predicate resolves to `T`'s ownership derivation" — that sentence has already chosen *coexistence*. OQ6 then asks whether ownership derivation should instead *subsume* `authScopeField`, and concedes subsuming "is cleaner." An RFC cannot leave open the question whose answer it has silently assumed in its core rule. The two answers also produce different acceptance fixtures and different migrations.
*Fix:* decide it. Coexistence is the right call for this RFC (subsumption is a separate breaking change with its own migration), but say so explicitly in §2 and move OQ6 to a follow-on with that framing.

**7. [MATERIAL] Acceptance — nothing verifies the property the Motivation is about, and #2 contradicts §4.**
The motivating requirement is a runtime one: "a valid token for X must not read a game X is not in." Every acceptance criterion is generation-time. A structurally-matching predicate that is semantically wrong — the failure §2 explicitly fears — passes all seven criteria. Separately, #2 requires a discharged app to generate "byte-identically to the hand-authorized version," but §4 has codegen record *how each read discharged its obligation*; a derived discharge and a hand-authorized one should legitimately differ in that field, so #2 is either false or is quietly excluding the artifact from the comparison.
*Fix:* add a criterion that the discharged fixture, executed, denies a non-member read at runtime (this does not violate the "not runtime enforcement" non-goal — it tests that the derived obligation lands on a predicate that actually works). Rewrite #2 to name which outputs must be identical, and say the §4 artifact is expected to differ.

**8. [MATERIAL] Scope — §3 is a separate RFC and does not support the thesis.**
§1, §2, and §4 form one coherent argument: derive an obligation from the whole manifest, refuse, and make the posture reviewable. §3 (`writtenBy`) derives nothing — it is a per-column declaration, checked in isolation, opt-in, and "undeclared remains open, as today." It is therefore the same per-artifact, author-must-remember shape the document exists to move away from: the chess rating requirement is satisfied only if the author thinks to declare `writtenBy`, which is the vigilance failure mode restated one level down. It's a good feature with its own acceptance criterion (#4) and no dependency on §1/§2.
*Fix:* split §3 into its own RFC. §5 is defensible to keep bundled — it is a one-line default with a migration and it genuinely undercuts the same claim — but §3 is a third document wearing this number.

**9. [DETAIL] Motivation/§5 — the `optional-user` default is asserted with no citation.**
It is sourced entirely to one external arm reading `/inspect` "for an unrelated reason." Nothing in the document or the appended guide context confirms it, and it is the sole premise for a breaking default change across every existing app. Cite the manifest/codegen location before Accepting; if the default is already `authenticated`, §5 is vacuous.

**10. [DETAIL] §5 — "Default-deny" is a misnomer that the document's own Motivation contradicts.**
Motivation states that `auth: 'authenticated'` "reads every row of its table for every authenticated principal." §5 then proposes defaulting to exactly that and calls it default-deny. It composes correctly with §2 (the obligation rule catches the unscoped read), but the name oversells it. Call it default-authenticated and note the composition.

**11. [DETAIL] OQ2 — answerable from material already in hand.**
The appended guide states the host owns "query semi-join, denial, invalidation, and provenance," and the non-goals state the runtime is unchanged. That resolves it: discharge is a generation-time fact; resume inherits it; revocation during a live subscription is LLP 0100's invalidation, not this RFC's. State it rather than deferring to LLP 0053.

**12. [DETAIL] Acceptance #7 — vendoring an external working copy is undecided.**
The evidence boundary says the chess working copies "remain at `~/projects/chess-bakeoff/…`". Adding the app to the acceptance corpus means copying it into the repo. Say what gets vendored (schema + the two fixture operations is enough; the full app is not) and confirm the comparative build's material can be committed.

---

The core proposal is worth building, and §1/§2/§4 are the right three pieces. What blocks it is that the two questions determining whether the mechanism binds — which operation tiers it can analyze (1), and what constrains a waiver (3) — are the two the document leaves for later, and the taxonomy in §1 has a same-day counterexample in the repo's own RBAC demo (2).

NOT READY
