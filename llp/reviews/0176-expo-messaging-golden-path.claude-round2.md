# LLP 0176-0181 review — claude family, round 2 (delta)

**Reviewed revisions (git hash-object, entering round 2 = revision 1 output):**
0176 `54d2a0ef9c4dfeb06137477b0a9105a4ce08c1d4` ·
0177 `d62f463d4ceac9dc56b9d002cf25abc490eb51e9` ·
0178 `c2a8b27aa61f02554f9e8b5ebed84ada19af48f2` ·
0179 `3daa53a22cc04a6e291fb1f6555ff46b31795ce6` ·
0180 `f9152f5b7f33c385f0e6e5cbbec3d7772cf08066` ·
0181 `6d973635b1f2ea90ba39dd633a6393d899386996`
**Prompt sha256:** `e9a05b2ba9389587769e93f47aea48c938f2344f7355f6e7c0ede3ae6b8a4706`
**Runner:** `claude -p --model claude-opus-5 --allowedTools ""`, fresh
process, cwd `/private/tmp/super-refine-run-claude2` (outside the repo)
**Independence:** structural — no repo access, no tools, capsule-only stdin
**Topology:** lockstep cluster, delta round (capsule includes a summary of
round 1's 20 numbered findings and asks for RESOLVED / NOT RESOLVED /
IN-DELTA / PRE-EXISTING classification against the post-revision-1 text)

---

## Round 2 (delta) — 2026-08-05

Reviewed from the capsule bytes only; no files read, no shell used.

## RESOLVED

- **#4 (0177 misread SD-2 — branch structure).** The Recommendation now mirrors SD-2's actual text from Part C: expressibility test against 3a + sequence allocation first; if expressible, no third profile; if inexpressible, contracted-aggregate with **exact-or-refuse** default; maintained-exact only "on measured contention evidence." The maintained-exact lean is explicitly relabeled a hypothesis. This tracks SD-2 clause-for-clause. (A separate new problem at the *trigger* level is filed under IN-DELTA.)
- **#5 (0178 worked example applied a machine-applicable fix to a policy choice).** The V1 optional-arg example now carries two options, both `machineApplicable: false` / `requiresApproval: true`, matching §2's prose. (The *second*, added example creates a new contradiction — see IN-DELTA.)
- **#6 (0179 circular digest).** `identity.descriptor` is now excluded from its own preimage via a fixed sentinel or omit-then-reinsert, with verification recomputing the same preimage. Satisfiable as written.
- **#7 / #10 (0179 presence example outside the closed grammar).** The grammar now admits a "bounded scope record" leaf and the example is annotated. The example is reachable through a document-defined production (with one wording caveat in IN-DELTA).
- **#8 (unauthenticated `userId` in presence).** Both 0176's north-star and 0179's `useSurface` example publish `{}`, and both state identity derives from the adopted session, never publish data. The payload shape carries no identity field at all.
- **#11 (0176 "one canonical mutation attempt").** §Integrated acceptance now says canonical ownership is about which registry a call routes through, and that a deliberate second invocation is a second product action requiring a second attempt absent caller-supplied idempotency. The conflation is gone.
- **#13 (G2 falsification checkpoint).** Now two required halves — a frozen, stated-in-advance shrinkage measure *and* fact preservation (retained/partial/error/capability facts reachable, same failure modes reproducible) — with "passing only the shrinkage half does not pass."
- **#15 (0181 "no bearer anywhere").** Downgraded explicitly to "a requirement the exchange design must satisfy," reconciled with OQ2, and E1 now greps bundle/source maps/Metro logs/readiness stream for the issued bearer. The claim and the open question no longer contradict.
- **#16 (LAN-exposure criteria disagreed).** 0176 §Integrated acceptance and 0181 E1/§Acceptance now both require *every owned listener, Metro included*, verified loopback-bound in the baseline.
- **#17 (stale LLP 0168 citation).** Both 0176 and 0181 now cite `0168-browser-carrier-dev-edge.research.md`, state the supersession and "no edge decisions survive," and restate the real posture ("do not build on the present record") with the A1–A3 open-gate / B1–B5 acceptance-gate split. Checked against Part D: accurate, including the loopback-front `dev`-profile-inference finding that 0176 §Security claims and 0181 §Physical-device relay both invoke.
- **#18 (`AppBindingV1` struct).** Now a discriminated union on `source`; `provenance` and `routing` are per-arm, so `source`/`provenance` disagreement and a supervised-dev binding claiming `routing: "https"` are both unrepresentable. `integrity` is present with distinct per-arm requirements and is verified before store preparation.
- **#19 (incomplete `satisfies` literal).** The Summary literal now supplies `format`, all four `identity` fields, all five `api` sub-records including `queryGroups`, `commands`, `surfaces`, and `capabilities.required` — complete against `AppDescriptorV1` as printed.
- **#20 partial — input-derivation rule (0180).** Stated explicitly (mutation args minus the `mutationArg` target, asset key as a distinct slot, collision refusal).
- **#20 partial — S2 gate mapping.** 0179 S2 says it is part of 0176 G3, and 0176 G3 carries the matching bullet. The mapping is now bidirectional.
- **#1 partial (mintSession is a real host-op).** Part D substantiates the load-bearing claims: `auth.mintSession` is in `HOST_OPS`, dispatched at `src/server.rs:17691-17740`, refused outside dev/demo/test, requires settled+available Sessions mode, and mints through the same `admit_email`/`coordinated_mint_session` path as an ordinary sign-in, taking `MintSessionRequest { email }` and not a persona name. 0176 G0's "thin wrapper, not a new authority class, raw-email argument shape" framing is supported. Residual attribution and precondition problems are filed below.
- **#2 partial / #3 partial.** The persona-policy ask is now explicitly routed and OQ3 restated; every "already exists" claim now carries an inline citation, and the asset-client bearer-forwarding one is independently confirmed by Part D. Residuals below.

## NOT RESOLVED

- **[MATERIAL] #14 — 0181's `binding` override still admits an arbitrary origin.** The new admission rule requires a matching `descriptorIdentity`, a `target.app` present in generated target facts, and refuses a `supervised-dev` override in a release build's production condition. Nothing in that rule constrains `target.origin`. A `source: "supervised-dev"` override in a *development* build needs only `integrity: { channel: "local-supervised-ipc" }` — no signature — so an override prop can still point a dev client at any hostname while satisfying every stated check. That is precisely what §AppBinding v1's invariant forbids ("v1 admits no arbitrary hostname or runtime URL override from application data" — a prop *is* application data). The reported fix's summary ("excluded from release builds") also overstates the text, which only excludes the dev *arm* from release production.
- **[DETAIL] #9 — the 0114 amendment is stated only in 0179, on 0180's behalf.** 0179 §React projection declares that "LLP 0180's `useSnapbackCommand` amends LLP 0114 the same way," but 0180's own §Authority and scope still claims to own "headless/React projection of the command" with no amendment language anywhere in 0180, and 0180's §React and surface projections presents `useSnapbackCommand` with no reference to 0114 ownership. An RFC cannot be amended into 0114 by a sibling document's assertion; 0180 needs its own statement.
- **[DETAIL] #1/#2 — persona language survives in 0181's normative text.** §Supervised development baseline correctly says "today by email … a declared-dev-persona layer once the routed ask is accepted," but §Provider still states the supervisor "supplies an ordinary bounded dev persona/guest session," §Risks says "The bootstrap issues an ordinary bounded session for a declared persona," OQ2 asks what channel "delivers the ordinary dev-persona session," and §What remains explicit lists "which dev personas may be issued" as an application-owner choice. Three of the four assert as present a contract 0176 G0 says does not exist and has not been accepted.

## IN-DELTA

- **[MATERIAL] 0178 §Design 2 — the newly added "genuinely mechanical" example contradicts §3 V2.** The example's prose calls it "renaming a diagnostic's field-name text," but the JSON emits `kind: "replaceFieldValidator"` with `machineApplicable: true, requiresApproval: false`, and the accompanying message tells the author to store `v.json()` instead of `v.array(...)` — i.e., it machine-applies the schema stopgap. §3 V2 says in terms: "The workaround is not machine-applied because it weakens guarantees." The fix for finding 5 reintroduced the identical defect class one example later.
- **[MATERIAL] 0180 §Command task, terminal-state transitions — `.done` settlement timing contradicts the outcome model.** The transition table says the predecessor task's `.done` "settles at the moment `retry()` is called" — but `retry()` is admitted only from states the task has *already* reached, so under the literal reading `.done` remains pending until someone calls `retry()`, meaning `await task.done` on a failed send that is never retried never settles.
- **[MATERIAL] 0177 §Recommendation and OQ1 — the workload-count reasoning reappears at SD-2's trigger.** The branch structure is fixed, but the document now claims three unrelated domains is "evidence that the trigger condition is worth acting on now." SD-2's trigger phrase is *3a has usage evidence* — evidence that snapshot-batch composition is in use — not evidence of aggregate demand.
- **[MATERIAL] 0181 §Real devices in the baseline vs. the new union.** After fix #18 there is no representable value for "an appropriately defined secure development binding" to a physical device — the discriminated-union fix orphaned this sentence's referent.
- **[DETAIL] 0176 G0 — the impersonation gate is attributed to the wrong mechanism**, and "the exact same gate `snapback assets put --user` already uses" is uncited.
- **[DETAIL] 0176 G0 / 0181 E1 — an unstated Sessions-mode precondition** on the dev-session path.
- **[DETAIL] 0176 G0 / OQ3 — the routed ask's addressee (LLP 0055) looks like the wrong or only partial owner** given LLP 0055's own summary is about agent principals, not dev-session policy.
- **[DETAIL] 0179 §Closed grammar — the scope-record admission rule's "multi-field" wording excludes the document's own single-field example.**
- **[DETAIL] 0179 §React projection vs 0176 G1/G2 — an unsequenced dependency** on LLP 0114's acceptance.
- **[DETAIL] 0176 and 0177 — header `Status: Review` contradicted the §Status prose section** (still said "Draft"/"Draft research").
- **[DETAIL] 0180 — `CommandOutcome.kind` and snapshot `status` names don't align**, with no stated mapping.
- **[DETAIL] 0181 — E1's grep is narrower than §Provider's requirement** (persistent public configuration unchecked).
- **[DETAIL] 0176 G5 / 0181 E5 — the corrected 0168 citation brings a fence neither gate carries** (the named-owner/time-box/`SNAPBACK_PROFILE=prod` spike fence).
- **[DETAIL] 0176 G0 — two "already exists" citations (0080 status, admin console) remain uncheckable from this capsule** (a capsule-completeness limitation, not necessarily a document defect).

## PRE-EXISTING

- **[MATERIAL] 0179 — the closed grammar already answers OQ3.** The `defineSurface` grammar and §React projection already normatively admit a surface-level `assets` re-export, while OQ3 still presented the question as unmade.
- **[DETAIL] 0178 §3 V3 — wrong cross-reference** ("§Issue catalog G1" should be catalog item B3).
- **[DETAIL] 0181 §Package contract — package-scope inconsistency** (`@expo/snapback-react` vs. LLP 0041's `@snapback/*`).

```
VERDICT 0176: NOT READY
VERDICT 0177: NOT READY
VERDICT 0178: NOT READY
VERDICT 0179: NOT READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
PRE-EXISTING MATERIAL COUNT: 1
```

Delta convergence: the revision closed most of round 1's list on the
merits (13 of 19 numbered findings fully, 3 partially), but four of the
fixes introduced new MATERIAL defects, and one MATERIAL concern was
genuinely pre-existing and untouched.
