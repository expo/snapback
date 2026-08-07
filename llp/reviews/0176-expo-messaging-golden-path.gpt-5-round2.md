# LLP 0176-0181 review — gpt-5 family, round 2 (delta)

**Reviewed revisions (git hash-object, entering round 2 = revision 1 output):**
0176 `54d2a0ef9c4dfeb06137477b0a9105a4ce08c1d4` ·
0177 `d62f463d4ceac9dc56b9d002cf25abc490eb51e9` ·
0178 `c2a8b27aa61f02554f9e8b5ebed84ada19af48f2` ·
0179 `3daa53a22cc04a6e291fb1f6555ff46b31795ce6` ·
0180 `f9152f5b7f33c385f0e6e5cbbec3d7772cf08066` ·
0181 `6d973635b1f2ea90ba39dd633a6393d899386996`
**Prompt sha256:** `e9a05b2ba9389587769e93f47aea48c938f2344f7355f6e7c0ede3ae6b8a4706`
**Runner:** `codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh
--sandbox read-only --skip-git-repo-check -c
sandbox_workspace_write.network_access=false`, fresh process, cwd
`/private/tmp/super-refine-run-codex2b` (outside the repo)
**Independence:** structural — sandboxed read-only, capsule-only stdin,
confirmed zero tool invocations in this run's transcript
**Topology:** lockstep cluster, delta round, identical prompt bytes to the
paired claude-family round-2 run

---

## Round 2 (delta) — 2026-08-05

## RESOLVED

- **Concern 1:** The core G0 safety claim is now supported. Part D confirms that `auth.mintSession` is NonProd-only, requires the impersonation capability, requires settled Sessions mode, calls ordinary `admit_email`, and uses ordinary session-minting machinery. The proposed CLI is correctly framed as a wrapper rather than a new authority class.
- **Concern 2:** The undeclared-persona policy is no longer invented here. It is explicitly routed as an open ask to LLP 0055/0057/0058, while the baseline uses the existing raw-email admission path.
- **Concern 4:** LLP 0177 now follows SD-2's expressibility-first branches and correctly treats maintained-exact as requiring measured contention evidence.
- **Concern 6:** The direct circularity is removed: `identity.descriptor` is excluded from its own digest preimage. A new determinism problem with the replacement appears under IN-DELTA.
- **Concerns 7 and 10:** A bounded scope-record leaf has been added to the closed grammar, making record-shaped presence scopes representable in principle. Its new cardinality wording needs correction below.
- **Concern 8:** Presence publish data no longer accepts a caller-supplied identity; identity is normatively derived from the adopted session.
- **Concern 9:** LLP 0179 now explicitly states that acceptance amends LLP 0114 for `useSurface` and `useSnapbackCommand`.
- **Concern 11:** LLP 0176 now distinguishes canonical registry ownership from invocation deduplication and explicitly says a deliberate second send is a second action.
- **Concern 12:** The original conceptual gaps are addressed: `.done` has a discriminated outcome, residue has explicit provenance, and retry generations/predecessor outcomes are discussed. The newly added transition prose conflicts with the API type and with itself; see IN-DELTA.
- **Concern 13:** G2 now requires both predeclared shrinkage and preservation of retained/error/capability facts, with failure of either half halting progression.
- **Concern 15:** The bearer-placement statement is now a requirement rather than an established property, and E1 adds an explicit negative check.
- **Concern 16:** LLP 0176 and LLP 0181 now consistently require every supervised listener, including Metro, to be loopback-bound in the baseline.
- **Concern 17:** Both documents now cite the real LLP 0168 and accurately reflect its "do not build on the present record" recommendation and staged gate.
- **Concern 19:** The illustrative `satisfies AppDescriptorV1` literal includes all required top-level and nested fields.
- **Concern 20, partial:** The command input-derivation rule and S2-to-G3 gate mapping are now explicit. Expo/web package responsibilities are also separated.

## NOT RESOLVED

- **[MATERIAL] Concern 3 — the "already shipped" claims remain independently unverifiable from this capsule.** Part D establishes asset-client bearer forwarding, but it supplies none of the cited source or guide contents for the admin console, relational-query implementation status, presence-hook implementation, or optimistic mutation. The governing summaries use prospective language such as "should ship" and do not establish the asserted `shipped`, `current`, or `Implemented` statuses.
- **[MATERIAL] Concern 5 — LLP 0178's replacement mechanical example still contradicts its own rule.** The prose calls the change a harmless rename of diagnostic field-name text, but the remediation is `replaceFieldValidator`, and the diagnostic instructs the author to replace `v.array(...)` with opaque `v.json()`. Section V2 then explicitly says that workaround weakens guarantees and "is not machine-applied." Marking this remediation `machineApplicable: true` repeats the substantive contradiction in a different example.
- **[MATERIAL] Concern 14 — the `binding` override still permits an arbitrary-origin path.** Admission checks only that `descriptorIdentity` matches and `target.app` appears in generated target facts. It does not require the complete target tuple — especially `target.origin` — to equal an admitted generated target.
- **[MATERIAL] Concern 18 — source/provenance discrimination is fixed, but binding integrity is not.** The release arm permits `{ channel: "signed-artifact", signature: null }`, while acceptance says an unsigned release binding must refuse. It also permits an unsigned `embedded-at-build` arm without specifying the promised "equally reviewed build-embedding guarantee." The development arm contains only a self-asserted channel tag, while open question 1 still asks what carrier delivers the binding.
- **[DETAIL] Concern 20 — mutation-attempt allocation remains unsettled.** Open question 2 still asks whether step-4 timing is the accepted default rather than stating it as authoritative.

## IN-DELTA

- **[MATERIAL] LLP 0179 — the digest fix introduces two possible "canonical" preimages.** The document allows `identity.descriptor` to be set to a sentinel "or omitted entirely." Those are different serialized documents and can produce different digests. V1 must choose one exact representation.
- **[MATERIAL] LLP 0180 — the new retry transition contract contradicts the public API.** `retry()` is typed as `Promise<void>`, but the added transition rules require it to return a new task object with an independent `.done`. The signature should return the successor task, and every terminal predecessor outcome should settle independently of whether retry is requested.
- **[MATERIAL] LLP 0176 and LLP 0177 — revision status is internally contradictory.** Both metadata headers say `Status: Review`, but their final Status sections say "Draft" or "Draft research."
- **[DETAIL] LLP 0179 — the new scope-record admission language conflicts with its example.** "Multi-field key" vs. the one-field `typing` example.
- **[DETAIL] LLP 0176 — two qualifiers exceed the supplied host-op evidence** ("process-bound," "exact same gate" as `assets put`).
- **[DETAIL] LLP 0180 — discrimination is overstated.** A discriminated union makes `ambiguous` distinguishable from `failed`; destructuring `{ kind }` does not make conflation "syntactically impossible."

## PRE-EXISTING

None found from the supplied revision history and bytes.

```
VERDICT 0176: NOT READY
VERDICT 0177: NOT READY
VERDICT 0178: NOT READY
VERDICT 0179: NOT READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
PRE-EXISTING MATERIAL COUNT: 0
```
