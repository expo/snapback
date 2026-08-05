# LLP 0173 review — gpt-5 family

**Target:** `llp/0173-authorization-review-projection.rfc.md`
**Reviewed revision:** `2f42d48ccd68677ee9f6f20c3e8ed90a6744a8d4`
**Capsule sha256:** `62941238b95ef8be…`
**Runner:** codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh --sandbox read-only
**Independence:** **SELF-REVIEW** — this family authored the document. Adversarial instruction applied; reduced weight.
**Topology:** independent loop

---

## Round 1 — 2026-08-04

1. **[MATERIAL] Current state; Proposal §3 — The central “already validated facts” premise is unsupported.** The appended source establishes deterministic JSON emission, transactional publication, and artifact custody. It does not establish the claimed requirement origins, stable declaration IDs, authorization-dependence dimensions, exact read/write summaries, permission-backing declarations, predicate bindings, or static effect-ceiling validation. The proposal’s cost and soundness depend on projecting existing validated facts rather than inventing new analysis. **Fix:** add a field-by-field source map naming each existing producer, schema, validator, and test. Treat any unavailable field as new semantics and define it here.

2. **[MATERIAL] Proposal §§1 and 5; Acceptance 7 — Mandatory custody has no migration path through the existing opt-in policy.** The guide says a projection is consumer-committed only when listed in `codegen.policy.json`, with a matching `.gitignore` exception. The RFC instead assumes every generated review surface contains and checks this file, without deciding how existing policies and repositories acquire that requirement. Consequently, an implementation could emit the file as ignored cache output while Acceptance 7 incorrectly assumes CI will diff it. **Fix:** specify whether the projection becomes universally mandatory or remains policy-selected. If mandatory, define the policy/schema migration, template and `.gitignore` changes, old-policy diagnostic, and compatibility tests. If optional, narrow the CI and review claims accordingly.

3. **[MATERIAL] Proposal §2; Acceptance 6 — `inputsHash` conflicts with the claimed low-noise projection.** The artifact embeds the complete generation `inputsHash`, while Acceptance 6 says a non-authorization prose-comment change does not change the artifact. If that comment is part of the hashed generation inputs, the artifact must change; if it is outside them, the test proves nothing. The RFC does not define hash normalization that resolves this. **Fix:** either accept that every generation-input change alters the projection, narrowly define which comments are excluded from the complete hash, or omit the complete hash from the projection and bind it through the manifest entry while using a semantic authorization-facts hash inside the file.

4. **[MATERIAL] Proposal §§2–3; CI semantics; Acceptance — Completeness is not an invariant.** Schema validity, hash agreement, and deterministic regeneration do not prove that every generated operation, membership declaration, or permission-backing declaration appears exactly once. A codegen omission could therefore produce a current, valid projection that hides authority from reviewers—the principal safety failure this artifact must prevent. **Fix:** require a bijection against the verified function/schema graph, reject unknown or unprojectable authorization-bearing variants, and add cross-manifest coverage tests for additions, removals, and duplicate IDs.

5. **[MATERIAL] Proposal §3 — The core predicate projection remains underdefined.** “A normalized projection” and “reports syntax and binding” do not define whether boolean structure, negation, comparator direction, constants, nesting, or repeated predicates are preserved. Two materially different HostPlans could therefore receive the same review representation while still satisfying the prose description. This is not widening classification, but it is load-bearing projection semantics deferred to implementation. **Fix:** define or normatively reference the recursive predicate schema and normalization rules, then test changes such as AND→OR, added negation, operator changes, binding changes, and argument-versus-row-field addressing.

What is good: the narrowing away from LLP 0170 §4 is honest. The RFC introduces no authorization baseline, widening partial order, waiver, or policy verdict. It also draws appropriate boundaries around opaque JavaScript, authored versus static evidence, and `authScopeField`; those choices avoid turning review metadata into a false authorization proof.

NOT READY
