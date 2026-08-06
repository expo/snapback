# LLP 0176-0181 review — gpt-5 family

**Targets (lockstep cluster):** `llp/0176-expo-messaging-golden-path.plan.md`,
`llp/0177-chat-aggregate-and-first-related-row-demand.research.md`,
`llp/0178-generate-time-authoring-diagnostics.rfc.md`,
`llp/0179-generated-app-descriptor-and-surfaces.rfc.md`,
`llp/0180-asset-bearing-client-commands.rfc.md`,
`llp/0181-zero-configuration-expo.rfc.md`
**Reviewed revisions (git hash-object, entering round 1):**
0176 `ab06a9169e3e77ba10de4891d275ed0edc5892f9` ·
0177 `2f0cd543af76f3a52e1369868501b98e7fb419d9` ·
0178 `603d32100a331dbe131763721325315336dbb335` ·
0179 `2ca55c3cad2545b222db835b47664e7f56847575` ·
0180 `e3ab2e50adde02bdc7dc9d5b5b3a3b6fbd7351b1` ·
0181 `409ed1e3123c10e70fd887f209b8cb00cb0adaf9`
**Prompt sha256 (instructions + capsule, identical bytes both families):**
`b626ecc9859aa860b66443cba6fb8bd75494a46b8867ea82323ad0447c0e2e71`
**Runner:** `codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh
--sandbox read-only --skip-git-repo-check -c
sandbox_workspace_write.network_access=false`, fresh process, cwd
`/private/tmp/super-refine-run-codex` (outside the repo)
**Independence:** structural — sandboxed read-only, capsule-only stdin, no
target-content leak. See the paired claude-family artifact for the round-1
provenance note: an earlier attempt under this runner used its (permitted,
read-only) shell access to read this skill's own procedural definition off
disk before answering; that attempt is discarded, and this round was re-run
against a corrected prompt that explicitly forbids tool/file use. The tail
of this run's transcript confirms zero tool invocations.
**Topology:** lockstep cluster review (one capsule, all six targets, per-target
verdicts)

---

## Round 1 — 2026-08-05

## Findings

1. **[MATERIAL] LLP 0176, LLP 0181 — The development-session issuance mechanism has no owning document.**
   LLP 0176 says it owns sequencing rather than auth semantics, while LLP 0181 explicitly disclaims session/principal policy. Nevertheless, 0176 specifies `snapback session mint --dev-persona`, and 0181 automates it. Even if the bearer is an existing authority class, exposing `auth.mintSession` as a public CLI/bootstrap path is a security-relevant issuance surface. The capsule does not establish persona admission, session bounds/TTL, caller requirements, auditing, or output custody. A local process could otherwise mint an arbitrarily named persona and leak the resulting bearer.
   **Fix:** Put the primitive under an auth/host-operations owner, defining its caller gate, allowed personas, scope, lifetime, audit/redaction, and secret-delivery requirements. Make G0 depend on that accepted contract rather than defining it inside the Plan. Reword "without an admin-impersonation workaround" because the proposed path still depends on the operator/impersonation capability internally.

2. **[MATERIAL] LLP 0176, LLP 0181 — Both binding integrity and bearer-bootstrap security are load-bearing but unspecified.**
   `AppBinding.target.origin` determines where an ordinary session bearer will be sent. Yet the binding's "provenance" consists only of strings and timestamps; no authenticated delivery channel, trust root, signature, or anti-substitution mechanism is defined. Separately, the transient bearer exchange is left as an open question. A substituted development binding could redirect requests to an attacker-controlled endpoint, while an unauthenticated bootstrap seam could disclose a dev session to another process or app. Being non-secret does not make a binding integrity-insensitive.
   **Fix:** Define the development binding channel, release-binding authenticity, verifier/trust roots, redirect/origin rules, and the confidential, peer-authenticated, replay-resistant bootstrap protocol. The provider must authenticate the binding before adopting or transmitting authority. G1/E1 cannot exit until these are specified and negatively tested.

3. **[MATERIAL] LLP 0176, LLP 0181 — The LAN-exposure acceptance criteria disagree.**
   LLP 0176's integrated acceptance requires no public or LAN-reachable development edge during G1-G4. LLP 0181 proves only that the Snapback backend is not public and that no LAN relay is used; its Metro language is conditional ("where Expo permits it") and does not require Metro itself to be loopback-only. A LAN-listening Metro instance would violate 0176 even without forwarding backend routes, and could expose bundles, source maps, or bootstrap surfaces.
   **Fix:** Require E1 to bind and verify every owned listener as loopback-only, enumerate listening sockets in the receipt, and prove that neither binding nor bootstrap traffic is available through a LAN-visible Metro front. Otherwise narrow 0176's criterion explicitly and obtain the governing network-edge decision first.

4. **[MATERIAL] LLP 0176, LLP 0181 — Several "already shipped" assumptions are not grounded by the supplied governing excerpts.**
   The set treats the generated admin console, relational profile, scoped presence, optimistic mutation projection, and gated `auth.mintSession` operation as existing implementation facts. The capsule's excerpts describe intended contracts—LLP 0017 and LLP 0114 even use "should ship"—but provide no implementation or acceptance receipts. LLP 0080 says its gate requires acceptance and a passing suite, without establishing that status here. Consequently, G0's guide-only work and E1's printed admin-console command may target capabilities that have not been shown to exist.
   **Fix:** Add implementation/acceptance receipts for each claimed capability. Where unavailable, change G0 from "surface already-shipped capability" to "verify, then document or implement," and account for the resulting scope.

5. **[MATERIAL] LLP 0177, LLP 0176 — The aggregate recommendation does not follow LLP 0130 SD-2.**
   SD-2 is not a "three workloads means author an aggregate profile" threshold. It first asks whether snapshot-batch 3a plus sequence allocation express the demonstrated shapes; only an inexpressible shape selects contracted aggregation, and maintained-exact aggregates require measured contention evidence. LLP 0177 instead treats the third domain as triggering the evidence bar and leans toward maintained exact materialization without contention evidence; LLP 0176 repeats that lean. This could authorize the wrong profile and bypass the standing decision's branches.
   **Fix:** Evaluate chat against 3a's expressibility and ceilings, classify new evidence outside SD-2's existing branches as an escalation, and remove maintained-exact as a recommendation unless measured contention supports it. Require explicit message/reaction/group bounds before calling a capped profile viable.

6. **[MATERIAL] LLP 0177 — Its central self-relation baseline is not independently supported by the capsule.**
   The document says exact repository locations reject same-table relations, but those source excerpts or tests are not included. LLP 0080's supplied text excludes several join forms but does not expressly say that root and joined aliases may not name the same table. Thus the assertion that the "factual question is closed" cannot be verified from the review material. If the assertion is wrong, the proposed new LLP 0080 work is unnecessary or mis-scoped.
   **Fix:** Include a governing excerpt or acceptance-test receipt proving generated and runtime refusal, or soften the conclusion to an unverified repository claim pending that receipt.

7. **[MATERIAL] LLP 0178 — The remediation example contradicts its own safety rule.**
   The example is the optional-argument policy choice, yet it supplies `replaceDeclaration` with `machineApplicable: true` and `requiresApproval: false`. The following prose correctly says that making an argument required versus introducing missing-value handling is a policy choice that must not receive a guessed automatic patch. An implementation following the example could silently narrow a public call contract.
   **Fix:** Make that remediation non-machine-applicable and approval-requiring, present the competing repairs explicitly, or replace the example with a genuinely mechanical correction.

8. **[MATERIAL] LLP 0179 — `AppDescriptor` identity is circular as specified.**
   The portable document contains `identity.descriptor`, while the text says the descriptor digest covers all portable fields. That requires hashing a value that contains its own hash, so generation and verification cannot deterministically implement the stated identity rule.
   **Fix:** Define a canonical digest preimage that excludes or normalizes `identity.descriptor`, or put the digest in an external envelope. Specify canonical encoding and verification.

9. **[MATERIAL] LLP 0179, LLP 0180 — React ownership overlaps the supplied governing Spec.**
   LLP 0114 expressly owns React composition and public state semantics. LLP 0179 claims ownership of the React `useSurface` projection and its public state namespaces, while LLP 0180 claims the React command projection and `useSnapbackCommand`. Neither declares an amendment to LLP 0114. Independent implementations could therefore create competing retained/error, lifecycle, or cleanup semantics.
   **Fix:** Keep these RFCs authoritative for framework-neutral descriptor/task semantics, and amend LLP 0114 to own the hooks and React state projections—or explicitly make these RFCs accepted amendments with a single reconciled authority table.

10. **[MATERIAL] LLP 0179 — The normative surface example is not expressible by the stated closed grammar.**
    Bindings are limited to `param`, `input`, or portable literal facts, but the presence example constructs `scope: { conversationId: param(...) }`. That object is neither a literal nor one of the admitted binding leaves. A conforming generator could not build the north-star conversation surface.
    **Fix:** Admit a bounded portable record-construction node with precise typing/depth limits, or change the ephemeral reference so `conversationId` can be bound directly.

11. **[MATERIAL] LLP 0176, LLP 0179 — The north-star presence payload permits an unestablished identity assertion.**
    The example publishes `{ userId }` from application code while the design says application data cannot bind a principal. The capsule provides no ephemeral-owner rule proving that this field is ignored, overwritten, or authorized. If consumers treat it as the typing member's identity, a caller can claim another user is typing.
    **Fix:** Derive actor identity from the adopted session and omit it from application-supplied payloads, or explicitly define `userId` as non-authoritative data with server validation and a distinct authority-derived member identity.

12. **[MATERIAL] LLP 0176, LLP 0179, LLP 0180 — Canonical ownership is conflated with coalescing side-effect invocations.**
    LLP 0176 requires "one canonical ... mutation attempt and asset task for equivalent low-level and surface calls," and LLP 0179 uses similar no-duplicate language. Queries and presence leases can share canonical resources, but two independently invoked sends with equal arguments are normally distinct product actions. Literal deduplication could drop a deliberate second message; independently allocating attempts is not a second state owner.
    **Fix:** State that all projections use the same canonical registries and identity allocator, while each explicit mutation/command invocation gets a distinct attempt unless the caller supplies the same idempotency identity.

13. **[MATERIAL] LLP 0176, LLP 0180 — The command's core state machine remains unresolved.**
    Several acceptance claims cannot yet be implemented coherently:

    - Exactly-once retry depends on mutation identity, but the allocation rule remains an open question and the supplied LLP 0114 excerpt does not establish the claimed ambiguity/settlement facility.
    - `ambiguous` is presented among terminal snapshots even though it may later become success or refusal.
    - A task may be `failed` and then retried, but the RFC does not say whether the original `.done` remains rejected, is replaced, or stays pending.
    - Acceptance requires "finalized-unattached" residue while the RFC openly questions whether global unattached status is authoritative. A failed mutation proves only that this mutation did not attach the asset, not necessarily that no attachment exists.

    **Fix:** Provide a transition table defining recoverable versus terminal states, retry generations, `.done` semantics, mutation-attempt allocation/reuse, and authority replacement. Represent residue as `not-attached-by-this-mutation`, `globally-unattached` only with an LLP 0044 fact, or `unknown/inferred` with provenance. Align G3's wording accordingly.

14. **[MATERIAL] LLP 0176 — G2's falsification gate has no pass/fail rule.**
    The checkpoint names measurements but requires only a "visible" or "measurable" reduction, while an open question still asks which metric is stable. A trivial one-line reduction—or moving ceremony into declarations—could satisfy the gate and permit G3 despite no meaningful improvement.
    **Fix:** Before implementation, freeze the baseline, counted file boundaries, treatment of generated/declarative code, and minimum success thresholds for at least one primary metric plus no-regression criteria for lifecycle and diagnostic facts.

15. **[DETAIL] LLP 0181 — `AppBindingV1` does not encode its intended source/provenance pairing.**
    The interface permits `source: "supervised-dev"` with release provenance and vice versa, although prose says they are coupled. Make the entire binding a discriminated union; admission checks should remain defense in depth.

16. **[DETAIL] LLP 0176, LLP 0179, LLP 0180 — "Ship in lockstep" is imprecise.**
    LLP 0179's S0/S1 intentionally land in G1/G2 before LLP 0180's command work in G3. Clarify that only the command-schema integration and command implementation ship together, not the complete RFCs.

17. **[DETAIL] LLP 0176, LLP 0181 — LLP 0168 attribution is unverifiable here.**
    Its excerpt is explicitly unavailable, so claims about what it already governs cannot be checked. The set's decision to fail closed and defer the LAN carrier is nevertheless conservative.

## What is good

The set has a strong overall decomposition: stable `AppDescriptor`, environment-specific `AppBinding`, and separate mutation/command/asset namespaces avoid several misleading abstractions. LLP 0180 is unusually honest about non-atomicity, residue, ambiguity, and the limits of online-only execution. LLP 0178's validation-versus-advisory distinction is sound apart from its contradictory remediation example. The per-OS evidence requirement, external published-package proof, early surface bakeoff, and refusal to smuggle LAN relay, offline custody, attempt grants, or aggregation into the critical path are also good decisions.

```
VERDICT 0176: NOT READY
VERDICT 0177: NOT READY
VERDICT 0178: NOT READY
VERDICT 0179: NOT READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
```
