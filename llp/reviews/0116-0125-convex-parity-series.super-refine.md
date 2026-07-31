# Convex-parity research series (LLP 0116–0125) review program journal

## Authorization

Charlie Cheever approved the tiered review program on 2026-07-30 and set
the READY bar:

> The READY bar I'm looking for is something like "We've really thought
> this issue and concept through as much as we can without writing code
> and running it to gather empirical evidence" as much as "there are no
> flaws in this."

Approved topology, per the author's message:

- **Full super-refine (multi-round, dual-family):** LLP 0122, 0123, 0117,
  0118 — they feed Tranche A (P0) and Tranche B's lead item; 0118
  additionally underwrites reviving a design that previously died in a
  review timeout.
- **Single-round dual-family pass:** LLP 0119, 0120, 0121, 0124, 0125 —
  one Fable + one Codex review each, verified fixes applied, no loop.
- **LLP 0116 last, delta-review only** — it is derivative; reviewed after
  sibling corrections propagate, using the delta-review stopping rule.

Starting the loop advanced the nine target Research docs (0117–0125) from
Draft to Review under that program approval. LLP 0116 stays Draft until
its delta review. The loop cannot advance any target beyond Review; all
status adjudication after the loop is the author's.

Reviewer configuration: Fable reviews come from fresh non-author Claude
(Fable 5) subagent contexts — the orchestrating session authored the
series via subagents and therefore does not count itself as a reviewer.
Codex reviews run via codex-cli 0.146.0 `codex exec` in a read-only
sandbox. Reviewers are mutually blind: neither reads any
`llp/reviews/` artifact for LLPs 0116–0125 nor any other reviewer's
output.

## Round 1 — 2026-07-30

Scope: all nine topic docs (Tier 1 round 1 of N; Tier 2 round 1 of 1).

Instruction capsule SHA-256 (shared verbatim by both families):
`30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`

Target SHA-256 vector (post-Review-status content, the text reviewers
read):

- LLP 0117:
  `72f18aebddeb24644938241533aaf60134e267b76af34bd8fef4dc0a62b1658a`
- LLP 0118:
  `3e1e2ce6951490156dafca4ae8bf6034a6f70c78762b6dc8bb806b0aff625d97`
- LLP 0119:
  `0afa360ef52e3b598c141efa77a055e7d3d3948a5162644bc8aaaee5a7340305`
- LLP 0120:
  `43bdb65cc7b7a411bf3db4c06f7ea5b20aa2b2f5793deb2ff4ed650efa14e82c`
- LLP 0121:
  `9dfa1164eafb71f49694e24629b34886f8cf48c4d6216ec48a5d8e6f0c3aa985`
- LLP 0122:
  `c41f584d37139c5d8544fd4a2cf1b3a75f1fe5317b99f35abf1cbecdc48bb815`
- LLP 0123:
  `b5cde08b1a1a33551c5f2d6f2bfde7624b824b88c134938cc6efa793730213e5`
- LLP 0124:
  `19348a3dbf8bb0d0d4bdd519490050dd0b51027b1377bf10354382849a1ab3ac`
- LLP 0125:
  `9161587d13febe4f5e156a32c438c810fa44ad2a43ea9d223230fb5d0cff2942`

Verdicts and dispositions are appended below as reviews are actually
received; no review is recorded by intent.

### Round 1 results

All eighteen reviews were received (nine Fable, nine Codex; artifacts in
this directory). Verdicts: **Codex 0/9 READY; Fable 1/9 READY**
(LLP 0121). Every NOT READY was narrow and resolvable within the bar.

Nine verify-then-fix passes applied the findings; across roughly 120
enumerated concerns, **none was refuted by verification** — every
challenged claim that was checked against the tree or diaries confirmed
the reviewer. Two reviewer paraphrases were themselves corrected during
verification (Codex's three-way Convex cancellation rule is two-case;
minor diary line-number drift in the 0124 review). Each target is now
v0.2 with a house-style Revised note naming its two review artifacts.

Notable resolutions decided by verification:

- **LLP 0119:** the `HandlerPlan::SearchQuery` live-matcher arm is
  unreachable through any valid subscription (manifest admits SearchQuery
  only under `Query`; subscription requires `LiveQuery`), so "coarse live
  search is mostly composition" was downgraded from finding to hypothesis
  with an integration-blockers inventory.
- **LLP 0118:** the Option-1 cost model rested on the retired warm-pool
  lifecycle (`WarmVmPool` ships as a no-op); under fresh-per-invocation,
  splice dominates group-bundle, and a same-file sharing option (1a) now
  precedes the emission question.
- **LLP 0123:** the "live paths never touch the VM" claim was false (JS
  live queries reach `RuntimeGuard::create()`); two shipped-but-unnamed
  options were added (Ibex's content-addressed dynamic linking; a
  server-side boot-qualification lane).
- **LLP 0117:** the CV-5 board mapping was honored by adding the typed
  search-AST analysis to 0117 as a structured-input instance; the
  TypeScript-baseline description was corrected (toolchain exists; the
  gap is the untyped handler interior).
- **LLP 0125:** the "fix held in the rerun" sentence cited a concurrency
  check that never ran; restated in absence-of-regression form.

Tier-2 documents (0119, 0120, 0121, 0124, 0125) have completed their
approved single round; their reviewers' recommended next steps are
recorded in the artifacts for the author's status adjudication.

## Round 2 — 2026-07-30 (Tier 1 delta)

Scope: 0117, 0118, 0122, 0123. Same-family delta reviews under the
delta-review stopping rule: verify round-1 concerns resolved, review new
text, do not re-litigate settled text.

Delta instruction capsule SHA-256:
`33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`

Target SHA-256 vector (v0.2 content):

- LLP 0117:
  `f9a06a39126a6a37ee8c08d619daa13a1161a37bdda843081a1c49fe8d37d06e`
- LLP 0118:
  `3d2ad2b7d7153eb90115d33508454bbe3adf0835101dc1aecf465365a4092e4e`
- LLP 0122:
  `27390c8950fd22ca209a714a472da9159311b9868ad9362f4f2e37a1e66afec9`
- LLP 0123:
  `5724a474fcc22586eca5d16dda3a68340394a78a4d38bcb19236725c687a7192`

### Round 2 results

All eight delta reviews received. Verdicts: **Fable READY on 0117, 0118,
0123**; Fable NOT READY on 0122 by "the thinnest margin" (two one-line
delta defects); **Codex NOT READY on all four** — but with round-1
concerns resolved or partially resolved across the board; every
remaining Codex item is scoped to text the v0.2 fixes added. Notable
new catches, all verified during the v0.3 fix passes:

- **LLP 0123:** the proposed boot-qualification probe would consume the
  one-shot strict Host handoff (`Host::strict()` installs once behind a
  `Once`; `ex_hermes_create_no_eval()` claims the pending context; later
  constructions fall back to `SecurityMode::Audit`) — readiness evidence
  that weakens the security posture it verifies. Option 2 now carries
  the hazard, four mitigation shapes, and a corrected evidence
  classification.
- **LLP 0122:** the Option 7 rename paths are not mechanical — the
  publication authority is name-bound at three verified boundaries
  (protocol name table + regex, exact-name schema consts, cold-install
  scope preset); a scope change is a proof-system migration and is now
  priced as one.
- **LLP 0118:** the helper-class axis's "pure = no ctx parameter" was
  not capability closure (aliased capability args leak); purity is now
  flow-defined, and table-level caller ceilings are honestly costed as
  a NEW enforcement mechanism (three enforcement facts code-verified).
- **LLP 0117:** the CV-5 carrier inventory grew to four (the client
  package's own typings), `argsContractHash` is an identity witness not
  a payload slot, and Option F's `.ts`-imports carrier is not viable on
  today's closed-script surface.

v0.3 fix passes applied on all four targets; no reviewer finding was
refuted in this round either.

## Round 3 — 2026-07-30 (Tier 1, narrow)

Scope, per the reviewers' own recommendations: **Codex-only narrow delta
checks** on 0117, 0118, 0122, 0123 (verify the v0.3 fixes to the
round-2 concerns only), plus a **Fable fix-verification** on 0122's two
one-line corrections. Fable is READY on 0117/0118/0123 and is not
re-polled there.

Target SHA-256 vector (v0.3 content):

- LLP 0117:
  `3abab2cfc974c008184e41d736dd8dc47bfeb90ea0fb3e0df3ef4d91841771e1`
- LLP 0118:
  `925535603827afcc6510bcdd03be7c0448cb1189053a2f0e5fb72b1f69044c35`
- LLP 0122:
  `185be0b16c4d3e2b409d3e848fafd2152d8b58e842531c9e7b59f52c18316219`
- LLP 0123:
  `0048c61975114d847f9823d9e17908327dcb4392ffbdcfb16274dab63f47238e`

### Round 3 results

- **LLP 0117 — CONVERGED dual-READY.** Codex R3 READY: both round-2
  MATERIAL items resolved (four-carrier inventory; `argsContractHash` as
  identity witness; carrier 3 not viable on today's closed-script
  surface); no new concerns. Fable was READY at round 2.
- **LLP 0122 — CONVERGED dual-READY.** Codex R3 READY (rename honestly
  priced as a proof-system migration; admin-client boundary corrected;
  Probe 8 added). Fable R3 fix-verification READY (both one-liners
  verified against the current tree).
- **LLP 0123 — CONVERGED dual-READY.** Codex R3 READY: strict-Host
  hazard accurately carried with four mitigation shapes and corrected
  evidence classification; Option 4 relabeled; refusal-transport cost
  honest; Workerd inventory routed to LLP 0048. Fable was READY at
  round 2.
- **LLP 0118 — continued.** Codex R3 NOT READY on one fresh item: the
  v0.3 "flow-pure" taint roots omitted ambient nondeterminism
  (`Date.now()`/`Math.random()` pass the gate but are not pure for
  action consumers).

## Rounds 4–5 — 2026-07-30 (LLP 0118 tail)

- **v0.4** (target `4cef15838dd91c5bda7aa46b3fb4eb578582b0a270c9adc302471a9f3c3e63ea`):
  lane renamed **context-capability-free**; the tiered ambient surface
  code-verified (deterministic tier runtime-denies the ambient members;
  actions deliberately retain them). Codex R4: item partially resolved;
  one new BLOCKING (v0.4 sentences still equated the two established
  properties with semantic purity — side effects not ruled out) plus a
  DETAIL (bare `Date()` spelling missing from the accounting).
- **v0.5** (target `a9a883ac8d020578e8fe18d7dc50b4b643ad84e6923769d474a616028774f15d`):
  claim narrowed to exactly two established properties with
  side-effect-freedom named as a third requiring its own analysis; the
  `Date()` accounting made code-exact (static refusals vs the
  deterministic-tier `DATE_CONSTRUCTOR_DENY_SOURCE` wrapper; aliases
  fall through by design). **Codex R5 READY — LLP 0118 CONVERGED
  dual-READY** (Fable READY since round 2).

### Tier-1 convergence summary

| Doc | Fable | Codex | Rounds to converge |
| --- | --- | --- | --- |
| 0117 | READY (R2) | READY (R3) | 3 |
| 0118 | READY (R2) | READY (R5) | 5 |
| 0122 | READY (R3 fix-verify) | READY (R3) | 3 |
| 0123 | READY (R2) | READY (R3) | 3 |

No reviewer finding was refuted by verification in any round of the
program.

## LLP 0116 delta review — 2026-07-30

Per the approved program, the overview reviews last. 0116 was refreshed
to v0.2 against the reviewed sibling texts (headlines trued up; new
cross-cutting finding 7 records the program itself; OQ1 answered;
Status → Review). One review per family, delta/synthesis scope:
verify the overview accurately represents the reviewed siblings and the
program record; reviewers may read the siblings, their Revised headers,
and this journal, but not the other family's 0116 artifact.

Target SHA-256 (v0.2): recorded with the review artifacts.

### LLP 0116 results

Round 1: Codex NOT READY (two MATERIAL sentence-level items, all nine
index headlines verified accurate); Fable NOT READY by the thinnest
margin (two factual one-liners in the Summary; the synthesis verified
faithful). The Fable review was interrupted mid-round by a usage-credits
outage and resumed in the same context after the author topped up; the
artifact's Method line records this. v0.3 applied the merged eight-item
fix list — including one correction to the Fable reviewer's own
paraphrase (LLP 0125 pins the bakeoffs' `convex` 1.42.x package version;
only 0121/0124 carry review-added dated docs pins), which the reviewer
then confirmed correct. Round 2 fix-verifications: **Fable READY, Codex
READY — LLP 0116 CONVERGED dual-READY** (target
`37a5c1cc9724177ca17d9a0ee4f9a999732a0680b9557c9b15cc939b85850650`).

## Program conclusion — 2026-07-30

All ten documents converged dual-family READY against the author's bar:

| Doc | Final version | Fable | Codex | Rounds |
| --- | --- | --- | --- | --- |
| 0116 | v0.3 | READY (R2 fix-verify) | READY (R2 fix-verify) | 2 |
| 0117 | v0.3 | READY (R2) | READY (R3) | 3 |
| 0118 | v0.5 | READY (R2) | READY (R5) | 5 |
| 0119 | v0.2 | single round + fixes | single round + fixes | 1 |
| 0120 | v0.2 | single round + fixes | single round + fixes | 1 |
| 0121 | v0.2 | READY (R1) + fixes | single round + fixes | 1 |
| 0122 | v0.3 | READY (R3 fix-verify) | READY (R3) | 3 |
| 0123 | v0.3 | READY (R2) | READY (R3) | 3 |
| 0124 | v0.2 | single round + fixes | single round + fixes | 1 |
| 0125 | v0.2 | single round + fixes | single round + fixes | 1 |

Across the whole program (roughly 150 enumerated findings over 33
reviews and 16 fix passes), no reviewer finding was refuted by
verification; three reviewer paraphrases were corrected during fix
application, each confirmed by the paraphrase's own family afterward.

Per LLP 0005 the loop proposes and the author decides: the proposed
transition is Review → Active for all ten documents (Research-type
terminal healthy status), with the Tier-2 documents' reviewers'
recommended next steps recorded in their artifacts for the author's
weighing. Residuals outside this program's scope: the LLP 0108
Campfire→Relay misattribution correction (0108 ~line 793, deferred to
its next revision), LLP 0115's author-gated OQ3–OQ7, and the named
empirical agendas inside the series documents.
