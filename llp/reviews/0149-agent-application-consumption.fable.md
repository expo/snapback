# LLP 0149 agent application consumption review — Fable family

## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** fresh non-author subagent context, read-only review of the working
tree; mutually blind — instructed not to read any `llp/reviews/` artifact
concerning LLP 0149, blind to this document's codex artifact and the
super-refine journal. SHA-pinned target and instruction capsule. No tests
executed; every anchor read directly. HTML entity escapes (`&lt;`/`&gt;`)
introduced by transport were de-escaped when recording; no other edits.
**Instruction capsule SHA-256:** `906c85005b80ec976da4a90f8e4856051eedc58498a6242b4c0543020c05708c`
**Target:** `llp/0149-agent-application-consumption.research.md` (725 lines, Draft Research, untracked)
**Target SHA-256:** `870ae34e02fe477f327c2e46c219cc85ad5ab904c00808dc27d0bdba1513cbe2`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 46
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review: LLP 0149 — Agent-native application consumption (Research, Draft)

**Reviewer:** Fable family, independent context, round 1
**Target:** `llp/0149-agent-application-consumption.research.md` (725 lines)
**SHA-256 verified:** `870ae34e02fe477f327c2e46c219cc85ad5ab904c00808dc27d0bdba1513cbe2` — match. Repo at `main` `67628399`.
**Blindness clause honored:** no file under `llp/reviews/` was read, listed, or grepped at any point in this review — all directory listings were of `llp/` root filtered to specific non-0149 document numbers, and every grep targeted named LLP files or source trees outside `llp/reviews/`. No 0149 super-refine journal or other-family artifact was consumed.

## 1. Overall assessment

**Verdict: NOT READY — by a narrow margin.**

The base Research (Summary through Status) survived claim-by-claim verification essentially unscathed: every row of the "Existing authority" table, every LLP 0062 future-work attribution, the LLP 0146 decision/deferral labels, the LLP 0043 settlement machinery, and the LLP 0024 catalog fields all match the referenced documents as they exist in the tree today, and the dry-run and per-kind-outcome claims are true in the code, not just the specs. The direction (descriptor + journal first, plan tokens later, sessions last) is internally consistent across Findings, Recommended direction, build sequence, and What-not-to-build.

What blocks READY is the second-model assessment section, which contains two MATERIAL overstatements in its evidentiary claims: A4's write-authority derivation premise miscites LLP 0053 and asserts a derivation the current authorization model does not support at the cited altitude, and the Concurrence's "carries most of the static descriptor" overstates what the generated catalog holds (in spec, and more so in code). Both are one-to-three-sentence fixes that change no recommendation, which is why the margin is narrow. Per the capsule's instruction, I note these defects are in my own family's section; that made them the first place I looked hardest.

## 2. Strengths

1. **The overlap survey is accurate, row by row** (§Method and overlap survey, lines 102–114). Verified-against-source: LLP 0010's stable-code/no-log-scraping discipline (`llp/0010-agent-dx-and-acceptance.spec.md:80,331`); LLP 0024's catalog fields exactly as listed — toolName/functionId, input/output schema, kind, requiredCapabilities, authorityRequired, dryRunSupported, sourceSpan, bundleHash (`llp/0024-agent-operating-surface.spec.md:447-462`); LLP 0043/0133's clientMutationId, exactly-once replay, ACK lifecycle, receipts (`llp/0043-offline-replay-retention.rfc.md:38,199-254`; `llp/0133-local-settlement.spec.md:73-90`); LLP 0055's scoped, TTL'd, fenced-revocation grants and durable authority descriptors (`llp/0055-agent-principals-and-scoped-grants.rfc.md:221-222,393-395`); LLP 0061's manifest/capability-index/intent-aliases/served-pages/MCP-resources (`llp/0061-agent-first-snapback-guide.rfc.md:8,363-369`); LLP 0146's D1–D7 and its C9/C10/C11 deferrals (`llp/0146-agentic-authoring-affordances.rfc.md:186-201,970-1021`); LLP 0147's Micro profile, exact wrappers, minimal transport, honest ambiguous outcomes (`llp/0147-compiled-microclient.rfc.md:51-76,198-207`).
2. **Every claimed LLP 0062 future-work item is real** — journal/`resolve` (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1512-1515`), transcripts and `run --replay` (`:1527-1533`), lock file (`:1534-1536`), `call --output <file>` (`:1509-1511`), `introspect --changed-since <envelopeHash>` (`:1520-1521`), app-function MCP projection (`:1555-1557`), and the token broker (`:1537-1540`). The document's central strategy — promote work the corpus already names, rather than mint new surface — is verified, not asserted. Verified-against-source.
3. **F5's per-kind reconciliation posture matches LLP 0062 exactly**: durable `clientMutationId` persisted before dispatch, replay bound to authority/generation with local re-attestation, engine never auto-retries writes, actions report terminal `outcome: "unknown"` with a retry prohibition (`llp/0062:429-452`). Verified-against-source.
4. **F4's foundation claim is true in code, not just spec**: `dry_run_mutation` executes "through the SAME tier path as a commit — the IR step loop or the real Ibex handler over the buffered ctx — and discard[s] the writes" (`src/local.rs:11818-11829`), and nothing binds a dry-run to a later invocation — the gap F4 names is real. Verified-against-source.
5. **What-not-to-build is faithful to its sources**: no universal continuation tokens / no token-count guarantee mirrors LLP 0146 Declined 4 and its per-surface bounding table (`llp/0146:950-968`); one result envelope mirrors LLP 0024/0062's one-core rule (`llp/0062:18`); the server-only effective view mirrors 0062's own `explain-auth` posture — "never a client-side prediction" (`llp/0062:1522-1526`). Verified-against-source.
6. **The numbering note is verifiably true**: `llp/0148-prefixed-identifiers.decision.md` exists on another ref (commit `74900baf`, "docs(llp): LLP 0148 Accepted — prefixed identifiers") and is absent from this working tree. Verified-against-source.
7. **Honest non-authority throughout**: wire shapes unratified, descriptor owner deferred to Slice 0, plan-token semantics pushed to a dedicated RFC, and the sixteen open questions are genuinely open rather than smuggled-as-settled. (inferred, from full-document reading)
8. **The assessment's structural argument for journal-before-plan-tokens holds**: every journal transition really is evidence the system already produces (settlement lookup, per-kind outcome contract), while plan tokens need an undesigned materiality comparison (LLP 0024's dry-run shape at `llp/0024:484-513` confirms nothing binds preview to commit today). Verified-against-source.

## 3. Findings

**1. MATERIAL — A4's derivation premise is unsupported at the cited altitude, and LLP 0053 is the wrong authority for it.** (target lines 548–560, specifically "the server can derive whether non-operator principals may write it (LLP 0053's authorization model)" at 552–553). LLP 0053 owns *read*-authorization invalidation: its declarations are result dependence and `permissionBacking`/`permissionFields` for authorization events (`llp/0053-authorization-invalidation.rfc.md:393-432`); it contains no per-field write-authority model. Write authorization in Snapback today is imperative — "mutations run with `ctx.auth` and may reject unauthorized changes" (`llp/0011-auth-and-permissions.rfc.md:259`) — with declarative write-side rules still a draft shape (`llp/0011:181-195`). The only static derivation available is an over-approximation from declared function write summaries joined with per-function auth requirements, and declarations of exactly that class are what LLP 0146's own correction found unreliable (`llp/0146:258`, "declared tables are the only fan-out filter" — the live Cloudflare fan-out defect). A4 fails to apply its own section's A1 provenance grading (target 513–522) to its own premise, and "No backend in the comparison set can derive this without per-app cooperation" (559–560) overstates the differentiation, since Snapback also needs per-app declarations for the derivation to exist. *Resolve:* re-cite the owning machinery (invocation authority plus manifest write summaries, not 0053), downgrade "can derive" to "can conservatively over-approximate from declared write sets," grade the fact `declared` with the D1-conformance caveat, and either define or drop "the comparison set."

**2. MATERIAL — the Concurrence overstates catalog completeness: "The generated catalog entry really does already carry most of the static descriptor"** (target lines 467–468). Against R1's field list (target 348–359), the spec'd catalog entry (`llp/0024:447-462`) covers roughly identity/kind/generation, argument schema, auth/capabilities/syncability, dry-run flag, and source span — but none of: refusal union, derived retry/outcome class, settlement support, output-mode ceilings, demand/lifecycle facts, risk/confirmation facts, capability/guide IDs, aliases, or examples. The implemented catalog is thinner still: `outputSchema` is always `'unknown'` ("The codegen artifacts carry no return-shape schema yet," `packages/snapback-cli/mcp-control.mjs:135-136`), `dryRunSupported` is hardcoded `false` (`mcp-control.mjs:144`), and the spec'd read/write summaries are absent from the generated description (`mcp-control.mjs:132-133`). The base document's own phrasing — the catalog "is already the seed" with an enumerated field list (target 117–123) — is exactly right; the assessment's "most" is what a reader will remember, and it is wrong. *Resolve:* replace "most of" with "the identity, schema, and authority core of" (or the base's "seed"), optionally noting the implementation-altitude gaps as evidence for R1's remaining work.

**3. DETAIL — the F5 journal diagram misdraws two transitions** (target lines 238–241). As drawn, `not-dispatched` descends from `dispatched`, but per LLP 0062 not-dispatched is "a failure before dispatch" (`llp/0062:450-451`); and the second line's `-> durably-consumed -> acknowledged` visually attaches to the whole four-way union, though LLP 0043's adopted lifecycle forbids acknowledging unknown outcomes (`llp/0062:18`: "no acknowledgement of unknown outcomes") and the target's own prose agrees (246: "`outcome-unknown` is terminal evidence"). The prose is correct; the diagram will be the thing implementers copy. *Resolve:* redraw with `prepared -> not-dispatched` as its own branch and the consumed/ACK tail hanging off `settled` only.

**4. DETAIL — the assessment's stated evidence basis is narrower than its claims** (target lines 460–461: "after reading this document against LLP 0024, 0043, 0055, 0062, 0146, and 0147"). A2 leans on LLP 0093's version identities (verified real: the `version: u64` on replace/delta is the storage commit version, `llp/0093-client-protocol-and-native-clients.rfc.md:213-214`), A4 leans on LLP 0053, and the small notes lean on LLP 0144/0061 — none in the stated list. The claims I checked happen to hold (except finding 1), but the provenance statement should match the claims made. *Resolve:* widen the stated reading list or mark the out-of-list claims as unverified-by-this-pass.

**5. DETAIL — Related-header hygiene**: LLP 0094, 0095, and 0134 appear in Related (target lines 12–13) and nowhere in the body. *Resolve:* drop them or add the sentence that earns each (0094/0095 presumably back F8's wire/completeness facts; 0134 presumably the maturity-marker discipline for descriptor capability rows).

**6. DETAIL — `plan_operation` in R2's illustrative tool family** (target line 374) forward-references a surface the same document defers to a dedicated RFC (F4, Slice 4, follow-on 3). If it means projecting today's dry-run (`function.explain`/`mutationDryRun`, `llp/0024:484-493`), one clause should say so; otherwise the "important properties" paragraph beneath it quietly assumes an undesigned primitive. *Resolve:* gloss it as the dry-run/preflight projection or move it to the Slice 4 discussion.

**7. DETAIL — undefined referent "the comparison set"** (target line 560). This document never establishes a comparison set; the phrase imports context from the 0116–0126 research series without citation. *Resolve:* cite the series or restate the claim self-contained.

## 4. Suggestions

- The tree contains a ready-made witness for F1's static/effective gap: the shipped catalog's `dryRunSupported: false` (`mcp-control.mjs:144`) coexists with a served `mutationDryRun` (`src/host_ops.rs:717,1686`) — a static declaration disagreeing with effective capability today. Citing it would ground F1 in an observed instance rather than a hypothetical.
- The earliest-retry small note (target 602–604) lands in a slot LLP 0144 already reserves — "retry and quarantine disposition participation" is named in its deferred option space (`llp/0144-declared-app-refusal-codes.rfc.md:103-104`). Citing that anchor shows the note joins an owner rather than growing one.
- Consider adding LLP 0058 (shared invocation authority; owns the `AuthRequirement` vocabulary and invocation gate per `llp/0062:18`) to Related and to the effective-view discussion — it is the authority the effective view would project, and it is currently invisible in this document.
- Sharpening 2's client-side join answer to "what may I do?" (target 501–503) is compatible with "No client-side permission oracle" (627–628) only because the per-descriptor answers are server-derived; one sentence saying so would prevent the obvious misreading.
- F9 would benefit from anchoring D2's actual precedence list (`llp/0146:451-462`) so the "authoring oracle, not task oracle" distinction is checkable in place.

## 5. Open questions

- Whether the LLP 0012 function manifest currently populates declared write summaries for all function kinds (the generated MCP description omits them; I verified the catalog code but not every manifest field producer) — this bounds how much of R1's "declared reads/writes" bullet exists today versus needs authoring-side work.
- Whether `plan_operation` (finding 6) was intended as a dry-run projection or a deliberate forward reference; the text supports either reading.
- Whether the assessment's "High" on A5 should survive scrutiny once the effective view exists — I could not falsify the refusal/effective-view vocabulary-unification claim against current code because neither surface exists yet; it is a design constraint, not a verified fact, and the document could label it as such.

## 6. Recommended next step

Apply the two MATERIAL corrections — reword A4's derivation claim with the correct owning authorities and the declared-fact caveat, and recalibrate the Concurrence's "most of the static descriptor" — plus the F5 diagram redraw and the three hygiene DETAILs. No re-research is needed; the base survived verification and the direction stands. Resubmit for a delta review; on current evidence a round-2 READY is likely.

Tool-use count: 46.

NOT READY

## Round 2 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent (new context; not the round-1 reviewer)
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** delta-scoped round 2 — family-conditioned blindness: read its own
round-1 artifact only; prohibited from the codex artifact and the
super-refine journal, and recorded how it honored that. SHA-pinned target
(v0.2) and instruction capsule. Read-only; no tests executed. HTML entity
escapes de-escaped from transport; no other edits.
**Instruction capsule SHA-256:** `54542119545b3f4c51bb3c8927d8e9013b3efcd460ad917dda298e1231000a65`
**Target:** `llp/0149-agent-application-consumption.research.md` (836 lines, v0.2, Draft Research, untracked)
**Target SHA-256:** `ffd053bb98b6a45c76b003f1833c193370f069fa3594956e9a87cb0cd147b8c2`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 27
**Status:** completed
**Verdict:** NOT READY

## Verbatim review (round 2)

# Review: LLP 0149 — Agent-native application consumption (Research, Draft v0.2)

**Reviewer:** Fable family, independent context, round 2 (delta-scoped)
**Target:** `llp/0149-agent-application-consumption.research.md` (836 lines)
**SHA-256 verified:** `ffd053bb98b6a45c76b003f1833c193370f069fa3594956e9a87cb0cd147b8c2` — match. Repo at `main` `67628399`.
**Blindness clause honored:** the only review artifact read was my own family's round-1 document, `llp/reviews/0149-agent-application-consumption.fable.md`, via a direct path-targeted read. I did not read, list, or grep `llp/reviews/0149-agent-application-consumption.codex.md` or `llp/reviews/0149-agent-application-consumption.super-refine.md`; every grep in this pass targeted the target document, named LLP files, or source trees outside `llp/reviews/`. Knowledge of what changed in v0.2 comes solely from the instruction capsule and the target's own Revised header.

## 1. Overall assessment

**Verdict: NOT READY — by the narrowest possible margin; one clause blocks.**

Both round-1 MATERIALs are genuinely resolved, and resolved well: the rewritten A4 is now anchored to the correct authorities (`llp/0011:259` verified verbatim; `llp/0011:181-196` verified as the draft write-rule shape), and the rewritten Concurrence replaces "most of the static descriptor" with the accurate "identity, schema, and authority core," backed by implementation-altitude evidence I verified line-for-line (`packages/snapback-cli/mcp-control.mjs:135-144`). All five of my round-1 DETAILs were addressed, four cleanly. The new F4 text (operator-plane-only dry-run) is verified true at all three cited altitudes; the redrawn F5 diagram and new per-kind matrix are correct; the new Gated confidence tier honestly captures A4/A6/A7's status; the new anchors added in v0.2 check out with two exceptions noted below.

What blocks READY is exactly the failure mode the capsule predicted: the fix for my round-1 finding 6 introduced a new existing-capability overstatement. The `plan_operation` gloss now asserts the server "already owns" a declared-effects report for actions — no such preview surface exists (only `mutationDryRun` is served, and no action-effects explain kind is even pinned), and by the document's own F2/OQ3, the effect-declaration grammar it would report does not exist either. This is the same defect class that blocked v0.1, it sits in a Recommended-direction section, and it is a one-clause fix. Three DETAILs (an offset anchor, and two small residues of round-1 fixes) round out the delta.

## 2. Round-1 resolution table

| # | Round-1 finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | MATERIAL — A4 miscited LLP 0053; derivation unsupported | **Resolved** | A4 rewritten (target 625–643): write authorization named imperative with `llp/0011:259` (verified exact text) and draft-shape `llp/0011:181-196` (verified); derivation downgraded to "only static approximation… function write summaries joined with per-function auth requirements"; the LLP 0146 declared-tables correction correctly invoked (`llp/0146:259-262`, "declared tables are the only fan-out filter… simply correct"); untrusted-floor posture, no positive label; LLP 0053 dropped from Related (target 14–17); Gated confidence tier (target 724–726). One residue → new finding 4. |
| 2 | MATERIAL — Concurrence "most of the static descriptor" | **Resolved** | Target 526–534: "identity, schema, and authority core… though none of its refusal, retry, effect, risk, or guide facts"; implementation gaps cited and verified — `mcp-control.mjs:135` ("no return-shape schema yet"), `:136` (`outputSchema: 'unknown'`), `:144` (`dryRunSupported: false`); correctly framed as "evidence for R1's remaining work, not against the seed claim." |
| 3 | DETAIL — F5 diagram misdrew two transitions | **Resolved** | Target 261–265: `prepared -> not-dispatched` is its own branch labeled "(failure before dispatch)" matching `llp/0062:450-451`; the ACK tail now hangs off `settled` only, marked "(mutations only, per LLP 0043)". The new per-kind matrix (target 277–283) is consistent with LLP 0062's posture and with F4. |
| 4 | DETAIL — evidence basis narrower than claims | **Resolved, with one residue** | Target 513–516 widens the stated reading to targeted checks of 0011, 0053, 0061, 0093, 0133, 0144. All out-of-list claims I re-checked hold (`llp/0093:213-214` verified; `llp/0133:414-420` commit-order binding verified; `llp/0144:103-104` verified). Residue: 0053 no longer earns its slot → new finding 4. |
| 5 | DETAIL — Related-header hygiene (0094/0095/0134) | **Resolved for those three; recreated for 0058** | 0094/0095 earned at F8 (target 359–361; "tolerance floor" verified at `llp/0095-client-lifecycle-and-conformance.spec.md:465`); 0134 earned at Slice 0 (target 471–472; LLP 0134 is the capability-maturity-promotion spec). LLP 0058 was added to Related (target 15) with zero body mentions → new finding 3. |
| 6 | DETAIL — `plan_operation` unglossed | **Partially resolved** | The gloss exists (target 428–433) and correctly separates preview projection from Slice 4's plan receipt — but the gloss itself overstates what exists → new finding 1. |
| 7 | DETAIL — undefined "comparison set" | **Resolved** | Phrase absent from v0.2 (grep of target). |

Round-1 suggestions were also adopted and check out: the F1 static/effective witness (target 164–168; both anchors verified — `mcp-control.mjs:144`, `src/host_ops.rs:1686`), the earliest-retry note's 0144 anchor (target 705–708; verified at `llp/0144:98-104`), the sharpening-2 compatibility sentence (target 566–569), and F9's D2 precedence anchor (target 374; verified at `llp/0146:451-462`). My round-1 open question on A5's confidence grade is answered by the new labeling ("identity-bound design constraint… not a verified fact", target 719–721) plus OQ17.

## 3. New findings

**1. MATERIAL — R2's gloss claims the server "already owns" an action declared-effects preview that does not exist at either altitude.** Target 428–431: "`plan_operation` here means projecting the preview the server already owns — today's `mutationDryRun` explain kind and a declared-effects report for actions." The apposition puts both items under "already owns." In code, `mutationDryRun` is the only served explain kind — every other kind is refused (`src/host_ops.rs:1715-1720`), and the LLP 0024 v0 pinned kinds (`src/host_ops.rs:1711`: queryPlan, permissionAllow, permissionDeny, capabilityGap, mutationDryRun) include no action-effects kind, so an action report is not even pinned-but-unbuilt. Deeper: a "declared-effects report" has nothing to report — the document's own F2 (target 184–186) says effect facts "must remain `unknown` until the application declares them through an owning authoring design," and OQ3/OQ14 keep that declaration grammar open. F4 (target 236–239) and the F5 matrix (target 281, "declared effects only, no execution") correctly treat this as contract-to-be; the R2 gloss contradicts them. Introduced by the round-1 fix for my finding 6 — the exact defect class that blocked v0.1. *Resolve:* one clause — e.g. "projecting the preview path the server owns or the corpus has pinned: today's `mutationDryRun` explain kind, plus F4's declared-effects report for actions once an effect-declaration grammar exists."

**2. DETAIL — A7's LLP 0147 anchor is offset; the cited lines hold the adjacent paragraph, not the quoted substance.** Target 686 cites `llp/0147:691-695` for "its `idempotent` retry class is deliberately absent because such a declaration requires naming its authoritative source, request identity, and artifact carrier before it may carry policy." Lines 691–696 are the v1 two-class derivation ("retry policy is derived from the closed operation kind"); the deliberate-absence paragraph with the source/identity/carrier requirement is at `llp/0147:704-711` ("An `idempotent` class is deliberately absent rather than reserved-and-unused… requires naming its authoritative source, its request identity, its profile-artifact field, and its compile-time diagnostic"). Claim true; anchor wrong. *Resolve:* re-anchor to `llp/0147:704-711`.

**3. DETAIL — LLP 0058 sits in Related with no body sentence earning it.** Target 15 lists LLP 0058; grep of the body finds no other mention. This recreates, for one entry, the round-1 finding-5 class the revision just fixed for 0094/0095/0134 — my round-1 suggestion was to add it to Related *and* to the effective-view discussion. LLP 0058 (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md`) owns the invocation-authority vocabulary the effective view would project. *Resolve:* one sentence in F1 or R4 naming 0058 as that authority, or drop it from Related.

**4. DETAIL — the evidence-basis sentence's qualifier is now false for LLP 0053.** Target 514–516: "targeted checks of LLP 0011, 0053, 0061, 0093, 0133, and 0144 **where the ideas below lean on them**." After the A4 rewrite, no idea below leans on 0053 — it appears nowhere else in the document (grep). The list was widened to fix my round-1 finding 4 but kept an entry whose leaning claim was simultaneously removed. *Resolve:* drop 0053 from the list, or reword the qualifier (e.g. "checked while correcting this section").

## 4. Suggestions (non-finding)

- F5's prose bullet list (target 248–252) and the new matrix (277–283) now state the per-kind posture twice. The matrix is the better artifact; the bullets could shrink to a one-line pointer, recovering a few lines of the growth budget.
- A6's "value-redacted operation trace" is a fair paraphrase of LLP 0062's transcript design ("values kept separate and explicitly user-authorized," the value-free audit lane's complement), but "value-separated, replayed value-free by default" would match the source more precisely.
- A6's "re-executing recorded effectful traces is what LLP 0146 declined" is verified (`llp/0146:926-948`, Declined 3 — narrow successor requires isolated branch plus explicit confirmation, actions never replay automatically); anchoring Declined 3 explicitly would make the strongest safety claim in A6 checkable in place, as v0.2 did for F9's D2 claim.
- F6's new ceiling inventory (target 300–303) is verified — TTL (`llp/0055:221`), live-token caps (`llp/0062:1538-1540` "per-grant live-token cap"), throttles (`llp/0055:615,619-620`) — and would benefit from those three anchors, since it is now a load-bearing today-vs-new boundary.

## 5. Open questions

- Whether the action arm of `plan_operation` should be cut from R2 entirely rather than reworded (finding 1): until an effect-declaration grammar exists (OQ3/OQ14), an action "preview" projection has no authoritative content, and R2 could honestly scope `plan_operation` to mutations with actions deferred to F4's contract.
- Whether the Revised header's claim that both families were NOT READY on v0.1 chiefly on assessment-section overstatements accurately characterizes the other family's round-1 grounds — unverifiable under the blindness rule from my seat; the orchestrator should confirm it.
- Same residual question as round 1, now narrower: whether the LLP 0012 manifest populates declared write summaries for all function kinds — A4's "only static approximation" premise assumes they exist to join; I verified the catalog omits them from the generated description but did not audit every manifest producer.

## 6. Recommended next step

Apply the one-clause fix for finding 1 and the three DETAIL repairs (re-anchor A7 to `llp/0147:704-711`; earn or drop 0058; drop 0053 from the evidence-basis qualifier). No re-research and no structural work is needed — every other v0.2 change verified clean against the tree, and the round-1 resolutions are genuine. A round-3 delta review of those four edits should converge READY immediately.

Tool-use count: 27.

NOT READY

## Round 3 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent (new context; not the round-1 or round-2 reviewer)
**Effort:** session-inherited
**Date:** 2026-08-01
**Method:** narrow delta round over the ten enumerated v0.3 changes;
family-conditioned blindness: read its own artifact (rounds 1-2) only;
prohibited from the codex artifact and the super-refine journal, and
recorded how it honored that. SHA-pinned target (v0.3) and instruction
capsule. Read-only; no tests executed.
**Instruction capsule SHA-256:** `ce41d5fe689881a322f1f11d83a3a155edea3355d1601de852c7ead6d4a380c3`
**Target:** `llp/0149-agent-application-consumption.research.md` (871 lines, v0.3, Draft Research, untracked)
**Target SHA-256:** `3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 16
**Status:** completed
**Verdict:** READY

## Verbatim review (round 3)

# Review: LLP 0149 — Agent-native application consumption (Research, Draft v0.3)

**Reviewer:** Fable family, independent context, round 3 (narrow delta)
**Target:** `llp/0149-agent-application-consumption.research.md` (871 lines)
**SHA-256 verified:** `3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6` — match. Repo at `main` `67628399`.
**Blindness clause honored:** the only review artifacts read were my own family's rounds 1 and 2 in `llp/reviews/0149-agent-application-consumption.fable.md`, via a single direct path-targeted read. I did not read, list, or grep `llp/reviews/0149-agent-application-consumption.codex.md` or `llp/reviews/0149-agent-application-consumption.super-refine.md`; every search in this pass targeted the target document, named LLP files, or source trees outside `llp/reviews/`. Knowledge of what changed in v0.3 comes solely from the instruction capsule, the target's Revised header, and comparison against my family's round-2 record.

## 1. Overall assessment

**Verdict: READY — by a comfortable margin.**

Both round-2 blockers are genuinely resolved, and this time the fix introduced no successor defect — the failure mode that recurred in rounds 1→2 did not recur in 2→3. I verified every factual claim in the ten enumerated v0.3 changes directly against the tree: the recast F1 witness is true at both anchors and its four-facts lesson is more accurate than the "static/effective disagreement" framing it replaced; the F6 limit split is correct across the *entire* LLP 0055 document, not just the cited windows (a full throttle sweep found no invocation-under-grant throttle anywhere); the R2 gloss now claims exactly what exists (`mutationDryRun`, operator-plane, verified at three altitudes) and honestly claims nothing for actions; the A7 re-anchor is exact in the current tree despite 0147's concurrent revision; and the A5/A6/A2 rewrites match LLP 0144's I2/I6/I7, LLP 0146's Declined 3, LLP 0062's transcript design, and LLP 0093/0133's version identities word-for-word where they quote and fairly where they paraphrase. What remains open in the document — seventeen open questions, three Gated assessment ideas, undecided ownership — is exactly what a Draft Research may leave open, and none of it is smuggled as settled. Nothing I found would be fixed by another no-new-evidence round.

## 2. Round-2 resolution table

| # | Round-2 finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | MATERIAL — R2 gloss claimed the server "already owns" an action declared-effects preview | **Resolved** | Target 436–441: "`plan_operation` projects preview, not the plan receipt: concretely, today's `mutationDryRun` explain kind — operator-plane only until F4's agent-reachable prerequisite lands — and for actions nothing yet, since an effects report exists only once an effect-declaration grammar does (OQ3, OQ14)." This adopts my round-2 open question's stronger route (cut the action arm rather than reword it). Every leg verified: `mutationDryRun` is the only served explain kind (`src/host_ops.rs:1686-1688,1715-1720`); it runs under `authority_dev_user` (`src/host_ops.rs:1701`); LLP 0055 pins `dryRun` false for agents in v1 ("v1 has no scoped-token dry-run surface (`function.explain` is host-ops)", `llp/0055:1323-1324`); agent-principal dry-run is named LLP 0062 future work (`llp/0062:1516-1519`). |
| 2 | DETAIL — A7's LLP 0147 anchor offset (691–695 vs the substance at 704–711) | **Resolved** | Target 719–720 cites `llp/0147:704-711` with an explicit moving-anchor note. Verified exact in the current tree: "An `idempotent` class is deliberately absent rather than reserved-and-unused… requires naming its authoritative source, its request identity, its profile-artifact field, and its compile-time diagnostic" sits at `llp/0147:704-711` today. No drift as of this review. |
| 3 | DETAIL — LLP 0058 in Related with no body sentence | **Resolved** | R4 (target 461–463) earns it: the effective view "project[s] the shared invocation-authority vocabulary LLP 0058 owns, never inventing authority language of its own." LLP 0058 is the Accepted "Shared invocation authority and staged auth-mode protocol" spec (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1-5`); the characterization is exactly its title and role. |
| 4 | DETAIL — evidence-basis qualifier false for LLP 0053 | **Resolved** | Target 528–530 lists "LLP 0011, 0061, 0093, 0133, and 0144 where the ideas below lean on them" — 0053 dropped, and a whole-document grep finds zero occurrences of "0053" anywhere in the target. Every remaining list entry now has an idea that leans on it (0011→A4, 0061→A6, 0093/0133→A2, 0144→A5 and the earliest-retry note). |

Round-2 suggestions were also adopted and verified: the F5 prose bullets are compressed to one sentence pointing at the matrix (target 249–254); A6 now reads "value-separated… replayed value-free by default," matching `llp/0062:1527-1531` ("values kept separate and explicitly user-authorized"); A6 anchors Declined 3 explicitly (`llp/0146:926-948` — heading verified at `llp/0146:926`, content matches: reads/dry-runs replay freely, re-execution needs an isolated branch plus confirmation, actions never replay automatically); and F6 carries anchors — different from the ones I suggested, and better, since they anchor the grant record itself (`llp/0055:920-944`, `scopes`/`expires_at` verified at 930–937), the v1 cap constants (`llp/0055:898-905`, "Live tokens per grant: 10" verified at 900–902), and the throttled auth routes (`llp/0055:1154-1165`, verified; the app-data invocation gate row at `llp/0055:1169` carries no throttle, and a document-wide sweep confirms every 0055 throttle governs an auth or credential route).

## 3. New findings

Scrutiny of all ten v0.3 changes — anchors read directly, claims checked at cited altitude — produced no BLOCKING or MATERIAL findings. One DETAIL:

**1. DETAIL — the overlap table's LLP 0144 anchor range clips the fact it cites.** Target 119 cites `llp/0144:199-204` for "deliberately keeps the vocabulary off the protocol descriptor and client consumption is untyped reach-through." The enumerability fact runs `llp/0144:201-208` ("Enumerability — deliberately absent from the protocol surface… **not enumerable from the served protocol surface**"); the cited range starts two lines early inside the previous fact and ends before the conclusion sentence at 206–207. The second range is sound (`llp/0144:381-386` contains D1's "Untyped reach-through: clients read `error.diagnostic.details.appCode` by hand," `llp/0144:383-384`). Substance fully intact; this is v0.2-era text, in scope here only via the whole-document pass, and it does not gate READY. *Resolve (optional):* widen to `llp/0144:201-208`.

For the record, the changes I checked hardest and found clean: the F1 recast's both anchors and its "both honestly unavailable — not a static/effective disagreement" correction (`packages/snapback-cli/mcp-control.mjs:144` hardcodes `dryRunSupported: false`; `src/host_ops.rs:1686-1701` serves `mutationDryRun` under dev-user authority); the Slice 2 / A7 / F5 triangle, which is now internally consistent (terminal-at-the-generic-engine, declared key as reconciliation metadata only, nonterminal class gated on a designed enforced owning contract — target 497–501, 269–274, 720–724); A5's I2/I6/I7 scoping, which matches LLP 0144 exactly (I6 "terminal, uniform, and outside this channel," `llp/0144:241-242`; I7 "caller-visible bytes raised from inside permission-gated functions… app-authored disclosure by construction," `llp/0144:243-249`; I2's namespace separation, `llp/0144:227-230`); A2's identity claims (`version: u64` is the storage commit version, `llp/0093:213-214`; the receipt's committed `snapshotVersion` binds to commit order, `llp/0133:415`) and its honest unrelated-writes staling caveat; and the earliest-retry note's namespace routing (I6 for platform denials; the reserved slot "retry and quarantine disposition participation" verified at `llp/0144:103-104`).

## 4. Suggestions (non-finding)

- A7's paraphrase of the 0147 bar names three of the source's four requirements (authoritative source, request identity, artifact carrier) and omits the compile-time diagnostic (`llp/0147:709`). The claim is true as stated; adding "and compile-time diagnostic" would make the paraphrase complete if the sentence is ever quoted onward.
- Since LLP 0147's anchors are acknowledged as moving, the eventual commit that lands this document could pin them by 0147's revision date or section name ("Retry classes") rather than line numbers, as the document already does for LLP 0133.

## 5. Open questions

- Carried from rounds 1–2, still open and still bounded: whether the LLP 0012 function manifest populates declared write summaries for all function kinds — A4's "only static approximation" premise assumes they exist to join; I verified the generated MCP description omits them but did not audit every manifest producer. This bounds A4's already-gated floor posture, not any recommendation.
- Whether the Revised header's one-line summary of the loop ("rounds 1–2 applied…") fairly characterizes the other family's grounds remains unverifiable from my seat under the blindness rule; the orchestrator holds both records and can confirm.

## 6. Recommended next step

Accept round 3 as convergence for this family. The document is at the standing bar: every factual claim I could check is true at its cited altitude, ownership and boundary assertions match the referenced documents, the ten v0.3 changes introduced no new overstatement, and the remaining opens are genuinely open questions that only new evidence — an owning RFC, a measured effective-view cost, a landed effect-declaration grammar — can close. The optional DETAIL (widen one anchor range) and the two suggestions can ride the landing commit without another review round.

Tool-use count: 16.

READY

## Round 4 — 2026-08-02

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh
non-author subagent (new context; not a prior-round reviewer)
**Effort:** session-inherited
**Date:** 2026-08-02
**Method:** final-verification round over the seven enumerated v0.4 changes;
family-conditioned blindness: read its own artifact (rounds 1-3) only;
prohibited from the codex artifact and the super-refine journal, and
recorded how it honored that. SHA-pinned target (v0.4) and instruction
capsule. Read-only; no tests executed.
**Instruction capsule SHA-256:** `123754b033d8787701ef1974fb5eea196f524a455046122443d90db896479eb3`
**Target:** `llp/0149-agent-application-consumption.research.md` (885 lines, v0.4, Draft Research, untracked)
**Target SHA-256:** `f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 16
**Status:** completed
**Verdict:** READY (second consecutive; one external-cause DETAIL — the
0147 anchor drift — plus two wording suggestions, all designated
ride-the-landing-commit)

## Verbatim review (round 4)

# Review: LLP 0149 — Agent-native application consumption (Research, Draft v0.4)

**Reviewer:** Fable family, independent context, round 4 (convergence verification)
**Target:** `llp/0149-agent-application-consumption.research.md` (885 lines)
**SHA-256 verified:** `f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890` — match. Repo at `main` `67628399`.
**Blindness clause honored:** the only review artifact read was my own family's record, `llp/reviews/0149-agent-application-consumption.fable.md` (rounds 1–3), via a single direct path-targeted read. I did not read, list, or grep `llp/reviews/0149-agent-application-consumption.codex.md` or `llp/reviews/0149-agent-application-consumption.super-refine.md`; every search in this pass targeted named LLP files (`llp/0144`, `llp/0058`, `llp/0062`, `llp/0147`) — none touched `llp/reviews/`. Knowledge of what changed in v0.4 comes solely from the instruction capsule, the target's Revised header, and comparison against my family's round-3 record.

## 1. Overall assessment

**Verdict: READY — by a comfortable margin.**

All three of my family's round-3 residual items are accounted for: the optional DETAIL (the clipped LLP 0144 anchor) is fixed and verified, suggestion 1 (the incomplete A7 paraphrase) is adopted and verified against the source's four requirements, and suggestion 2 (pin 0147 anchors by section rather than line) was declined in favor of the existing moving-anchor caveat — a defensible author choice whose cost has now materialized as this round's only finding. All seven enumerated v0.4 changes were verified directly against the tree, and none introduces an overstatement: the A6 split matches LLP 0062's actual artifact structure word-for-word where it quotes (the audit lane really is "value-free and leak-resistant by default," `llp/0062:628`, a different artifact from the opt-in transcript, `llp/0062:1527-1533`); the earliest-retry note's routing matches LLP 0144's landed Axis E slice, its OQ3, and its landed B1 exactly; A5's budget-gate relabel makes I6's scope match its source text ("auth, capability, protocol" — `llp/0144:241-242`) and is consistent with F6's proposed-vs-existing inventory; the new `llp/0058:1049` anchor lands on the section heading that owns both facts the parenthetical names; and the widened overlap-table range now covers the enumerability fact completely. The fix-introduces-defect pattern that recurred in rounds 1→2 did not recur here, for the second consecutive round. The one new DETAIL — the A7 anchor drifted because LLP 0147 moved under concurrent revision — is external in cause, pre-caveated in the document's own text, and has a durable landing-commit fix already on record. Nothing remaining would be fixed by a further no-new-evidence round.

## 2. Round-3 resolution table

| # | Round-3 item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Optional DETAIL — overlap table's `llp/0144:199-204` clips the enumerability fact | **Resolved** | Target 120 now cites `llp/0144:201-208, 381-386`. Verified: the enumerability fact runs exactly `llp/0144:201-208` ("Enumerability — deliberately absent from the protocol surface… **not enumerable from the served protocol surface** — a floor fact… must argue against"), heading to conclusion inclusive. |
| 2 | Suggestion — complete A7's paraphrase with the fourth requirement | **Adopted** | Target 727-728: "authoritative source, request identity, artifact carrier, and compile-time diagnostic." Source verified: all four present — "naming its authoritative source, its request identity, its profile-artifact field, and its compile-time diagnostic — none of which exist today" (`llp/0147:724-726` in the current tree). "Artifact carrier" fairly renders "profile-artifact field." |
| 3 | Suggestion — pin 0147 anchors by revision date or section name, not line numbers | **Declined (moving-anchor caveat retained)** | Target 729-730 keeps `llp/0147:704-711` with "a moving anchor — 0147 is under concurrent revision." The predicted drift has now occurred → new finding 1. |
| 4 | Open question — Revised header's characterization of the other family's round-1 grounds | **Mooted** | The v0.4 header (target 9-14) no longer characterizes any family's verdict grounds; it lists applied changes only and points at the per-round record. Nothing left to confirm from my seat. |
| 5 | Open question — LLP 0012 write-summary population (bounds A4's floor posture) | **Carried, unchanged** | v0.4 touches none of the text this bounds; still open, still bounded to A4's already-gated floor, not to any recommendation. |

## 3. Verification of the seven v0.4 changes

1. **A6 split (target 692-719).** Verified at both altitudes: `run --replay` is "executing a script against recorded frames — hermetic acceptance fixtures" (`llp/0062:1531-1533`); the transcript records "full call/subscribe result documents… values kept separate and explicitly user-authorized" and is "the value-free audit lane's opt-in complement" (`llp/0062:1527-1531`); the audit lane is "value-free and leak-resistant by default" (`llp/0062:628`) — so "different LLP 0062 artifacts," with the audit lane the default and the transcript the value-carrying opt-in, is exactly the source's structure. The effect-hermetic-but-not-distribution-safe correction is sound, and fixture custody under transcript disclosure rules follows from the transcript being the value-carrying artifact. The Declined 3 anchor (`llp/0146:926-948`) is untouched from the round-3-verified state. Clean.
2. **Earliest-retry note (target 749-757).** Verified: Axis E's landed slice is "declared refusals participate in no dispositions" with "E1 (landed). None. A declared refusal is terminal for that attempt" (`llp/0144:423-429` — heading 423, slice sentence 425, E1 428-429; range exact); OQ3 holds "whether declared refusals ever carry retry/quarantine hints — and *which document owns the queue's terminal-refusal handling*… E1 stays normative until that named amendment exists" (`llp/0144:688-692`); `appDetails` untyped is B1 landed, "No schema; JSON-safety only" (`llp/0144:287`). Clean.
3. **A5 relabel (target 673-677).** I6's source text names "auth, capability, protocol" only (`llp/0144:241-242`), so narrowing I6's coverage to grant/capability gates and moving budget gates to "proposed platform-owned denials" corrects a scope I6 never carried; consistent with F6's inventory (per-grant call-count/spend ceilings are "new surface the compiler can only propose once 0055 grows them," target 309-311) and with the note in change 2. Clean.
4. **R4 anchor (target 464-465).** `llp/0058:1049` is the "## Shared invocation authority" section heading; that section (1049-1358, no intervening top-level heading) contains both the five type layers (1051 ff.) and `InvocationGate` (`llp/0058:1176,1203,1220`). The gloss "the shared type layers and invocation gate" names exactly what the section owns. Clean.
5. **Overlap-table widening (target 120).** Verified exact; see resolution row 1. Clean.
6. **A7 completion (target 727-728).** Verified; see resolution row 2. Substance clean; anchor drifted → finding 1.
7. **Revised header (target 9-14).** The consolidated v0.4 entry's seven clauses each correspond to a real applied change ("A6 split into effect-hermeticity vs data safety" = change 1; "retry-hint carrier reopened to 0144 OQ3" = change 2; the rest are the verified v0.2/v0.3 fixes). No mischaracterization. Clean.

## 4. New findings

**1. DETAIL — A7's `llp/0147:704-711` anchor has drifted; the substance now sits at `llp/0147:721-728`.** Target 729 cites `llp/0147:704-711`; in the current tree those lines hold the adjacent retry-classes derivation ("retry policy is **derived from the closed operation kind**," `llp/0147:709-711`), and the deliberately-absent paragraph with all four named requirements is at `llp/0147:721-728` ("An `idempotent` class is deliberately absent rather than reserved-and-unused… its authoritative source, its request identity, its profile-artifact field, and its compile-time diagnostic — none of which exist today," with the compile-time diagnostic at `llp/0147:726`). The claim is true; the caveat the document already carries ("a moving anchor — 0147 is under concurrent revision," target 729-730) flagged exactly this, and the capsule instructed drift be reported as DETAIL. Cause is external (0147 is untracked and under concurrent revision), so re-pinning to fresh line numbers now would only drift again. *Resolve (landing commit, not another round):* adopt my family's round-3 suggestion — pin by 0147's section name ("Retry classes") or revision date, as the document already does for LLP 0133 — or re-anchor at landing time. Non-gating.

No other findings. In particular, scrutiny of the seven changes for the loop's recurring defect class — a fix asserting more capability than exists — found no instance.

## 5. Suggestions (non-finding)

- A6's paraphrase "values kept separate and explicitly authorized" (target 700) drops "user-" from the source's "explicitly user-authorized" (`llp/0062:1530-1531`). The abbreviation is not false, but who authorizes is part of the disclosure design; restoring "user-authorized" costs one word.
- A6 routes "what replay means when a script branches on a removed value" to OQ16 (target 703-704), but OQ16's own wording (target 846-848) asks only whether exemplars can be "mechanically value-redacted well enough to ship." Appending the branch-on-redacted-value clause to OQ16 would make the routing literal rather than implied.

## 6. Open questions

- Carried from rounds 1–3, still open and still bounded: whether the LLP 0012 function manifest populates declared write summaries for all function kinds. A4's "only static approximation" premise assumes they exist to join; I verified in prior family rounds that the generated MCP description omits them but no round has audited every manifest producer. This bounds A4's already-gated floor posture only; no recommendation depends on it.
- Whether LLP 0147's revision will land before this document does — if 0147 lands first, the landing commit for 0149 can pin final line numbers instead of section names; if not, section-name pinning (finding 1) is the only durable form.

## 7. Recommended next step

Accept round 4 as this family's convergence confirmation and land the document. The one DETAIL (re-pin or section-name the A7 anchor against the concurrently moving 0147) and the two wording suggestions can ride the landing commit without another review round: every factual claim checked across four family rounds is true at its cited altitude, ownership assertions match the referenced documents as they exist in the tree, the seventeen open questions and three Gated ideas are honestly open, and the v0.4 delta introduced no new defect of any severity above DETAIL — and that one is externally caused and already caveated in-text.

Tool-use count: 16.

READY
