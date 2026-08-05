# LLP 0173 review — claude family

**Target:** `llp/0173-authorization-review-projection.rfc.md`
**Reviewed revision:** `2f42d48ccd68677ee9f6f20c3e8ed90a6744a8d4`
**Capsule sha256:** `62941238b95ef8be…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Independence:** BLIND to these bytes (a claude session authored the failed predecessor; blind here, not naive on subject matter).
**Topology:** independent loop

---

## Round 1 — 2026-08-04

# Review — LLP 0173: Authorization review projection

Reviewed against the document and the two appended excerpts only. Note on evidence: the appended source is a ~30-line excerpt showing that codegen emits `{schema,functions,contract-data}.manifest.json` plus `artifacts.json`. It shows *nothing* about auth requirements, effect ceilings, membership HostPlans, `authorizationDependence`, or `authScopeField`. So none of the "existing fact" claims in **Current state** or the §3 table are corroborated by what was provided; several concerns below turn on that.

---

## Concerns

**1. [MATERIAL] — §3 `authorizationPredicates`: the classifier is undefined, and omission is indistinguishable from absence.**
Every other row in the §3 table is labelled "Existing." This one is not: it is "a normalized projection of structured HostPlan authorization-bearing filters and membership predicates." "Authorization-bearing" is a new classification predicate over HostPlan filter nodes, and the RFC never defines it. That makes this the load-bearing new work of the RFC — not a projection of already-computed facts — and the cheapness argument in **Summary** does not cover it.

The safety consequence is concrete: if a HostPlan carries a filter construct the classifier does not recognize, the operation renders with a shorter `authorizationPredicates` list. A reviewer reading a *closed* HostPlan reasonably treats that list as complete (the document's own contrast with `opaque` invites exactly that reading). Absence then means both "no authorization predicate here" and "codegen did not understand this node" — the latter silently. That is a fail-open path in the review surface, in the one place the document claims non-opacity.

*Fix:* define the recognized node kinds as a closed enumeration in the v1 schema, and require every authorization-relevant filter node to appear with a classification — including an explicit `unclassified` entry (or a per-operation `predicateCoverage: complete | partial`) when a construct falls outside the enumeration. Add an acceptance fixture with a deliberately unrecognized filter construct asserting it renders `unclassified`/`partial`, not silence.

**2. [MATERIAL] — §4 reintroduces the rejected baseline under another name.**
**Summary** says "No baseline comparator, widening partial order, or waiver language is introduced." §5 says "The ordinary Git diff is the baseline selected by the reviewer" and that an automated gate "first needs a versioned baseline authority, a partial order for each fact class." §4 then lists, among the things the human table may render: "additions/removals relative to a caller-supplied previous projection, if a generic diff tool requests them."

That is a baseline comparator with no defined semantics — the exact defect that sank the predecessor's §4. It is undefined what makes a previous projection admissible (same `appId`? same `schemaVersion`? what if `inputsHash` is from an unrelated app?), and "additions/removals" over set-valued fields is a de facto partial order on fact classes that §5 says does not yet exist. It also violates §4's own rule two sentences later — "Human text cannot introduce a fact absent from JSON" — since add/remove is a fact about a *pair* of projections, present in neither. Nothing in **Acceptance** tests it; Acceptance 8 only forbids waivers, and Acceptance 9 only greps the table for verdict words.

*Fix:* delete the bullet. Diffing belongs to CV-14 or to the future comparator, and the RFC already says so. If it must stay, it needs its own admissibility rule and its own acceptance criteria, which would make this RFC no longer narrower than LLP 0170 §4.

**3. [MATERIAL] — §1 does not decide whether the artifact is mandatory or opt-in, so Acceptance 7 is not a guarantee.**
The appended guide is specific: `consumer-committed` means "commit only the paths listed in `committedProjections` in `snapback/codegen.policy.json`, and add matching negations to the app's `.gitignore`." It also states that Snapback's maintained demos "use this manifest-only policy," and that existing external repos are mid-migration. §1 says only "the artifact uses the existing consumer-committed custody class" and names no consumer.

So: is `authorization-review.json` emitted and committed for every app unconditionally (breaking the demos' manifest-only posture and requiring a policy + `.gitignore` edit in every existing repo), or only when an app lists it in `committedProjections`? If opt-in, Acceptance 7 ("removing, corrupting, or leaving the projection stale fails the check") holds only for apps that opted in, and an app with no projection at all is indistinguishable from an app that never had one — the reviewer guarantee the RFC exists to provide is absent exactly where nobody configured it. This is the RFC's migration/compatibility path, and it currently has no content.

*Fix:* decide it explicitly. Recommend: mandatory emission for repository-owned apps with codegen writing the `committedProjections` entry and `.gitignore` negation on first generation (or failing generation with an exact remediation, per the guide's degraded-result convention); pre-v2 external repos exempt for one release. Name the declared `consumer` for the `artifacts.json` `files` entry.

**4. [MATERIAL] — §3 `authRequirement.origin` is defined entirely by reference to LLP 0172, whose status is unstated.**
`explicit | derived | legacy-default` is one of the two headline facts of the artifact, and Acceptance 2 requires a fixture covering all three origins. If LLP 0172's provenance tracking has not landed, this RFC is not implementable and Acceptance 2 is unsatisfiable — yet the document never says whether 0172 is shipped, accepted, or in review alongside this one. "Related: LLP 0172" is not a sequencing statement.

*Fix:* state 0172's status and the sequencing constraint in one sentence. If 0172 is not yet landed, say this RFC is blocked on it; if landed, cite the field so a reviewer can check.

**5. [MATERIAL] — Acceptance 4 is vacuous as specified: read/write summaries carry no provenance field.**
§3 describes `readSetSummary`/`writeSetSummary` as "Existing **exact** dependency summaries, including mode, primary table, tables, and `authScopeField`." But **Security** says JavaScript reads and writes "retain their authored/opaque status," and Acceptance 4 requires that "JavaScript declared reads/writes never render as statically proved effects." The listed field set contains nothing that could carry a proof claim, so Acceptance 4 is trivially satisfied and tests nothing. A reader must infer authored-vs-proved by cross-referencing `runtimeClass` and `effectCeiling.basis` — an indirection the rest of the document is careful to avoid (it puts `origin` inline on `authRequirement` and `basis` inline on `effectCeiling` for exactly this reason). Separately, "exact" is the wrong word for an authored JS declaration and contradicts **Security**.

*Fix:* add `basis: static | declared` (or `authored`) to each of `readSetSummary` and `writeSetSummary`, drop "exact" from the §3 wording, and restate Acceptance 4 as an assertion over that field.

**6. [MATERIAL] — the content boundary is normative but untested, and Acceptance 1 cannot detect a violation.**
§1 requires "No timestamps, absolute paths, package-manager paths, or host-specific values"; **Security** adds no credentials, source bodies, row data, or handler args. Acceptance has no criterion for any of this. Acceptance 1 — regenerating the same app twice — is byte-identical *even if every entry embeds an absolute path*, because both runs happen at the same path on the same host. The one acceptance criterion that looks like it guards this property structurally cannot.

*Fix:* add (a) a determinism criterion across two different checkout paths (and ideally a different `HOME`/package manager root), and (b) a content assertion that the serialized bytes contain no substring of the backend root, no handler argument names, and no value matching the timestamp/absolute-path shapes.

**7. [DETAIL] — §2 `authMode` is introduced with no definition.** It appears once in the top-level shape and is never described, given a value domain, or covered by any acceptance criterion. Define its enumeration or drop it.

**8. [DETAIL] — no field-level citations for the ~10 facts asserted as "existing."** **Current state** and the §3 table carry the entire cost argument, and neither cites a manifest field name, file, or test. The appended source substantiates none of them. Cite `functions.manifest.json` field paths (as the guide's `authorities:` block does) so the next reviewer can check rather than take it.

**9. [DETAIL] — the human table can flatten predicate polarity.** §3 correctly records `operator` for `AuthUserId` comparisons in JSON, but §4 describes grouping and flagging without requiring the operator to survive into the rendered row. A negated or inequality comparison rendered as "has an `AuthUserId` filter" is the most likely way this table misleads a skimming reviewer. Require operator to be rendered, never collapsed to presence.

**10. [DETAIL] — Acceptance 9's denylist is the weaker form of the right test.** Golden-testing for absence of `safe`/`widening`/`reviewed`/`waived`/`discharged` will not catch "clean," "ok," "no issues," or a green checkmark glyph. Assert an allowlisted rendering vocabulary instead; a denylist of five words invites the sixth.

**11. [DETAIL] — staleness on a generator-only change.** §5 item 2 checks `inputsHash` agreement, but if the projection generator changes (new `schemaVersion`, new field) with app inputs unchanged, `inputsHash` still matches while the committed bytes are stale. The guide's cold-cache regenerate-and-diff should catch it via digest; confirm that, and state whether codegen version participates in the "complete inputs hash."

---

## What is good

- The custody choice is right and reuses machinery that already exists rather than inventing a parallel check: `consumer-committed` + digest + cold-cache regeneration means staleness detection is not new code, and §5's five CI semantics are correctly limited to freshness/validity rather than policy.
- The `authScopeField` treatment is the strongest part of the document. Giving it a fixed `purpose: live-invalidation-disjointness` / `authorizationProof: false` label, refusing to count it toward anything, and pinning that with Acceptance 3 (including the leaking-handler case) closes a specific and plausible misreading.
- `opaque` for JavaScript, with the explicit statement that a correct `ctx.auth.userId` filter still renders opaque, is the correct call and correctly justified — honest opacity over a promoted author assertion.
- §5's refusal to fail CI on authority change, plus the note that authenticated→public, `AuthUserId` removal, broader roles, new read tables, and static→declared are *not* interchangeable, is a genuinely useful piece of analysis and the right reason to defer the gate.
- Acceptance 6 (prose comment does not change the file) and Acceptance 8 (a test asserting no waiver shortcut exists) are both the right shape — negative criteria that constrain the implementation rather than describe it.

---

The narrowing is honest in intent and mostly in execution, and the `authScopeField`/`opaque` discipline shows the predecessor's lesson was learned. But §4's caller-supplied-previous-projection diff is the rejected baseline wearing a rendering-layer hat, `authorizationPredicates` is new analysis presented as a projection with no defined classifier and a silent-omission mode, and the emission/registration decision that determines whether the artifact's guarantee is universal is simply not made. Concerns 1–3 in particular are decisions this document should make, and each is cheap to make.

NOT READY
