# LLP 0172 review — claude family

**Target:** `llp/0172-explicit-function-authorization.rfc.md`
**Reviewed revision:** `63967ae6a759e9c9d51d03a8b7eef84d6db0252b`
**Capsule sha256:** `15b25f1650ff65f0…`
**Runner:** claude -p --model claude-opus-5 (fresh process, cwd /tmp)
**Independence:** BLIND to these bytes (a claude session authored the failed predecessor; blind here, not naive on subject matter).
**Topology:** independent loop

---

## Round 1 — 2026-08-04

## Concerns

**1. [MATERIAL] — "Verified current behavior": the load-bearing claim is unsupported by the appended source.**
The section asserts "Generated identities, public function entries, and validation diagnostics use `def.auth ?? 'optional-user'`." The appended codegen excerpt contains **no** `?? 'optional-user'` anywhere. The two sites that touch `def.auth` directly (`index.mjs:3408`, `index.mjs:3432`) read **bare** `authRequirement: def.auth`, with no fallback, and both feed hashed identity objects (`policyIdentity` → `intentPolicyHash`, `implementationIdentity` → `implementationHash`). The other two excerpts read `fn.authRequirement`, an already-normalized field whose derivation is not shown.

This matters beyond citation hygiene, because the two readings imply different migrations:
- If the fallback is applied upstream into `fn.authRequirement`, then adding explicit `auth: 'optional-user'` changes nothing hashed, and the migration is a pure review-projection change (which is what §2 assumes).
- If some emission paths write `def.auth` bare, then every migrated function's identity hash changes, which collides with `ensureApp`'s hash comparison at provisioning (per the appended guide) and with the codebase's own stated concern about hash stability (`index.mjs:3405-3407`: "Spread-when-present keeps pre-existing intent policy hashes unchanged").

*Fix:* cite the actual normalization site(s) with line numbers and show that the emitted value for an omitted `auth` is identical before and after an explicit `optional-user` edit — or, if it isn't, decide the hash-churn/re-provisioning consequence in this document.

**2. [MATERIAL] — Summary/Proposal: the default has two loci; only one is decided.**
The Summary states the default applies "in codegen **and manifest loading**." The entire Proposal, Diagnostics, and Acceptance address codegen only. Manifest loading is not in Non-goals and is never mentioned again. As written, after Phase E a manifest lacking `auth` — one generated under Phase W, produced by an older toolchain, or hand-edited — still loads and runs as `optional-user` indefinitely; Phase E blocks regeneration, not deployment (and "writes no outputs" leaves any previously generated artifact in place and usable). Either the loader default persists forever (in which case say so, and say why generation-time review is the whole claim) or it is a second, undesigned migration.

*Fix:* add an explicit sentence deciding the loader's fate — recommended: state that the loader default is retained deliberately as an artifact-compatibility rule, that it is out of scope, and that the guarantee this RFC makes is a generation/review guarantee, not a runtime one. Update the Summary so it does not name a locus it doesn't decide.

**3. [MATERIAL] — §2 / Acceptance 6: `derived` provenance is asserted, never verified.**
§2 permits `origin: "derived"` only when "a versioned constructor fixes the requirement," but nothing states how codegen *checks* that, and nothing states that a definition claiming `derived` must actually carry a requirement value. Acceptance 6 tests only the erasure direction ("mutating the emitted object to erase the owning derivation cannot fall back silently"); it does not test forgery. A hand-written definition carrying `origin: 'derived'` and no `auth` satisfies neither W nor E, keeps the legacy `optional-user`, and emits no diagnostic — a fail-open path around the entire mechanism, in the one field whose only purpose is authorization review. This is exactly the class of defect the predecessor failed on (a witness that doesn't witness).

*Fix:* decide the mechanism here, not at implementation. Either (a) codegen rejects `origin: 'derived'` unless a requirement value is also present *and* the definition carries a non-forgeable brand from a registered versioned constructor, or (b) drop `derived` entirely and require generators to emit a literal `auth` (provenance `explicit`), which costs nothing and removes the trust boundary. Add an acceptance for the forgery direction.

**4. [MATERIAL] — §1 Scope: asset intents are neither included nor excluded, and they are the only kind the appended evidence shows.**
Scope enumerates "Query, LiveQuery, Mutation, or Action." The only appended source that reads `def.auth` is the asset-intent path (`snapback.asset-intent-implementation.v1`), which is author-defined, carries an authorizer handler, carries `authRequirement`, and exhibits the identical omission-indistinguishability defect. The carve-out sentence ("Framework-owned host operations that are not application function definitions") does not obviously cover it. So the document's scope excludes — by silence — the one construct it produced evidence about.

*Fix:* name asset intents explicitly, in scope or out, with a reason. If in scope, address the `intentPolicyHash` churn (see concern 1); if out, say what makes them not application function definitions.

**5. [MATERIAL] — §1 vs §4: cron/job-only targets are compelled to make a declaration with no correct value.**
§1 requires cron- and job-targeted functions to carry a requirement. §2's table and §4 both establish that no value is correct for them: `authenticated` is invalid under system authority, and `public`/`optional-user` "does not make such an action internal-only or prevent client invocation." The rule therefore converts an ambiguous omission on a background job into a positive, client-facing claim (`auth: 'public'`) that is indistinguishable in the review projection from a genuinely public query — reintroducing, for this class, precisely the indistinguishability the RFC exists to remove. §4 acknowledges the gap and then leaves it.

*Fix:* pick one. Either (a) exclude cron/job-only targets from the rule until the internal-only authority class exists (state it as a deferred sub-case, not a silent inclusion), or (b) require the review projection to join cron/job targeting to the requirement, so `public`-because-cron is distinguishable from `public`-because-public, and add an acceptance for it. Option (b) is cheap and probably correct.

**6. [DETAIL] — Acceptance: no case asserts `derived` is silent.**
Acceptance 6 proves derivation is provable but never asserts that a correctly-derived function emits no warning in Phase W and generates in Phase E. Add that clause.

**7. [DETAIL] — §3: nothing forbids W and E in the same published closure.**
The Summary says "one published compatibility phase"; §3 only requires that both closures be recorded in the ledger. Add the constraint that E's closure must be strictly later than W's, so consumers get at least one release with the warning.

**8. [DETAIL] — Diagnostics: the repair text is wrong when the span is generated code.**
"All three valid edits" assumes the author owns the source. For a legacy-default emitted by an unupdated standard-pattern generator, the consumer cannot make that edit, and Phase E blocks their build on an upstream fix. Acceptance 9's gate covers "required demos and package consumer fixtures" — say explicitly whether that set includes every first-party standard-pattern generator, and vary the repair text when the span is generated.

**9. [DETAIL] — §1 dev-mode carve-out: the cost lands at the `dev → sessions` promotion.**
The reasoning (trusted-local, migration noise) is sound, but it concentrates the entire migration on the mode flip, which the appended guide documents as a distinct staged operation. Worth one sentence saying that is intended and fail-closed.

**10. [DETAIL] — Bulk-codemod risk.**
The behavior-preserving mechanical repair is `auth: 'optional-user'` everywhere, which yields explicit-but-unconsidered declarations. §2's requirement that provenance changes move the review projection makes a mass migration *visible in one commit*, which is a real partial mitigation — but the document should say that is the intended guardrail, and that the diagnostic ships no auto-fix.

## What is good

The narrowing is honest on the specific point flagged: `authScopeField` appears in the appended source only at `index.mjs:367` as a **disqualifier** (`!= null` → bail out of the authority-independent fast path), and this RFC nowhere depends on it or on any substitute identity witness. The Summary and Non-goals affirmatively disclaim the predecessor's overreach — `authenticated` is not claimed to scope rows or confer safety, no ownership/membership inference, no internal-only class approximated. Refusing to strengthen omissions to `authenticated` and keeping explicit `optional-user` valid is the correct call; the alternative would have been an unsound silent semantic change. Closure-based rather than date-based phasing with a promotion gate is the right shape, Phase E inheriting the existing fail-closed no-output contract is right, and Open question 2 is genuinely non-blocking. §2's decision that provenance stays out of implementation identity and out of handler-visible context, while still moving the review projection, is a clean separation.

## Assessment

Concerns 2, 3, and 5 are decisions this document should make and doesn't: one names a second enforcement locus and abandons it, one leaves an authorization-adjacent provenance claim unverified with a fail-open shape, one has Scope and §4 contradicting each other. Concern 1 means the section the review is meant to check against evidence isn't supported by the evidence supplied. These are correctable with edits, not redesign — the core proposal is sound — but they are not implementation-phase details.

NOT READY
