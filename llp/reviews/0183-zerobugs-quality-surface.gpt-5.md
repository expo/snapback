# Review artifact — LLP 0183, GPT family

## Round 1 — 2026-08-07

- Reviewer: gpt-5.6-sol via `codex exec` (read-only sandbox,
  model_reasoning_effort=xhigh), fresh instance; the Codex family
  contributed to the RFC's original 2026-08-05 drafting, but this instance
  carried no drafting context — freshness is per-instance, per the repo's
  established dual-family practice
- Target revision: `llp/0183-zerobugs-quality-surface.rfc.md` at git blob
  `b649359be5bf50e92663b73e85eb274eac13723b` (repo commit `6c2b67a09`,
  839 lines), content-pinned per LLP 0189
- Method: full-document read plus the commissioned evidence set (control
  PLAN, acceptance.v1 + ratification-13.v1, sampled receipts, both
  platform tickets, repository history); LLP 0005 standard structure; five
  execution-informed questions added by the commission
- No redaction (local repo only, no external sends beyond the provider
  runtime itself)
- Stakes: foundational (per the 2026-08-07 author commissioning ruling)
- Supervisor verification note: this review's claim that commit
  `7f57cae0b` mutated the frozen `acceptance.v1.md` in place was
  independently verified true by the supervising session (see the
  2026-08-07 erratum section of
  `demos/zerobugs/manifest/ratification-13.v1.md`); the review's related
  observation that the receipt-pinned `acceptance.v1.json` companion was
  NOT touched was also verified true.

---

## Overall assessment

The control-first, owner-Spec, receipts-not-claims structure survived Stage 0.5 and proved its value by exposing real runtime, client, and benchmark defects. Execution also revealed material weaknesses the RFC currently papers over: contradictory sequencing, poorly owned cross-workstream seams, non-composable receipt semantics, and a breach of the frozen-manifest rule. I would recommend acceptance only after substantial revision and another independent-family review; the program does not require wholesale redesign.

## Strengths

- D1 and “Stage 0.5 — current-surface control” were unusually productive. The control exposed the touched-table version scan, the unrecovering hot-stream lapse, route-group argument limits, browser custody defects, missing mutation identity surfaces, and several harness defects without laundering them into capability claims (`PLAN.md` §§Lane F and Lane 8).

- “Quality is a vector, not a score” and ZB0–ZB7 correctly make correctness, security, and recovery hard gates. The explicit refusal to trade a leak or lost accepted write for latency or authoring wins is a sound foundation.

- The anti-reduction rules are strong. D1, ZB0, and manifest §§1–3 require the complete pinned application, including awkward production edges and source defects, rather than a convenient CRUD facsimile.

- D4’s server-backed-first design is validated by execution. `W-WINDOW` delivered useful bounded windowing without presupposing D3, confirming that this is a genuinely separable seam.

- D3’s `unknown`/proof discipline and staged authority classes are security-conscious. The RFC correctly refuses to turn missing facts into absence or compatible facts into automatically combinable facts.

- Immutable attempts worked as a discovery mechanism. Preserving large v1–v3 and hot v1–v8 made causal history visible and prevented the successful large run from erasing the runtime and harness failures that preceded it.

## Concerns

- **MATERIAL — The operative sequencing contract is contradictory.** “Sequencing” assigns D2/D4/D6 to Stage 1 and D3/D5 to Stage 2, while “Status” and `ratification-13.v1.md` call D3 the first Stage 1 workstream. The ratified advantage is simultaneously described as contingent on Stage 2 D3–D5 integration. In addition, both the RFC and manifest §15 require `acceptance.v2` performance margins before Stage 1, but no such frozen margins are present in the reviewed evidence. Resolve this with one amended dependency graph defining whether D3 work is specification-only before Stage 1, whether it has actually moved into Stage 1, and which entry conditions—including `acceptance.v2`—block implementation.

- **MATERIAL — The frozen benchmark contract was not actually kept immutable.** Manifest §15 says the two v1 files must not be rewritten once receipts name them. Nevertheless, repository history shows commit `7f57cae0b` inserted the `RATIFIED` paragraph into `acceptance.v1.md` after the 2026-08-06 receipts existed; the later ratification artifact itself says v1 was not rewritten. Meanwhile `acceptance.v1.json`, whose digest the receipts pin, still says `proposed-pending-charlie-ratification`. Resolve this by restoring or registering the original prose v1 blob, recording the mutation explicitly as a process violation or erratum, and issuing `acceptance.v2` that incorporates the ratification. Future receipts should pin both canonical prose and machine-readable contracts, not only the JSON companion.

- **MATERIAL — The “better” protocol is principled but underspecified and permits an overbroad conclusion.** Pre-registration and defeat on verified loss are good, but “before results are known” is inaccurate: LLP 0182 and Stage 0.5 results deliberately informed the candidate. Call it pre-registered before confirmatory Stage 1/2 attempts. More importantly, one superior dimension plus noninferiority elsewhere permits an unqualified “better” claim even when several other paths regress within their margins. The defensible language is “better on durable disconnected intent while noninferior on the preregistered paths” unless every vector is Pareto-nonworse. Also freeze repetitions, valid-attempt criteria, harness-invalid versus product-failure treatment, remediation/retest selection, and whether one verified loss in any valid replicate permanently defeats the candidate; otherwise immutable retries permit cherry-picking while incidental harness failures can self-defeatingly kill the claim.

- **MATERIAL — PASS/GAP/FAIL and attempt trails do not yet compose at Stage 1 scale.** `snapback-control.zb2.v3.json` marks `browser-restart-retained-render` PASS while explicitly recording zero retained payloads and an online server-backed render. The large receipt is overall PASS while carrying a `large-full-corpus-readmodel-projection` GAP. Hot v8 records stream staleness under `fresh-precycle-reset-is-byte-provable`, then reports all 16 mutation rows FAIL with zero raw samples even though the issue record says authoritative polls converged. Eight hot attempts consequently repeat 18 downstream FAILs for changing root causes. Introduce distinct `BLOCKED`, `NOT_RUN`, and `INVALID_ATTEMPT` states; causal dependency edges; semantic check names; root-failure identifiers; and separate harness-execution, capability, and claim rollups. Generate the current lane summary from receipts—the top of `PLAN.md` still says Lane 6b awaits continuation while its later section reports PASS 12/12, demonstrating that the monolithic prose ledger is already stale.

- **MATERIAL — The hot failure exposes an unowned D2/D4 live boundary.** The open ticket cannot yet distinguish expensive server re-evaluation from broken client resubscription. D2 leaves incremental live deltas as Open Question 5, while D4 describes query lifecycle without assigning bounded stream recovery, retry, resnapshot, backpressure, or fairness. This allows both owner Specs to pass locally while the application remains permanently stale at scale. Amend D2 to own bounded invalidation/re-evaluation or incremental-delta behavior, D4 to own transport-loss recovery and freshness transitions, and add a joint large/hot end-to-end gate before Stage 1 exit.

- **MATERIAL — D2/D3/D5/D6 are not the right ownership cut for maintained data.** The control register assigns `W-READMODEL` to D2 and D6, `W-MANUALSET` to D2/D3/D6, and transactional repair of those artifacts to D5 mutations. Search membership, all-label membership, ordering materializations, affected-write proofs, browser facts, and graph semantics therefore lack one interface authority. Define a cross-owner materialization contract: D2 owns logical graph semantics, D6 owns maintained derived/search artifacts, D5 owns transactional affected-output maintenance, and D3 owns browser fact/proof custody, with one shared conformance identity and corpus. Without that contract, each owner can satisfy its local brief while version coherence or write maintenance fails between them.

- **MATERIAL — Identity and operation identity are assigned too late.** `W-IDENTITY` is routed to D7, but principal-to-application identity is required by D2 authorization, D3 partitions and leases, and D5 mutation guards. Likewise, client settlement identity currently crosses D5 mutation semantics and D7 effect idempotency. Make authority-context identity and operation identity early cross-cutting contracts, or explicitly joint D3/D5/D7 dependencies; they cannot remain production-composition details deferred to Stage 3.

- **MATERIAL — D8 should not absorb benchmark fixture machinery.** D8 is defined as hosted qualification, yet `W-FIXTURE` says D8 may standardize the resumable bulk loader. The loader and its overlays are D1 evidence infrastructure unless Snapback intentionally claims a production import capability. Keep fixture compilation, reset, and receipt infrastructure under D1; let storage/runtime defects discovered by it route to their actual owners; and reserve D8 for qualifying a selected target. D7 can remain the composition umbrella, but identity, routes, effects, and assets need named subowners plus one integration contract rather than becoming a catch-all.

- **MATERIAL — Refusal-union and whole-program ownership remain too thin for acceptance.** The revision history says refusal-union ownership was added, but the body defines only stable individual refusals and closed application refusals; it never defines how D2–D8 refusals union, which reason wins, how dependency-caused GAPs differ from root refusals, or who certifies complete demand coverage. “Supervising agent sessions” is an execution pattern, not durable program ownership. Add a normative coverage graph keyed by frozen demand IDs, with one owner, dependency edges, output capability/refusal fact, rollup rule, and author gate for every leaf. Also resolve which D3 classes are minimally required for the whole-app and ratified-improvement claims; the present “every class required by the claim” is circular.

- **MINOR — The umbrella still contains current implementation detail that will rot.** D5’s exact `Date.now()` operation list, Lane L/Lane Q behavior, and current source-id limitations belong in LLP 0182, the inventory, or owner evidence. References to `result-transform.v1`, the current fragment store, likely verb shapes, and D6’s candidate JSON-path mechanism should be versioned baseline pointers or owner-Spec questions. Retain the durable requirements—trusted time, provisional identity, bounded deterministic writes, compatibility, and safe refusal—without freezing today’s lane vocabulary in the charter.

## Suggestions

- Replace the long mutable “Status” narrative with a short pointer to a machine-generated program index and append-only author rulings.

- Give every receipt an explicit predecessor/supersession field and a claim-relevant digest scope; pinning the entire mutable `PLAN.md` causes irrelevant prose changes to rotate evidence identity during concurrent work.

- Rename the ZB2 restart check to `browser-auth-custody-restart-online-render` so its PASS cannot be mistaken for retained-query support.

- Report the eventual advantage as a scoped sentence rather than a scalar product verdict, even if the RFC retains “better” as shorthand.

- Add an explicit “discovered platform defect routing” rule so benchmark findings are assigned immediately without inventing a new D-workstream or leaving an interface failure between two owners.

## Open questions

- Have the repeated Zero/control variability trials required for `acceptance.v2` begun or completed, and is any capability implementation already underway?

- Did all 16 hot-v8 mutations commit and converge as the issue narrative says, or did the early assertion prevent execution/accounting as the receipt’s empty sample arrays imply?

- Which artifact is intended to be the canonical frozen v1 prose contract after the post-receipt amendment?

- Who owns the joint live-stream contract, principal/application identity mapping, and client-to-effect settlement identity?

- Which exact D3 authority/projection classes are required to support `issue.create`, `comment.add`, restart reconstruction, and revocation for the ratified advantage?

## Recommended next step

**revise-and-stay-Draft** — the core program is worth preserving, but the benchmark freeze, stage contract, receipt algebra, and cross-workstream ownership seams need correction before foundational acceptance.
