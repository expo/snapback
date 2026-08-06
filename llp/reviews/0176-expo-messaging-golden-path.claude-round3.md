# LLP 0176-0181 review — claude family, round 3 (delta)

**Reviewed revisions (git hash-object, entering round 3 = revision 2 output):**
0176 `100442b85facf33722a6c0de7ee5b3958325c112` ·
0177 `caf18c25205f580f458f0488a9ac7e6c931d5c68` ·
0178 `165e1a51ecd87d514c85a917fe45c8de79dbefc9` ·
0179 `cee66ccccb0a12a1a44fb7728e2638da4a257f6f` ·
0180 `dcafac44df4cab504cf8bc568d4a8494b81b0078` ·
0181 `d6855fb7bb21502eada2f0a5b3fddf3c56d03d3d`
**Prompt sha256:** `5fcc821ed49e1d33214d09b67a922c3c16ceb313cb0b2f72277e56bd38b804c0`
**Runner:** `claude -p --model claude-opus-5 --allowedTools ""`, fresh
process, cwd `/private/tmp/super-refine-run-claude3` (outside the repo)
**Independence:** structural — no repo access, no tools, capsule-only stdin
**Topology:** lockstep cluster, delta round, capsule includes round 2's
23-item disposition ledger and Part D expanded with LLP 0057's Summary
(added specifically to let this round check round 2's DETAIL finding that
LLP 0055 was possibly the wrong routed-ask addressee)

---

## Round 3 (delta) — 2026-08-05

# DELTA REVIEW — round 3 (LLP 0176–0181)

Reviewed from the capsule bytes only. No files were read and no commands were run.

## RESOLVED

**#5 — 0179 digest preimage.** §AppDescriptor v1 now picks exactly one form: `identity.descriptor` set to the fixed empty string `""`, "not omitted, not any other placeholder," with verification recomputing that same preimage. One serialization, one digest. The ambiguity round 2 named is gone.

**#7 — 0181 "Real devices in the baseline."** The section no longer names a nonexistent union arm. It states the actual representable situation (hosted HTTPS via `source: "release"` only), explicitly declines to pre-declare E5's future arm, and its claim is checkable against the union printed two sections earlier: `supervised-dev` admits only `loopback | port-forward`.

**#8 — 0179 scope-record cardinality.** "object-keyed … regardless of whether a given collection happens to key it by one field or several — the `typing` example below has exactly one." The grammar now admits its own example.

**#9 — Status header/section sync.** 0176 header `Status: Review` / closing "Review."; 0177 header `Status: Review` / closing "Review." Both consistent.

**#10 — 0180 `retry()` signature.** `retry(): CommandTask<Result>` in the interface, with an explicit note that the synchronous return is the task object and the successor's `.done` is the promise. Matches the prose and matches how a command is started. (The prose half of #4 is also fixed; see NOT RESOLVED for its acceptance criterion.)

**#11 (main claim) — 0176 G0's two gates.** Part D confirms the text precisely: `operation_profile` maps `"auth.mintSession"` and `"asset.put"` to `NonProd` in separate arms, and `src/cli.rs` tests assert the impersonation header only for `auth.mintSession`. G0 now says exactly that and explicitly declines the "exact same gate" comparison. The narrowed claim is what the source shows. (One residual instance survives elsewhere — see NOT RESOLVED.)

**#13 — 0180 outcome/status mapping.** `succeeded → committed`, `failed → failed`, `cancelled → cancelled`, `ambiguous → ambiguous`, with the rationale for keeping two vocabularies stated. §Acceptance's "agree" now has a referent a test can assert.

**#17 — 0178 catalog citation.** Now cites LLP 0176 catalog **B3**, which is in fact the document-spread / result-contract-hashes row. Correct.

**#18 — 0180 states its own LLP 0114 amendment.** §React and surface projections carries `useSnapbackCommand`'s amendment in 0180's own voice, no longer asserted by 0179 on its behalf.

**#22 — 0180's overstated union claim.** Reworded to "does not make misuse impossible — nothing stops a caller from writing `catch { showFailed() }` … but it removes the shape that made conflation the *default*." That is what a discriminated union actually buys.

**#23 — 0180 OQ2.** Decided outright with a stated rationale and a revisit condition. (It is left in place under the `## Open questions` heading as a decided entry rather than removed and renumbered the way 0179 handled OQ3 — inconsistent housekeeping between siblings, not a defect.)

## NOT RESOLVED

**[MATERIAL] #2 — 0181 unsigned release binding still admitted by an unchanged acceptance criterion.** The type fix is real: `signed-artifact` requires a non-null `signature`. But the union now also admits `{ channel: "embedded-at-build" }` — a release binding with *no signature field at all* — while §Acceptance still reads: "A release binding's `integrity.signature` is verified before the provider adopts its `target.origin`; an unsigned or invalid release binding refuses rather than falling back to a supervised or arbitrary origin." An `embedded-at-build` binding is by construction unsigned, and the document elsewhere says it is trusted via `provenance.buildReceipt`. Concretely: an implementer reading §Acceptance refuses every `embedded-at-build` binding (making that arm dead), or reads `integrity.signature` off a value that has no such field. The same drift is in §AppBinding v1's provider rule ("the provider refuses a release binding whose signature does not verify"), which has no `embedded-at-build` branch. The contradiction round 2 found was moved, not removed.

**[MATERIAL] #4 — 0180's acceptance criterion still encodes the settlement bug the prose fixed.** §Terminal-state transitions now correctly says `.done` settles "the instant that task reaches a terminal snapshot status … independent of whether `retry()` is ever called." §Acceptance still says: "`retry()` after a terminal outcome returns a new task with an independent `.done`; the predecessor's `.done` **settles at retry time** to its own already-reached outcome rather than hanging." A test written against §Acceptance asserts settlement-at-retry — exactly the rule that leaves an un-retried failed send's `.done` unsettled forever. The acceptance bar is the shipping bar; it still says the wrong thing.

**[MATERIAL] #6 — the relational-query "already exists" citation is not supported by the evidence now supplied.** Admin console (`status: current`, `maturity: shipped`) and the optimistic-mutation files check out against Part D, and `useSnapbackPresence` is corroborated by LLP 0114's public surface list. The relational-query citation does not. 0176 G0 cites `guide/backend/relational-queries.md` as evidence of an "already-shipped" capability with "(LLP 0080, `Status: Implemented`, `relational_query_v1` stable since 2026-07-26)"; Part D shows that guide page reads `maturity: partial`, and the capsule supplies nothing establishing LLP 0080's `Status: Implemented` or the stability date. LLP 0080's own Summary in Part B points the other way — "it must be accepted and its acceptance suite must pass before generated joins or maintained projections can satisfy `STEP5.DECLARATION_REDUCTION`." This is the one claim of the four that round 2 asked to be made checkable and that, when made checkable, does not check out. If the repository does carry an `Implemented` header on LLP 0080, this capsule does not contain it.

**[DETAIL] #11 — the narrowed comparison is reasserted in G0's Exit.** After carefully splitting the two gates, G0's Exit says the mint command "still requires local operator credentials to invoke, **exactly as `assets put` does today**." Part D states explicitly that the capsule does not show whether `asset.put` carries the same header-level requirement. This is the same "exact same gate" equivalence, one paragraph later.

**[DETAIL] #14 — 0181's *acceptance* bearer-leak list is still narrower than §Provider's requirement.** E1's delivery check was widened correctly. But §Acceptance still reads "does not appear in the bundle, source maps, Metro logs, or readiness stream" — omitting `AppBinding` and persistent public configuration, two of the five locations §Provider names. It delegates ("checked, per E1"), which mitigates, but the shipping criterion still lists a subset. Separately, E1's own parenthetical miscounts: it says §Provider "only forbids the bearer appearing in the four locations above" when §Provider names five (`AppBinding`, bundle source, source maps, Metro logs, persistent public configuration).

**[DETAIL] #15 — the 0168 spike fence is cited only in part.** 0176 G5 and 0181 E5 now correctly carry the named-owner, time-box, delete-on-expiry, and `SNAPBACK_PROFILE=prod`-when-reachable-off-loopback conditions (E5 even reproduces the "not merely non-`dev`" precision). Neither carries 0168's **distribution fence**, which Part D states in the same paragraph: not enabled by default, not published as a supported path, not documented in the guide, not merged to the default branch or merged only behind a flag defaulting off. A spike run under G5/E5 as written satisfies the reachability fence and can still ship on the default branch.

**[DETAIL] #19 — one unqualified persona phrase survives.** §Risks, §What remains explicit, and OQ2 are all swept correctly ("by email today; by declared persona once that layer is accepted"). §Provider's operative sentence still reads "the supervisor supplies an ordinary bounded **dev persona**/guest session," describing today's mechanism as issuing a persona. The following paragraph qualifies it, so the damage is small, but the sweep is incomplete at the one place that states what the provider does.

## IN-DELTA

**[MATERIAL] #20 — the newly supplied LLP 0057 evidence shows the routed ask is misaddressed, and 0176's routing is unchanged.** Round 2 could not check "LLP 0055/0057/0058"; this capsule can, and the answer is worse than "possibly partial." LLP 0055's Summary says its plane boundary is explicit: the operator plane "already has carriers (the admin token, `AdminWrite`, `AdminSecretRead` leases, `ImpersonationCapability`), and **this RFC does not extend it**"; `servicePrincipal` "is *not* an operator credential." G0's persona ask is precisely an impersonation-carrier concern (`auth.mintSession` is gated on the `ImpersonationCapability` header per Part D), so 0055 disclaims it by name. LLP 0057 is closer — it owns the "operator impersonation carrier" and the passwordless email-code provider — but its Summary is equally explicit that it is an *implementing delegate*: "LLP 0039 remains **Draft / FROZEN**. This document does not amend or reinterpret it. Where 0039 pins an outcome, 0039 wins." A new "declared dev persona" contract with an admission list, TTL, revocation, and audit trail is a policy outcome, not a wire/storage/constant detail 0039 deferred — so 0057 cannot accept it either. The actual addressee, LLP 0039, is frozen and appears in neither 0176's routed list nor its `Related:` line. Concretely: the ask as written is routed to one document that disclaims the plane, one that cannot amend the frozen owner, and one (0058) whose relevance this capsule does not establish — so G1's persona layer is gated on an acceptance nobody named can grant. Revision 2 added 0057 to `Related:` and left the routing string untouched.

**[MATERIAL] #21 — the Sessions-auth-mode precondition is stated in 0176 but absent from 0181, where the automation lives.** Part D confirms the hard refusal: `auth.mintSession` returns `SNAPBACK_AUTH_POLICY_UNAVAILABLE` unless active *and* desired mode are `Sessions`, `mode_state` is `Settled`, and `app_data_availability` is `Available`. 0176 G0 now records this in prose (good), but not in G0's Exit. 0181 — whose §Provider bootstrap and E1 acceptance are the *automatic* form of the same host-op call — does not mention Sessions auth mode anywhere: not in §Provider, not in §Supervised development baseline, not in E1, not in §Acceptance. Failure scenario: a clean external fixture (E4/G4's own bar) that has not settled into Sessions mode boots `snapback dev --expo`, the bootstrap exchange's mint call refuses, and the provider reports `authority-required` — a zero-configuration path failing on an unstated precondition that no acceptance criterion in either document requires the fixture to satisfy. Leaving #21 open without carrying it into 0181 at all is worse than leaving it open in both.

**[MATERIAL] #1 — the corrected override rule makes the override's stated purpose unreachable for development.** The tightened rule is right about origins: requiring the complete `target` tuple (`app`, `schema`, `functions`, `origin`, `routing`) to equal one entry in generated target facts does close the arbitrary-URL path that app-name matching left open. But `generated target facts` is, everywhere else in this RFC, a build-time set of *declared hosted targets* (§Release binding: "an explicit build-time target name that exists in generated target facts"; selection alternatives are the EAS environment/channel default or refusal). A `supervised-dev` binding's origin is not in that set — §iOS simulator says "the binding names the **resolved** loopback origin," resolved at supervisor start, and the supervised-dev arm's `routing` values (`loopback | port-forward`) never appear in a release target fact. So no `source: "supervised-dev"` override can satisfy the rule, yet the same section presumes such overrides exist and are admitted outside a release build ("The provider also refuses a `source: "supervised-dev"` override inside a release build's production condition"), and §Provider offers the prop "for tests and advanced multi-target applications." Either generated target facts must include supervised-dev entries — which the document never says and which would require the origin to be knowable at generation time, contradicting §iOS simulator — or the test/dev use of the override prop is dead. The fix closed the hole and took the feature with it.

**[MATERIAL] #3 — 0178's replacement example is out of the RFC's scope.** The new example is genuinely zero-semantic-content as a *type* change; that half of the fix works. But its subject is `packages/snapback-react/index.d.mts` — a first-party Snapback package's hand-written declaration file — not an author's schema or functions. LLP 0178 §Design 1 defines validation as "a complete proof that the **authored artifacts** contradict current Snapback semantics," §Baseline scopes the mechanism to "authoring validation that returns `ok: false` and preserves the previous **generated output**," and §Non-goals excludes "a general JavaScript type/data-flow analyzer." Codegen does not generate `packages/snapback-react/index.d.mts`; catalog C3 is tracked as an ordinary repository ticket (`issues/20260805-react-asset-upload-task-types.md`), fixed by editing the package. As written, this diagnostic would have to fire during every user's codegen run, pointing at a file inside `node_modules`, with `machineApplicable: true` and `requiresApproval: false` — i.e. codegen auto-editing an installed dependency. Round 1's example contradicted the machine-applicability rule; round 2's contradicts the scope rule instead.

Two supporting problems in the same block: (a) the example mints a fifth check code, `SNAPBACK_AUTHORING_WEAKER_REEXPORTED_TYPE`, that has no entry in §3 Initial checks and no §4 extension-contract statement, though §4 says "every new check proposal must state" all eight items; (b) `concreteTypeSource: "@expo/snapback-client/assets.d.mts"` names a package (`@expo/snapback-client`) that appears nowhere else in the set — 0176 cites `packages/snapback-client/assets.mjs`, 0181's namespace note admits only `@expo/snapback-expo` and `@expo/snapback-react` under the Expo scope, and LLP 0041 owns `@snapback/*`.

**[DETAIL] #12 — closing 0179's OQ3 left a dangling citation and a stale deferral in 0176.** 0179 correctly closed OQ3 in the grammar bullet and renumbered; its OQ3 is now "Which non-React consumer best proves the portable descriptor…". 0176 §Product decisions still says the `assets` re-export "is LLP 0179's own **open question 3**, answered there, not asserted here" and that "this Plan's only committed decision is the two namespaces above, whichever way OQ3 resolves." The pointer now resolves to an unrelated question, and 0176 defers a decision that has been made. The sibling-set fix was applied on one side only.

**[DETAIL] #16 — the namespace note asserts LLP 0041 facts this capsule does not carry, and conflicts with LLP 0171.** The note is the right move in principle. But it states as fact that LLP 0041 "records" a public-registry collision (`@snapback/cli` occupied by an unrelated package) with `@ccheever/snapback-*` as "the current staged workaround"; LLP 0041's Summary in Part B says only "versioned `@snapback/*` packages" and mentions neither. More directly checkable: the note concludes "the published names in this document remain a proposal … not an assertion that they already exist on the registry," while LLP 0171's Summary in Part B reports "One external Chessfield build … using the **published** `@expo/snapback-*` 0.1.8 closure." 0181 lists 0171 in its own `Related:` line. Either 0171 is wrong or the hedge is; the set does not say which.

**[DETAIL] #5 — the sentinel preimage now depends on an undefined canonical serialization.** Picking the sentinel was correct, but digest equality is now entirely a function of *how* the document is serialized, and §AppDescriptor v1 only says "same serialization" without naming a canonicalization (key ordering, number/string encoding, whitespace). Two conforming implementations — the generator and a language-neutral verifier, which §Inspection explicitly invites — can serialize the same descriptor differently and compute different digests, refusing a valid binding at `descriptorIdentity` admission. Round 1's fix made this field load-bearing; round 2's fix made it the *only* variable; nothing yet pins it. 0179 OQ4 asks which identity *fields* form the tuple, not how they are encoded.

**[DETAIL] #4 — retrying a succeeded command yields `kind: "failed"`.** New in the corrected transition table: `retry()` on `succeeded` or a clean `cancelled` returns a task "whose `.done` settles immediately to a stable `failed` outcome carrying a `SNAPBACK_COMMAND_NOT_RETRYABLE` diagnostic." A caller doing exactly what this RFC asks — `const { kind } = await task.done` — reads `failed` for a command that in fact committed. That is the same class of confusion (`failed` meaning "safe to resend") that `CommandOutcome` was introduced to prevent, reintroduced at the retry seam. A distinct non-retryable outcome kind, or a refusal at the `retry()` call rather than a `failed` settlement, would avoid it.

## PRE-EXISTING

**[MATERIAL] The program depends on an LLP 0114 amendment that no gate schedules obtaining.** 0179 says "Until LLP 0114 accepts this amendment, `useSurface`'s React semantics are proposed, not settled"; 0180 now says the same for `useSnapbackCommand`. Both are honest. But LLP 0114 is an accepted Spec that, per its own Summary, "owns React composition and its public state semantics," and 0176's program treats both hooks as delivered: G2's exit is "the north-star read/mutate/presence snippet works," G3 ships the command, and §Integrated acceptance requires the surface end to end. No gate in G0–G5 contains a step for putting the amendment to LLP 0114's owner, and 0176's §Authority and document boundaries table does not list the amendment among what 0176 owns or routes. Revision 2 sharpened the statement (finding #18) without scheduling the acceptance. Concretely: G2 can report exit while the semantics its exit depends on remain formally unsettled at their real owner.

**[DETAIL] 0176 C1's server-side claim exceeds the cited excerpt.** C1 says the asset client "attaches it to every asset request the same way the client's own request lane does, **refusing a bare bearer at the server**." Part D's `assets.mjs:345-367` excerpt shows only client-side bearer selection (fence credential, else external bearer). Nothing in the capsule establishes the server-side refusal behavior, which is the load-bearing half of the claim that no second credential is needed.

**[DETAIL] 0176 G4 cites 0181 §Non-goals for a point that section does not make.** G4 says device evidence is required "because LLP 0064's own bar requires per-OS **device** evidence … (0181 §Non-goals names exactly this as a non-claim)." 0181's §Non-goals says "Claiming React Native **parity** from one simulator or Expo Go smoke test." Per LLP 0064 in Part B, `Parity` is reserved for Exact Native and a carrier without local handler execution "cannot claim `Parity`" at all — so 0181 is disclaiming something React Native could never claim, not the `Online` device-evidence bar G4 is actually invoking. The underlying requirement is correct and is directly supported by 0064's own text ("may claim `Online` when its **device evidence** proves…"); the cross-reference is the wrong support for it.

**[DETAIL] 0181 §Provider names a bootstrap channel its own open questions say is undecided.** §Provider states the session is supplied "through a transient local bootstrap exchange over the `local-supervised-ipc` channel named in `AppBindingV1`'s `integrity` field," while OQ1 asks which Expo-supported channel carries the binding and OQ2 asks "What local bootstrap exchange delivers the ordinary session." Round 1 correctly downgraded the *security property* of this exchange to a requirement; the *channel* claim was left asserted. Reusing the binding's integrity-channel label for bearer delivery also conflates two different transports under one name.

**[DETAIL] 0180 OQ3 restates a question the body answers.** §Command task states the rule: `"authoritative"` requires an LLP 0044 fact that does not yet exist, so the command reports `"inferred"` or `"unknown"` until it does. OQ3 asks the same question as open. This is structurally identical to the 0179 OQ3 defect that revision 2 fixed (#12); the sibling instance was not swept.

**[DETAIL] 0176's "Three deliberately separate action namespaces" describes two.** The heading says three; the body admits `mutations` and `commands` and defers `assets`. With 0179's OQ3 now closed "yes," the heading is accidentally correct and the body's deferral is stale — see the IN-DELTA entry for #12.

---

```
VERDICT 0176: NOT READY
VERDICT 0177: READY
VERDICT 0178: NOT READY
VERDICT 0179: READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
PRE-EXISTING MATERIAL COUNT: 1
```

Note on 0177: I found no unresolved, new, or untouched concern in it this round; its SD-2 treatment now matches Part C's actual SD-2 text, including the trigger/demand separation, and its open question 1 correctly routes the residual ambiguity to SD-2's owner.

Repository facts this capsule does not supply, which I could not check: LLP 0080's own header `Status:` value and the `relational_query_v1` stability date (bearing on #6); LLP 0041's asserted registry-collision record and `@ccheever/snapback-*` fallback (bearing on #16); LLP 0058's content (bearing on #20's third addressee); whether `generated target facts` includes supervised-dev entries (bearing on #1).
