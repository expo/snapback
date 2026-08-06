# LLP 0176-0181 review — gpt-5 family, round 3 (delta)

**Reviewed revisions (git hash-object, entering round 3 = revision 2 output):**
0176 `100442b85facf33722a6c0de7ee5b3958325c112` ·
0177 `caf18c25205f580f458f0488a9ac7e6c931d5c68` ·
0178 `165e1a51ecd87d514c85a917fe45c8de79dbefc9` ·
0179 `cee66ccccb0a12a1a44fb7728e2638da4a257f6f` ·
0180 `dcafac44df4cab504cf8bc568d4a8494b81b0078` ·
0181 `d6855fb7bb21502eada2f0a5b3fddf3c56d03d3d`
**Prompt sha256:** `5fcc821ed49e1d33214d09b67a922c3c16ceb313cb0b2f72277e56bd38b804c0`
**Runner:** `codex exec --model gpt-5.6-sol -c model_reasoning_effort=xhigh
--sandbox read-only --skip-git-repo-check -c
sandbox_workspace_write.network_access=false`, fresh process, cwd
`/private/tmp/super-refine-run-codex3` (outside the repo)
**Independence:** structural — sandboxed read-only, capsule-only stdin
**Topology:** lockstep cluster, delta round, identical prompt bytes to the
paired claude-family round-3 run

---

## Round 3 (delta) — 2026-08-05

## RESOLVED

- **#1 — 0181:** The override now requires exact equality of the complete target tuple, including `origin` and `routing`, against generated target facts. The arbitrary-origin path is closed.
- **#3 — 0178:** The prohibited `v.array()` → `v.json()` rewrite is gone. The replacement changes only a declared TypeScript return type, not schema, storage, plan, or runtime behavior.
- **#7 — 0181:** The physical-device baseline now matches the union: hosted HTTPS through `source: "release"` is the only current physical-device path.
- **#8 — 0179:** "Object-keyed" now correctly includes the one-field `typing` scope.
- **#9 — 0176/0177:** Header and closing status both say Review.
- **#10 — 0180:** `retry()` now synchronously returns `CommandTask<Result>`.
- **#12 — 0179:** The normative decision is now explicit: surfaces may expose a bound `assets` namespace.
- **#13 — 0180:** The fixed `status` ↔ `kind` mapping is stated explicitly.
- **#14 — 0181:** E1 now checks every location named by §Provider and separately checks the readiness stream.
- **#17 — 0178:** The cross-reference now correctly names catalog item B3.
- **#18 — 0180:** `useSnapbackCommand` now states its own proposed LLP 0114 amendment.
- **#22 — 0180:** The claim now accurately describes reduced default conflation rather than syntactic impossibility.
- **#23 — 0180:** Mutation-attempt allocation at execution step 4 is substantively decided.

## NOT RESOLVED

- [MATERIAL] **#2 — 0181 §Acceptance:** The union permits `integrity: { channel: "embedded-at-build" }` with no signature, but acceptance still unconditionally requires "a release binding's `integrity.signature`" and says an unsigned binding refuses. The acceptance criterion must explicitly admit and verify the embedded-at-build arm through `provenance.buildReceipt`.

- [MATERIAL] **#4 — 0180 §Acceptance:** The final acceptance bullet still says the predecessor's `.done` "settles at retry time." That directly preserves the obsolete rule contradicted by §Terminal-state transitions, where settlement occurs immediately upon reaching a terminal status, whether or not `retry()` is called.

- [MATERIAL] **#5 — 0179 §AppDescriptor v1:** Choosing `identity.descriptor: ""` fixes the sentinel-versus-omission ambiguity, but it still does not define the canonical byte serialization being digested. The descriptor contains object maps whose key ordering and encoding can vary between language-neutral producers. If an existing canonical serializer governs this, the capsule does not identify it.

- [MATERIAL] **#6 — 0176 G0:** Part D verifies the admin-console frontmatter and supplies evidence around the relational profile, but it contains no `useSnapbackPresence` declaration excerpt and only states that the optimistic-rebase and recipe files exist. File existence alone does not verify the claimed optimistic-mutation implementation. The advertised four-part verification is therefore incomplete.

- [DETAIL] **#11 — 0176 G0 Exit:** The main discussion correctly limits the comparison with `assets put` to the shared `NonProd` class, but the Exit still says mint requires local operator credentials "exactly as `assets put` does today." Part D expressly does not establish that `asset.put` shares `auth.mintSession`'s impersonation-capability requirement.

- [MATERIAL] **#15 — 0181 E5:** LLP 0168 authorizes the fenced spike after an RFC is opened and before acceptance, specifically to produce B1–B5 evidence. E5 instead begins "only after" the boundary is accepted and then requires implementing the admitted carrier under the delete-on-expiry spike fence. That reverses the governing sequence and conflates pre-acceptance evidence code with post-acceptance delivery.

- [DETAIL] **#16 — 0181 §Namespace note:** The note does not reconcile all capsule evidence. LLP 0171 reports a published `@expo/snapback-*` 0.1.8 closure, while 0181 says the `@expo/snapback-expo`/`@expo/snapback-react` names collectively remain proposals and do not assert registry existence. It should distinguish already-published package names from the new proposed package.

- [DETAIL] **#19 — 0181 §Provider:** The sentence saying the supervisor supplies an "ordinary bounded dev persona/guest session" remains unqualified. The next paragraph corrects it, but this sentence still presents the unaccepted persona layer as a current alternative.

## IN-DELTA

- [MATERIAL] **0177 §Recommendation:** The revision says the three domains want "a shape 3a's Non-goals already exclude." That contradicts both the immediately preceding instruction to test whether 3a plus sequence allocation expresses the shapes and SD-2's quoted expressibility-first branch. Part C attributes aggregation's Non-goal status to LLP 0080/0110, not necessarily to snapshot-batch composition 3a.

- [DETAIL] **#20 — 0176 G0/OQ3:** LLP 0057 is materially closer than LLP 0055 because it owns the local auth-provider, session, and impersonation protocol. But it also says it may not amend or reinterpret frozen LLP 0039, while LLP 0055 concerns agent principals rather than dev personas. The slash-list `0055/0057/0058` still fails to identify one owner authorized to accept the new persona policy; the capsule lacks LLP 0058's content to settle that question.

- [MATERIAL] **#21 — 0181 E1:** 0176 now states that `auth.mintSession` requires settled, available Sessions mode, but 0181's E1 still does not require or test that prerequisite. Its automatic bootstrap therefore lacks an acceptance condition for a known host-op refusal seam.

- [DETAIL] **0176 §Product decisions:** Closing 0179 OQ3 left a dangling reference: 0176 still calls the assets decision "LLP 0179's own open question 3," although that question no longer exists.

- [DETAIL] **0181 §Acceptance:** Although E1 was widened under #14, the summarized acceptance bullet again omits `AppBinding` and persistent public configuration from the bearer-negative list.

- [DETAIL] **0180 §Open questions:** The step-4 allocation decision is closed, but item 2 remains inside `## Open questions` while saying it was "removed as an open question."

- [DETAIL] **0178 §Diagnostic shape:** The replacement example's exact mechanical precondition is not independently verifiable from this capsule. No declaration excerpt establishes that the React return and `@expo/snapback-client/assets.d.mts` type are exactly the same runtime value, and the existing authoring-codegen pipeline is not shown to analyze or rewrite package declaration files.

## PRE-EXISTING

- [MATERIAL] **0180 §Command task and all north-star examples:** Operational failure, cancellation, and ambiguity resolve rather than reject, yet every showcased call merely executes `await task.done` without examining `kind`. Code following that await therefore runs after failed or ambiguous outcomes too. The claim that a caller wanting the happy path can simply await is false unless the examples inspect the outcome or a separate safe throwing helper is defined.

- [MATERIAL] **0180 §Cancellation:** Cancellation after mutation invocation may coexist with a later server commit, but `cancelled` is terminal and settles `.done` immediately to `{ kind: "cancelled" }`, which carries no mutation, ambiguity, or residue facts. The model must either keep such cancellation nonterminal/ambiguous until settlement or provide a richer outcome capable of representing the outstanding commit possibility.

- [MATERIAL] **0181 §Provider/OQ2:** The ordinary-session bootstrap channel remains an undesigned, security-critical part of the baseline. Negative greps prove only that a bearer was absent from named artifacts; they do not define IPC confidentiality, peer authentication, substitution resistance, or the local-process threat model. Naming `local-supervised-ipc` is not itself an integrity mechanism.

```text
VERDICT 0176: NOT READY
VERDICT 0177: NOT READY
VERDICT 0178: READY
VERDICT 0179: NOT READY
VERDICT 0180: NOT READY
VERDICT 0181: NOT READY
VERDICT SET: NOT READY
PRE-EXISTING MATERIAL COUNT: 3
```
