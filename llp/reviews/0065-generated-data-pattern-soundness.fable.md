**Reviewer family:** Claude
**Provider / runtime:** Claude Code CLI (Fable 5)
**Date:** 2026-07-22
**Redacted:** no
**Method:** cli-runner

Review requested by the author (Charlie) as an independent cross-model-family
review before any authoring changes to the document. I read LLP 0065 in full;
the implementation candidate and its witness
(`packages/snapback-codegen/standard-patterns.mjs`, `.d.ts`, `.test.mjs`);
and the governing context: LLP 0063 Workstream 6 and its Step 5 entry-gate
text, LLP 0007 (unique-index v1 rules, deterministic ordering), LLP 0053
(`authScopeField`, convergence obligations), LLP 0056 (membership
declarations and HostPlan write refusal), and LLP 0074's boundary note. Every
corpus fact cited below was verified against the current document text, not
recalled. This artifact records the review only; it does not change the RFC's
status and must not be read as acceptance.

---

# Review: LLP 0065 — Generated data-pattern soundness and declaration floor

## Overall assessment

The core of this RFC is right, and it is the part that must not bend: the
three fact classes in §1 — schema-derived facts, explicit security
declarations that are *never* inferred, and runtime evidence that can prove
containment but never widen a ceiling — are the corpus's hard-won inference
discipline stated as a single generation rule. The deliberately narrow v1
profile (owner-scoped CRUD, unique lookup, keyset pages, all requiring an
explicit `visibility` declaration and executing the owner predicate in-plan)
makes the floor executable rather than aspirational, and the implementation
candidate matches the text closely — I verified this point-by-point rather
than taking it on faith (see "Implementation cross-check" below).

Two interactions with already-ratified authorities are unstated, and both are
load-bearing enough that I would not move this to Accepted until they are
pinned: the collision between generated self-service CRUD and
permission-backing/membership tables (C1), and the LLP 0053 convergence
obligation that attaches to every generated query carrying `authScopeField`
(C2). Both have cheap resolutions. The remaining concerns are unpinned
surfaces (list semantics), a security default left as "may" (missing versus
invisible), and small acceptance-list gaps.

## Strengths

- **§1's fact-class model is the document's spine and it is correct.** "A
  read/write set bounds database effects; it does not prove who may observe a
  row" and "an observed execution is a lower bound on effects, not a ceiling"
  are exactly the two failure modes that make ergonomic generators unsound.
  The conservative-ceiling rule for closed HostPlans, the retained explicit
  declaration for opaque code, and the runtime subset check that fails closed
  on mismatch give the boundary teeth in both directions.
- **The owner floor is enforcement, not metadata.** The generated list/get/
  lookup/page queries put `field == ctx.auth.userId` in the query plan
  itself, and the unit witness asserts precisely that (`filters.some(field ==
  ownerField, op Eq, value AuthUserId)`) alongside the explicit statement
  that `authScopeField` is carried for invalidation but "not treated as
  enforcement" — the exact separation LLP 0053 demands.
- **The transactional mutation guard is inside the shipped IR's capability.**
  `get` is a point read by id and `guard` carries an app-supplied code — per
  LLP 0056's own characterization of the v1 mutation IR — so the
  read-then-owner-guard-then-write shape in generated update/delete is built
  from ratified primitives, not a new trusted path.
- **The keyset exact-index rule is right, and the rationale is right.**
  Requiring the index to be unique with *exactly* `[visibilityField,
  cursorField]` — and the explanation that a third field can make the
  compound index unique while leaving duplicate cursors inside one owner's
  partition, where a strict continuation filter would skip rows — is the
  correct refusal, and it is unit-tested with exactly that three-field
  counterexample. Refusing to silently synthesize offset pagination is the
  right fail-closed posture.
- **The RFC leans on LLP 0007 guarantees that actually exist.** I checked
  both: LLP 0007's 2026-07-18 revision requires every unique-index key field
  to be non-optional (so generated lookup arguments derived from index fields
  cannot be optional-and-omitted), and LLP 0007 pins deterministic sort with
  an ascending `_id` tie-break on every target (so the generated list's
  non-unique default order is still a total order). Neither guarantee is
  restated wrongly here.
- **Ownership-transfer prevention is closed from every direction the v1
  surface offers**: the owner field is absent from create/update argument
  schemas (`additionalProperties: false` verified in the generated schema),
  create sets it from `ctx.auth.userId`, trusted defaults cannot name it, and
  the closed option vocabularies mean a misspelled `visiblity` fails instead
  of silently generating an unscoped operation — also unit-tested.
- **Honest Draft posture.** §5's final paragraph refuses to let the
  implementation candidate satisfy LLP 0063's Step 5 entry gate while the RFC
  is Draft, which matches the Plan's "acceptance plus executable witnesses,
  not existence" rule, and matches how the current
  `STEP5.DECLARATION_REDUCTION` artifact is actually recorded
  (candidate-pass-authority-pending).

## Concerns

**C1 — HIGH — Standard patterns on permission-backing/membership tables are
unaddressed, and the failure lands in the wrong layer.**
§1 correctly classifies "membership predicates … permission-backing tables"
as explicit security declarations. But nothing in §2–§4 stops an author from
pointing `defineOwnedCrud` at such a table, and the implementation candidate
has no check. For a *declared* `.membership()` table the system stays sound
only because LLP 0056 refuses every generic HostPlan write form targeting a
declared membership table — a typed refusal in a downstream layer, reached
after generation has already succeeded. Two problems follow. First,
authoring UX: the RFC's own §4 principle is that generation "fails before
replacing the prior output tree," yet this failure mode surfaces at
manifest/runtime instead of as a stable generation diagnostic. Second, and
more important: for a *hand-written* `permissionBacking` table (the LLP 0053
sense — LLP 0056 only says declaring both `.membership()` and hand-written
`permissionBacking` together is an error), I could not find text extending
the HostPlan write refusal. If it does not extend, generated create is a
self-service grant channel: any authenticated user can insert a row they own
(`{resource: X, role: "admin"}`, owner set to themselves) into a table whose
rows another predicate consumes as authority. That is precisely the
"authority creation from table shape" failure §1 exists to forbid — arrived
at through the generator's front door.
*Resolution:* (a) add a generation-time stable diagnostic (e.g.
`SNAPBACK_STANDARD_PATTERN_PERMISSION_BACKING_REFUSED`) refusing standard
patterns on any table carrying a membership or permission-backing
declaration; (b) state the LLP 0056 interaction explicitly in §2 or §4; (c)
add a negative acceptance case in §5; (d) confirm in one sentence whether
LLP 0056's write refusal covers hand-written `permissionBacking` tables, and
if not, treat (a) as mandatory rather than ergonomic.

**C2 — HIGH — The LLP 0053 convergence-fixture obligation attached to
`authScopeField` is missing from §5.**
Every generated live query in the candidate carries `authScopeField:
ownerField`. LLP 0053 is explicit that `authScopeField` "remains an explicit,
never-inferred disjointness claim **and a retainable query that uses it must
carry the convergence fixture**" (the L4-style assertion against a full
re-query in test/dev profiles). The acceptance list in §5 — otherwise
unusually concrete — never mentions it. If generated queries are retainable
(the CRUD list and keyset pages are the archetypal retainable reads), then
either the generator must emit or register the convergence fixture per
generated query, or generation must mark these queries non-retainable until
it does. Separately, LLP 0053 describes the shipped matcher's refinement as
"currently `userId`-only"; the generated usage compares an arbitrary
schema-field *name* against the caller's userId, which I believe is inside
that refinement's intent (the scope *value* is the auth userId), but the RFC
should say so in one sentence rather than leaving the two documents to be
reconciled by the reader.
*Resolution:* add to §5: "every generated retainable query carrying
`authScopeField` carries the LLP 0053 convergence fixture, and one acceptance
run exercises it," plus a sentence in §2 pinning that the owner profile's
`authScopeField` usage is within LLP 0053's shipped `userId`-scoped
refinement.

**C3 — MEDIUM — The list operation's semantics are unpinned in the authority
document.**
§3 specifies names, idArg collision, immutable fields, trusted defaults,
complete-field updates, and closed options — but says nothing about the
generated list: its ordering, its bound, or its truncation behavior. The
implementation candidate meanwhile has real semantics the RFC never
authorizes: `listOrder` defaulting to `_createdAt` and accepting any schema
field or any of `_id`/`_version`/`_createdAt`/`_updatedAt`; `listLimit`
defaulting to 100, bounded 1–1024; and silent truncation at the limit with no
way for a caller to distinguish "all my rows" from "the first N of my rows."
Ordering by mutable fields (`_version`, `_updatedAt`) also makes result
membership churn under the limit in ways authors may not expect.
*Resolution:* pin in §3: the admitted order fields (and whether mutable
system fields are admitted), the LLP 0007 `_id` tie-break as the totality
guarantee, the limit bound and its relationship to LLP 0007's read ceilings,
and the truncation posture — either an observable has-more signal, or an
explicit statement that completeness requires the keyset pattern and the
bounded list is a deliberate v1 semantics.

**C4 — MEDIUM — "May project them to a common refusal" leaves an existence
oracle as the default.**
Generated queries are safe by construction (the owner predicate composes into
the filter, so another owner's row and a nonexistent row are identically
absent). Generated update/delete are not: the plan reads by id with
`SNAPBACK_ROW_NOT_FOUND`, then guards with `SNAPBACK_ROW_NOT_VISIBLE` —
distinct codes, verified in the candidate. §2 says public targets "may"
collapse them and open question 4 defers the policy. As written, the
*default* is that an authenticated user probing document ids through generated
mutations learns which ids exist across all owners. For a document whose
title is "soundness … floor," the default should be the safe one.
*Resolution:* make collapse-at-public-boundary the default with explicit
per-target opt-out (answering open question 4 in the RFC body), and add a §5
acceptance case asserting what a public target actually returns for
missing-versus-invisible on every generated mutation.

**C5 — LOW — Degenerate authoring shapes deserve diagnostics, and "type must
match" is vaguer than the implementation.**
A table whose every non-owner field is immutable or update-defaulted
generates an update whose only effect is bumping trusted defaults (or a
no-op patch); a refusal or warning would serve authors better than a
silently strange operation. And §3's "their schema field type must match" is
looser than what the candidate enforces (`now` → Integer/Real; `id` →
required plain String, never Principal or a foreign-table id — the latter
correctly unit-tested as "runtime ids must not manufacture authority
principals"). The RFC should state the actual rule; it is a good rule.

**C6 — LOW — Say explicitly that cross-tenant reduces to cross-user for the
owner profile.**
LLP 0063 WS6 requires "cross-user and cross-tenant negative tests" for every
generated pattern. The owner profile has no tenant axis, so §5's cross-user
cases are the whole obligation — but the Step 5 gate reader should not have
to derive that. One sentence in §5 closes the ambiguity.

## Implementation cross-check (candidate vs. RFC text)

Verified in `standard-patterns.mjs` / `.test.mjs` against §§2–4: visibility
omission and non-owner kinds fail with the named diagnostic before output;
the owner field must be a non-optional String or Principal; all five §4
diagnostics exist and are used; names are required, identifier-checked, and
distinct; `idArg` collision with schema fields is refused; trusted defaults
are closed to `now`/`id`, cannot name the owner field, and update defaults
cannot name immutable fields; create sets the owner from `AuthUserId` and
emits `RuntimeNow`/`RuntimeId` for defaults; update/delete run get-then-guard
in-transaction before the write; unique lookup requires a declared unique
index containing the owner field and limits to one row; keyset pages require
the exact two-field unique index, a required cursor field distinct from the
owner field, and use strict `Gt`/`Lt` continuation; generated argument
schemas omit server-derived fields with `additionalProperties: false`; and
regeneration is byte-identical over the output tree. Discrepancies found:
none against the written text — the gaps above are places where the text is
silent (C1, C3) or where an obligation lives in another authority (C2).

## On the open questions

1. **Compound `(cursor, _id)` continuation** — yes, as a follow-on profile;
   keep the v1 refusal exactly as is. The v1 rule is teachable and the
   refusal message already names the fix.
2. **Public standard read patterns** — a smaller follow-on authority with its
   own existence-leak review. Do not widen this RFC; the LLP 0074 boundary
   note already establishes the pattern of separate authorities.
3. **Static analyzer for non-HostPlan ceilings** — keep the explicit-
   declaration fallback and do not gate v1 on an analyzer choice;
   undecidability handled by author declaration is already the sound answer.
4. **Collapse at the HTTP boundary** — default collapse, per-target opt-out;
   fold the answer into §2 (see C4) rather than leaving it open at
   acceptance time.

## Verdict

The design direction is sound and the fact-class discipline in §1 should be
treated as settled corpus law. The implementation candidate faithfully
implements the written text. I would not accept the RFC as written: C1 and
C2 are interactions with ratified authorities (LLP 0056, LLP 0053) that must
be stated and gated inside this document, and C3/C4 pin surfaces the
authority currently leaves to the implementation. All four have small,
local resolutions that do not change the RFC's shape. Acceptance and any
resulting Step 5 gate movement remain the author's decision; this review
does not advance either.
