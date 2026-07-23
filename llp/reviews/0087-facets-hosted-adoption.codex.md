**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0 (`codex exec`, read-only sandbox), invoked from the orchestrating /llp-super-refine Claude session; the orchestrating session did not author the document and Codex had no access to the concurrent Fable-family round or to llp/reviews/
**Date:** 2026-07-23
**Redacted:** no — repo-local review; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner (fresh context per round; prompt pinned the document sha256 and repo HEAD)

# LLP 0087 reviews — Codex (OpenAI) family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0087-facets-hosted-adoption.plan.md`, sha256 `bced14cc5ef13078f8392bd61a9c696d1ef780fdf8802a63d40905b07c6123f5` (untracked working-tree file at HEAD `56534268`; both MATCH per the reviewer's own revision check).
**Runtime detail:** token usage not captured this round (log tail truncated); reviewer cited LLPs 0014, 0018, 0024, 0047, 0048, 0049, 0083, 0086 and `cloudflare/wrangler.jsonc`, `cloudflare/wrangler.all-aboard.jsonc`, `cloudflare/test/local-suite-manifest.mjs` in its findings.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `bced14cc5ef13078f8392bd61a9c696d1ef780fdf8802a63d40905b07c6123f5` — **MATCH**
- Repository HEAD: `56534268` — **MATCH**

## 2. Overall assessment

The plan has the right strategic posture: Facets remains a beta, the end state is explicitly conditional, and the phased approach preserves the existing profile while buying evidence. Its Cloudflare facts are consistent with LLP 0083, and it identifies most of the correct investigation dimensions.

It is not yet executable as a Plan, however. Gate 0 contains subjective predicates without thresholds or named evidence artifacts; its Miniflare language is internally contradictory; the selected notes fixture cannot test the load-bearing action-isolation question; and several proposed decisions conflict with governing LLPs. In particular, LLP 0014 already decides the registry location and data/version co-location, LLP 0024 expressly excludes hosted project lifecycle, and LLP 0086 says hosted rearchitecture does not start while Facets remains beta.

The current-implementation inventory has also drifted: the canonical local suite has 21 gates, not 20, and only All Aboard has the three-service topology.

## 3. Strengths (cite sections and line numbers)

- The Summary honestly distinguishes a target from a commitment and makes every phase killable or reshapeable while the primitive remains beta (lines 19–27).
- The Plan correctly preserves LLP 0014’s everything-on-Durable-Objects decision and identifies code delivery—not the durable-storage substrate—as the premise being reconsidered (lines 29–31).
- The topology section preserves the coordinator/action isolation issue as a first-class constraint rather than assuming colocation is safe (lines 55–71). This matches LLP 0049’s requirement that slow action fetches not block transactional work.
- Phase 0 measures the right broad categories: isolation, storage, economics, lifecycle/version skew, and local-development parity (lines 86–106). These align well with LLP 0083’s beta unknowns and sharp edges.
- Phase 1 retains the existing profile and demands stable diagnostics for missing artifacts, hash mismatches, and loader failures (lines 116–134), providing a sensible rollback and comparison surface.
- The risk section is candid about beta churn, proprietary lock-in, action-isolation regression, and live-system migration risk (lines 160–177).
- Dynamic Workflows is correctly excluded and left under LLP 0070 rather than being smuggled into this adoption plan (lines 179–184).

## 4. Concerns (numbered; each with severity Major/Moderate/Minor and a concrete resolution that would clear it)

1. **Major — Gate 0 is not mechanically decidable.** “Isolation review passes,” “storage semantics confirmed sufficient,” “within the LLP 0014 cost model,” and “credible committed path” have no enumerated tests, thresholds, required artifacts, or decision authority (lines 108–114). LLP 0014 records prices and advises measurement, but does not define an acceptable cold-start or cost ceiling. Two executors could reasonably reach different verdicts from the same measurements. There is also a direct contradiction: lines 103–106 say “no Miniflare support, no adoption,” while Gate 0 permits proceeding on a merely “credible committed path” (line 111).

   **Resolution:** Define a Gate 0 receipt or checklist containing the exact topology matrix, required local and real-platform probes, stable expected results, numerical cold-start and cost budgets, required storage behaviors, and the named ratifier for residual security risk. Choose either actual Miniflare support as a hard gate or a precisely defined committed-path exception with owner, delivery issue, deadline, and a prohibition on advancing beyond a stated phase.

2. **Major — The Phase 0 fixture cannot test a load-bearing requirement.** Phase 0 specifies the notes app (line 86) while requiring proof that coordinator/action separation survives topology A (lines 88–93). Notes has only gateway and handler services (`cloudflare/wrangler.jsonc`, lines 24–31); the separate action handler exists only for All Aboard (`cloudflare/wrangler.all-aboard.jsonc`, lines 34–38). The proposed spike therefore cannot exercise slow action fetches, egress gating, or action/transactional non-blocking behavior.

   **Resolution:** Use All Aboard for the topology/isolation leg, or add an explicit action/slow-egress probe to notes. Gate 0 should require the existing “slow action does not block query, mutation, or live push” acceptance behavior from LLP 0049, not merely describe the separation qualitatively.

3. **Major — The topology candidates do not pin LLP 0014’s storage invariant.** Topology A gives handler and action facets separate SQLite databases while leaving the coordinator as version authority and journal owner (lines 61–63). Gate 0 then asks whether “per-facet storage semantics” suffice for the coordinator contract (lines 94–96, 109–110), leaving unclear whether app rows might move into a facet. LLP 0014 lines 217–229 and 470–472 require app rows, version allocation, and journal append to remain in one write-owning DO database and one transaction. Moving rows into a handler facet would reopen a ratified one-way door; leaving them in the coordinator makes most facet-storage testing non-load-bearing.

   **Resolution:** State explicitly that all candidates retain app rows, version counter, journal, outbox, cron state, and subscriptions in the coordinator’s SQLite, with facets accessing them only through the async host-operation seam. If moving data ownership is genuinely a candidate, identify it as a separate re-ratification of LLP 0014 and add atomic-commit evidence appropriate to that decision.

4. **Major — Dependencies and authority boundaries are represented incorrectly.** LLP 0024 explicitly says it does not own hosted control planes, tenants, or project lifecycle (LLP 0024 lines 84–92), yet this plan assigns hosted create/push/rollback operations to the “LLP 0024 surface” (lines 73–77, 138–140). LLP 0086 makes CC-1 review-gated and says LLP 0010/0024 must be revised before that provisioning surface exits. Separately, LLP 0086 lines 117–124 says no hosted rearchitecture starts while Facets is beta, while this plan begins building a new target profile in Phase 1 and defers GA/risk acceptance until Gate 2.

   **Resolution:** Make revised-and-reviewed provisioning contracts an explicit Phase 2 prerequisite, naming the owning LLP for hosted lifecycle and the required LLP 0010/0024 amendments. Reconcile LLP 0086 by either limiting Phase 1 to a disposable experimental profile or revising LLP 0086 to authorize dual-track implementation during beta.

5. **Major — Phase 2 omits the governing multi-app isolation gate and asks an already-decided registry question.** The end state is one platform serving multiple apps, but Phase 2 and Gate 2 do not require LLP 0018’s two-app isolation matrix. LLP 0014 already requires a registry Durable Object and gateway cache (lines 230–264, 397–403), while open question 4 asks whether the registry belongs in the coordinator, a platform DO, or R2 (lines 196–198). That question is not open absent an explicit LLP 0014 revisit trigger.

   **Resolution:** Fix the registry to LLP 0014’s platform registry DO unless this Plan explicitly proposes re-ratification. Add LLP 0018’s complete two-app validation list to Phase 2/Gate 2: code/schema isolation, version streams, auth, secrets, subscriptions, diagnostics, admin operations, reset/seed/import/export, and per-app resource accounting.

6. **Major — Gate 2 puts production migration before the beta-risk decision.** Gate 2 requires Facets GA or ratified beta-risk acceptance and also requires live apps already migrated (lines 147–149). Thus a deployment may migrate live systems before establishing the condition that permits production use. “Stable” also has no observation period or measurable definition.

   **Resolution:** Split Gate 2 into an entry gate and exit gate. Before migration, require GA or named-authority beta-risk acceptance plus rollback readiness. After migration, require a defined soak interval, workload, error budget, real-meter cost envelope, and successful rollback/restore rehearsal.

7. **Moderate — Claims about the current implementation and suite inventory are inaccurate.** The plan says the local suite has 20 gates (line 104), but `cloudflare/test/local-suite-manifest.mjs` declares 21. It describes three per-app services as the general current model (lines 35–45), but notes has two services; All Aboard alone has the action-handler third service. “Every gate in the local and remote suites” is also underspecified because the local suite has a canonical manifest while remote scripts are separately credentialed and not one comparable gate inventory.

   **Resolution:** Update the count and describe the deployment accurately as two services for notes and three for All Aboard. Name the exact local and remote commands, fixtures, expected check counts, credentials, and required machine-readable outputs for each phase.

8. **Moderate — Artifact security and fleet isolation are under-scoped.** A content hash detects corruption but does not authorize who may publish code, prevent rollback to a vulnerable artifact, establish provenance, or protect the shared platform from one app’s concurrency/memory/request volume. LLP 0009 and LLP 0047 require enforced isolation and identify aggregate fairness as a hosted-product gap, but the Plan mentions only “quota and abuse posture per LLP 0018” (lines 144–145).

   **Resolution:** Add a risk/workstream covering authenticated artifact admission, immutable provenance, anti-rollback policy, schema/code compatibility, deletion/PITR behavior, per-app concurrency and queue ceilings, shared-platform blast radius, and enforced resource-limit evidence.

9. **Minor — Citation metadata and ownership need cleanup.** The body cites LLP 0007 and LLP 0049, but neither appears in `Related` (line 8). LLP 0048 owns harness and compatibility-config single-sourcing, not general stored-artifact “version pinning” as phrased at lines 122–124. LLP 0033 is an accepted licensing decision about MIT/free-riding, not the natural owner of Cloudflare substrate lock-in.

   **Resolution:** Add LLP 0007 and LLP 0049 to `Related`; narrow the LLP 0048 claim to harness/compatibility single-sourcing; and record proprietary-substrate lock-in primarily in LLP 0014/0087, cross-referencing LLP 0033 only for the openness narrative.

## 5. Suggestions

- Give each topology a compact wiring table covering deployment unit, app-code loader, database owner, version authority, host-call route, egress boundary, kill domain, and local emulator.
- Require Phase 0 to emit a machine-readable comparison artifact so Gate 0 is reproducible rather than a prose judgment.
- Separate platform facts from acceptance policy: measured billing mechanics belong in findings, while acceptable cost and latency budgets require an explicit product decision.
- Replace the uncontrollable Phase 3 condition “one platform-beta-churn event” (lines 157–158) with a reproducible compatibility drill against two pinned API/runtime versions or a documented provider-change rehearsal.
- Clarify whether topology B’s handler/action services are shared platform services or remain per-app services; the latter would not achieve the stated one-platform control-plane simplification.

## 6. Open questions

1. Is Phase 1 intended to be disposable research, or production-shaped implementation that requires revising LLP 0086’s beta prohibition?
2. Which exact principal is authorized to publish or roll back an app artifact, and what signed or otherwise authenticated receipt proves that authorization?
3. Does a facet provide a per-invocation kill domain, or only a per-app/class isolate whose persistent global state must be reset between invocations?
4. How will old and new app artifact versions coexist with coordinator schema and host-operation protocol versions during update skew and rollback?
5. What quantitative cold-start, billed-duration, row-write, and storage thresholds constitute “within the LLP 0014 cost model”?

## 7. Verdict — NOT READY

An executor can begin the ENG-25387 fact-maintenance step, but cannot run the intended spike and determine Gate 0 from this document alone with reproducible agreement. The Plan needs mechanical gate criteria, a capable fixture, reconciliation with LLP 0014/0024/0086, and explicit multi-app and artifact-security requirements before Phase 0 is executable as written.

## Round 2 — 2026-07-23

**Revision under review:** `llp/0087-facets-hosted-adoption.plan.md`, sha256 `0812e1acefb54ea17ecd03a8d5c261d37e63c7793169da6886386f11edb649c2` (untracked working-tree file at HEAD `99e8e993`; both MATCH per the reviewer's own revision check). Round-1 revisions applied; a concurrent fleet session had begun executing the Phase 0 spike (`cloudflare/spike-facets/`) and its progress note was folded into the document between rounds.
**Runtime detail:** token usage not captured (log tail truncated); reviewer inspected the spike source and README but could not rerun the spike (sandbox denied Miniflare's loopback listener; Node 25 vs the repo's pinned 24.18.0) and treated its recorded outputs as repository evidence, not independently reproduced evidence. Findings cite LLPs 0009, 0011, 0014, 0018, 0019, 0024, 0048, 0060, 0086 and `cloudflare/` sources including the wrangler configs, `deploy.sh`, `src/host-ops.js`, `src/gateway.js`, `src/coordinator.js`, `test/local-suite-manifest.mjs`, and the remote acceptance runners.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `0812e1acefb54ea17ecd03a8d5c261d37e63c7793169da6886386f11edb649c2` — **MATCH**
- Repository HEAD: `99e8e993` — **MATCH**

I did not read anything under `llp/reviews/` or any secret-bearing file. No files were modified.

## 2. Overall assessment

The revision is materially stronger: its authority boundaries generally match the cited LLPs, its description of the current hosted implementation is mostly accurate, and the progress note is careful not to overclaim what the micro-spike proves.

It is still not executable enough for a Plan. Gate 0 lacks a complete decision procedure, Gate 1 names the wrong remote test programs, and Gate 2 permits live migration before several security and multi-app requirements are explicitly satisfied. The hosted authorization dependencies are also incomplete, and the proposed fallback points to the wrong implementation surface.

I inspected the spike source and README. I could not independently rerun it because this review environment denied Miniflare’s loopback listener and supplied Node 25 rather than the repository’s pinned Node 24.18.0; therefore I treat its checked-in source and recorded output claims as repository evidence, not independently reproduced evidence.

## 3. Strengths

- The ratification posture is precise and consistent with LLP 0014. It preserves door 1’s one-transaction storage invariant, identifies door 2 as the only door being reconsidered, and requires re-ratification in LLP 0014 rather than treating this Plan’s gate as sufficient authority (§Summary, lines 34–57).

- The target architectures consistently keep rows, versions, journal, outbox, cron, and subscription state in the coordinator. The registry-DO decision is correctly attributed to LLP 0014, and the distinction between registry metadata and artifact bytes is explicit (§Target architecture, lines 84–114).

- The current topology is accurately described: notes uses gateway/coordinator plus handler; All Aboard adds the separate action handler; and all use the deploy-time `snapback-app` alias (§Motivation, lines 61–74). This matches the Wrangler configurations and `deploy.sh`.

- The authorization sequence for Phase 1 correctly recognizes both LLP 0014 door-2 re-ratification and LLP 0086 CC-2 amendment/discharge as decisions owned elsewhere (§Phases and gates, lines 118–125; §Phase 1, lines 227–234).

- The local-suite inventory is accurate: 21 manifest entries consisting of the compatibility check plus 20 gate suites (§Phase 0, lines 184–192). The proposed deployment-identity split also correctly distinguishes the current combined bundle identity from future platform-harness and per-app artifact identities (§Phase 1, lines 236–244).

- The LLP authority claims are generally sound. LLP 0024 excludes hosted control planes and project lifecycle; LLP 0018 supplies the stated two-app correctness matrix; LLP 0048 owns harness and compatibility-config single-sourcing rather than artifact versioning; and LLP 0086 CC-2 supplies the beta prohibition. The Related header contains every LLP cited in the body (§Header, line 9).

- The progress note is appropriately scoped. It records only micro-spike evidence and leaves real-platform behavior, lifecycle migration semantics, and LLP 0009 review open (§Phase 0, lines 129–141).

- Artifact admission, provenance, anti-rollback, multi-app accounting, and live rollback are recognized as first-class risks rather than afterthoughts (§Phase 2, lines 277–316; §Risks and mitigations, lines 330–358).

## 4. Concerns

1. **Major — Gate 0 is not yet a reproducible decision procedure.**
   Gate 0 requires findings “per topology” and a machine-readable comparison artifact, but it does not define that artifact’s path, schema, required fields, commands, or treatment of a topology deemed non-viable (§Gate 0, lines 194–225). Its storage criterion—“confirmed intact” and “suffices”—is qualitative. Its economics criterion lacks sample count, cold-start definition, billing period, cost denominator, meter-attribution procedure, and an exact reference workload. Lifecycle and code-version skew are required measurements in Phase 0 but have no pass/reshape/kill criterion. The Plan also calls the spike time-boxed while leaving its owner and time box open (§Open questions, lines 384–388).

   **Resolution:** Define a committed Gate 0 receipt schema and location with one row for A, B, and C; exact commands, toolchain identity, baseline and candidate profiles, sample sizes, billing windows, mandatory lifecycle outcomes, and enumerated `pass|reshape|kill|not-viable` results. Name the spike owner, LLP 0009 reviewer, and time box. Permit `selectedTopology: null` when the result is kill.

2. **Major — Gate 1 names local Miniflare suites as remote acceptance scripts.**
   The Plan calls `acceptance.all-aboard.mjs` and `acceptance.egress.mjs` “remote acceptance scripts” to run against a deployed instance (§Phase 1, lines 245–253). Both start the local Miniflare harness. The actual deployed-instance runners are `acceptance.remote.mjs` and `acceptance.remote.all-aboard.mjs`; there is no separately named remote egress runner. Consequently, two executors cannot run Gate 1 as written.

   **Resolution:** Name the actual commands, required environment variables, and expected check counts for each remote runner. State which remote suite proves ambient denial and slow-action non-blocking on the facets deployment, adding a dedicated remote egress suite if the existing All Aboard runner does not cover both.

3. **Major — The Phase 2 authorization prerequisites and fallback implementation surface are incomplete.**
   The Plan says LLP 0010/0024 revisions are sufficient before external exposure and proposes adding fallback operations to `cloudflare/src/host-ops.js` (§Phase 2, lines 267–275). LLP 0024 itself says hosted use remains refused pending LLP 0060’s hosted-auth deployment contract and LLP 0019’s durable audit gate; LLP 0009 independently makes LLP 0060 conjunctive for hosted readiness. Moreover, `cloudflare/src/host-ops.js` is the handler-to-coordinator database/runtime operation table, not the HTTP admin surface. Existing admin-token routes live in `gateway.js` and `coordinator.js`.

   **Resolution:** Enumerate the full hosted authority prerequisites, including LLP 0060, durable audit requirements, and the applicable LLP 0011 service-principal work. Replace the `host-ops.js` reference with the correct gateway/coordinator admin projection and its DTO/route owner. Define “non-public” mechanically—network reachability, authentication, profile restriction, and capability reporting—not merely as a label.

4. **Major — Gate 2 entry does not actually gate the Phase 2 security and isolation work.**
   Gate 2 entry requires only GA or risk acceptance plus a rollback rehearsal (§Phase 2, lines 306–310). Artifact admission/provenance/anti-rollback, the two-app matrix, per-app fairness, operational recovery, and observability appear earlier as bullets, but are not made entry conditions. An executor following the literal gate could begin live migration before those items are complete. Gate 2 exit is also under-specified: “normal All Aboard traffic,” “facets-attributable,” and the existing error-rate baseline are not defined (§Phase 2, lines 312–316).

   **Resolution:** Make Gate 2 entry conjunctively require contract acceptance, artifact-security tests, the multi-app isolation receipt, enforced per-app concurrency/queue ceilings, PITR/observability readiness, migration tooling, GA/risk acceptance, and rollback rehearsal. Pin the soak baseline window, traffic source, error metrics, attribution rule, and cost receipt used by Gate 2 exit.

5. **Major — The core multi-app adversarial-isolation question is deferred beyond Gate 0 and is not covered by LLP 0018’s matrix.**
   Gate 0’s isolation checks cover ambient denial, the `HOST` envelope, and slow-action blocking, but not two simultaneously loaded apps/facets, global-state separation, loader-name collisions, artifact/cache confusion, cross-app binding attempts, or noisy-neighbor behavior (§Phase 0, lines 155–163; §Gate 0, lines 198–204). Phase 2 invokes LLP 0018’s two-app matrix (§Phase 2, lines 289–304), but LLP 0018 explicitly says that matrix proves correctness against bugs and accidents, not adversarial tenant isolation. This leaves a load-bearing hosted-substrate claim untested at the topology-selection gate.

   **Resolution:** Add a two-app/multi-facet adversarial leg to Gate 0 under LLP 0009, covering code, global state, storage, bindings, loader identities, host-call tokens, resource contention, and termination blast radius. Retain LLP 0018’s matrix in Phase 2 as the separate correctness proof.

6. **Moderate — Phase 1 requires stored artifacts before their storage and admission boundary is chosen.**
   Phase 1 requires runtime-loaded, content-hashed stored artifacts (§Phase 1, lines 236–253), while artifact-byte placement remains an unassigned open question and the admission/provenance work is deferred to Phase 2 (§Phase 2, lines 277–288; §Open questions, lines 377–383). A remotely deployed non-production profile still needs a defined source, immutability rule, and authorization boundary.

   **Resolution:** Make artifact-byte placement a Phase 1 entry decision, or define a deliberately temporary fixture-only store. Phase 1 should deny remote publishing, prove content-addressed immutability, and document who can mutate the fixture before any deployed loader consumes it.

7. **Moderate — Phase 0 step 1 is marked done while part of its stated output remains outstanding.**
   The progress note and numbered step say the LLP 0014 refresh is done, then immediately require folding the new Dynamic Workers pricing and GA findings into LLP 0014 (§Phase 0, lines 129–147). The current LLP 0014 still describes Loader/Facets as beta and does not include the progress note’s published Dynamic Workers pricing. “Done” therefore describes only the earlier fact refresh, not the whole step as now written.

   **Resolution:** Split step 1 into a completed original refresh and a pending follow-up for pricing/GA evidence, with an owner and completion criterion, or change its state to partially complete.

## 5. Suggestions

- Add a canonical gate-evidence receipt containing repository SHA, artifact hashes, Node/Miniflare/workerd versions, compatibility date, Wrangler versions, commands, timestamps, topology, and raw evidence locations.

- Distinguish the completed “micro-spike” from the full Phase 0 topology spike throughout; this would make the progress note’s relationship to the pre-review LLP 0009 sign-off unambiguous.

- Require every external platform-status claim, especially GA status and pricing, to be recorded in LLP 0014 with dated provenance before it affects a gate.

- State whether topology B remains a legitimate end state if shared handler services cannot provide per-app termination and queue isolation; currently only the per-app-deployment failure case is explicit.

- Add a provider-side artifact deletion, corruption, and registry/R2 partial-failure exercise alongside missing-artifact and hash-mismatch tests.

## 6. Open questions

1. Who is the named Phase 0 owner, who is the independent LLP 0009 reviewer, and what is the actual time box?
2. Which deployed-instance test proves the slow-action-non-blocking and ambient-denial behaviors required by Gate 1?
3. Will Phase 1 use registry-DO SQLite, R2, or a deliberately temporary fixture store for artifact bytes?
4. What exact authority can ratify beta production risk acceptance at Gate 2?
5. What dataset and observation window define the existing All Aboard error-rate and cost baselines?
6. Must Gate 0 reject any topology that cannot provide per-app kill, memory, concurrency, and queue domains, or may those remain Phase 2 work?

## 7. Verdict — NOT READY

An executor can continue the exploratory micro-spike, but cannot evaluate Gate 0 reproducibly from this document alone. Gate 1’s remote commands are incorrect, and Gate 2 does not mechanically prevent live migration before its security and multi-app prerequisites are satisfied.

## Round 3 — 2026-07-23

**Revision under review:** `llp/0087-facets-hosted-adoption.plan.md`, sha256 `a5baec5a128610741d01b2e0183760794eea4e8d43ee4cdaf211da5fe1f96344` (untracked working-tree file at HEAD `d408d3fd`; both MATCH per the reviewer's own revision check). Round-2 revisions applied.
**Runtime detail:** token usage not captured (log tail truncated); findings cite the plan's sections by line, LLPs 0009, 0011, 0014, 0018, 0019, 0024, 0047, 0060, 0086, and `cloudflare/` sources including the wrangler configs, `deploy.sh`, the coordinator's `/evict` endpoint, `src/host-ops.js`, the remote runners, and the spike directory.
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Revision check

- Document SHA-256: `a5baec5a128610741d01b2e0183760794eea4e8d43ee4cdaf211da5fe1f96344` — **MATCH**.
- Repository HEAD: `d408d3fd` — **MATCH**.

## 2. Overall assessment

The revised plan is repository-faithful, appropriately cautious about trusted versus untrusted code, and substantially better specified than a typical exploratory adoption plan. Its authorization ordering, current-topology description, and treatment of the Phase 0 micro-spike are sound.

It is not yet executable enough for READY. Gate 0 still lacks a deterministic decision procedure around topology viability, measurement methodology, and outcome assignment; its owner and time box remain explicitly unresolved. There is also an internal contradiction in allowing the non-production, same-gateway admin-token fallback to satisfy Gate 2 entry before a live migration. Gate 1 and Gate 2 have named evidence surfaces, but several exit predicates remain review judgments rather than independently reproducible checks.

## 3. Strengths (cite sections and line numbers)

- The ratification posture is unusually precise. Door 1 remains intact, facet storage is explicitly role-local, and all app rows and commit authority remain in coordinator SQLite (§Summary, lines 34–46). Door 2 is correctly treated as still ratified until LLP 0014 itself changes, rather than silently overridden by this Plan (§Summary, lines 47–54). This matches LLP 0014’s premise-change annotation and one-way-door ownership.

- The trusted-code boundary is stated correctly (§Summary, lines 58–65). The Plan does not confuse V8/facet isolation with authorization to host hostile tenant code, preserves LLP 0009/0047’s `Enforced`-limits requirement, and leaves untrusted multi-tenancy with LLP 0014 Phase 3 and Workers for Platforms.

- The current deployment description is accurate (§Motivation, lines 69–82). The notes profile has gateway/coordinator plus one handler service, while All Aboard adds the separate action handler. This matches the checked-in Wrangler configurations and `deploy.sh`.

- The three topology candidates preserve the correct storage and async-host-operation invariants (§Target architecture, lines 92–117). Topology B also correctly recognizes that retaining per-app services would fail the Plan’s one-platform motivation.

- The progress note is appropriately bounded (§Phase 0, lines 140–154). The spike really does demonstrate runtime-supplied code, facet SQLite separation from the supervisor, abort/delete behavior, and `globalOutbound: null`. The Plan correctly classifies it as reconnaissance rather than Gate 0 evidence (§Gate 0, lines 236–241).

- The current suite inventory is represented accurately (§Phase 0, lines 210–218): the manifest contains 21 checks, comprising compatibility plus 20 local gates. The Plan also correctly names the two existing remote runners and correctly says no remote egress runner exists (§Phase 1, lines 299–310).

- The control-plane/handler seam distinction is correct (§Phase 2, lines 331–345). `cloudflare/src/host-ops.js` is the app-code-accessible handler host-operation implementation, not a lifecycle administration surface. The coordinator’s existing `adminGated` and `adminReadGated` paths are token-gated and forwarded by the gateway as claimed.

- Artifact security is not treated as merely a content-hash problem. Phase 1 deliberately uses a temporary fixture-only store (§Phase 1, lines 283–289), while Phase 2 names publisher authority, provenance, anti-rollback, and schema/code compatibility as live-adoption prerequisites (§Phase 2, lines 352–364).

- The Plan correctly distinguishes LLP 0018’s cooperative correctness matrix from adversarial runtime isolation (§Phase 0, lines 183–189; §Phase 2, lines 365–380). That distinction matches LLP 0018’s own claim boundary.

- Gate 2 is split into entry and exit, and entry is conjunctive (§Phase 2, lines 382–403). Migration tooling, rollback rehearsal, production-risk authorization, multi-app evidence, observability, and artifact admission all precede live migration.

## 4. Concerns

1. **Major — Gate 0 still has no deterministic topology outcome function.**

   The receipt has a name and field inventory (§Gate 0, lines 220–228), but the Plan does not define when a topology receives `pass`, `reshape`, `kill`, or `not-viable`, how “each viable topology” is selected before testing (§Phase 0, line 166), or how `selectedTopology` is chosen if multiple rows pass. Storage “suffices,” lifecycle “unworkable,” and isolation reviewer sign-off are not reduced to recorded pass/fail fields. Two executors could run similar evidence and classify the same topology differently.

   **Resolution:** Define a versioned JSON Schema and validator command for `gate0-facets-comparison.json`. Give every Gate 0 criterion a closed outcome, required evidence references, and failure mapping. Define the pre-test `not-viable` rule and an explicit topology-selection rule, including ties and the conditions producing overall `reshape` or `kill`.

2. **Major — Gate 0’s economics procedure can move or measure the goalposts differently.**

   The numerical budgets are useful, but they are “re-pinnable at gate time” (§Gate 0, lines 247–257). That permits changing the threshold after observing results. The reference workload is also ambiguous: “one full acceptance-suite run” does not name which local or remote runner, request counts, setup/reset treatment, account plan, script set, or attribution calculation. “Forced” eviction is not defined; the existing `/evict` endpoint clears coordinator in-memory state but does not prove eviction of a loaded facet or shared loader service.

   **Resolution:** Freeze budgets before measurement, with later changes requiring a pre-measurement Plan/LLP 0014 amendment. Name exact baseline and candidate commands, deployed scripts, account/plan facts, workload counts, billing queries, exclusion rules, measurement location, and raw receipt format. Define a facet/loader-specific cold-start preparation that demonstrably discards the loaded runtime, rather than relying on the coordinator’s current `/evict` surrogate.

3. **Major — Phase 0 still has no owner or time box, so the Plan fails its own READY standard.**

   Phase 0 is called time-boxed (§Phase 0, line 166), but open question 4 says both owner and time box remain unresolved (§Open questions, lines 472–476). Gate 0 additionally requires an LLP 0009 reviewer before the suite-level isolation leg (§Gate 0, lines 235–241), without naming that reviewer, a due date, or the receipt location for the two sign-offs. An executor cannot determine authority, scheduling, or when the spike must stop.

   **Resolution:** Name the accountable Phase 0 owner, LLP 0009 reviewer, start/deadline or effort budget, and stop/escalation rule. Name where pre-leg probe approval and post-leg result approval are recorded.

4. **Major — The Phase 2 fallback cannot coherently satisfy Gate 2 entry as written.**

   The fallback is defined as admin-token-only, absent from the capability manifest, and enabled only on the non-production facets profile (§Phase 2, lines 340–350). Gate 2 nevertheless permits “CC-1 or the fallback” before live migration (§Phase 2, lines 382–393). Either the fallback remains non-production and therefore cannot authorize live migration, or it becomes production-reachable through the gateway, conflicting with the LLP 0060 operator-surface requirement that `/_snapback/*` be disabled on public/direct application hosts or moved to a separately trusted operator origin.

   **Resolution:** Remove the fallback as a possible Gate 2 entry satisfier and require an accepted hosted control-plane contract for live migration. Alternatively, specify and ratify a production operator binding/origin that satisfies LLP 0060, LLP 0011 authority, and LLP 0019 audit requirements; the current same-gateway shared-token pattern is insufficient.

5. **Moderate — Gate 1 is not fully named or independently repeatable.**

   The existing local suite and two remote runners are correctly named, but the new remote egress suite has no filename, command, credential contract, expected check inventory, or receipt (§Phase 1, lines 299–316). “No regression on the existing profile” and “beta-risk register reviewed” (§Gate 1, lines 323–327) do not specify which commands must pass or what register finding blocks advancement.

   **Resolution:** Name the new runner and its manifest classification, exact commands and environment inputs for all three remote legs, the existing-profile regression command set, and a machine-readable Gate 1 receipt. Define which beta-risk findings cause hold, reshape, or kill.

6. **Moderate — Gate 2’s evidence predicates remain too subjective for independent agreement.**

   “PITR/observability operational,” “matrix receipt,” “migration tooling built,” “normal All Aboard traffic,” “error rates within baseline,” and facets-attributable failure (§Phase 2, lines 382–403) lack named commands, artifact paths, metrics, or numerical tolerances. The attribution heuristic helps, but two operators could still reach different exit decisions.

   **Resolution:** Name the Gate 2 receipt paths and rehearsal commands; define PITR restore and observability checks; specify baseline and soak traffic windows, error metrics and tolerated deltas; and define successful migration and rollback postconditions, including artifact version, coordinator state, version continuity, and client behavior.

7. **Moderate — The production artifact threat model remains incomplete.**

   Phase 2 covers publisher authority, provenance, anti-rollback, and compatibility (§Phase 2, lines 352–364), but it does not explicitly gate cross-app artifact substitution, registry-to-byte-store TOCTOU, verification on every load/cache fill, artifact confidentiality, deletion/tombstone/retention policy, or compromise recovery for a publishing principal. The Gate 0 adversarial cache-confusion probe is useful but does not replace the production artifact lifecycle contract.

   **Resolution:** Add a Phase 2 artifact-security matrix covering immutable app/version/hash association, verify-before-execute on every source and cache path, cross-app substitution, concurrent update races, publisher revocation, audit durability, confidentiality/access controls, deletion and retention, and recovery from compromised credentials.

## 5. Suggestions

- Add LLP 0011, LLP 0019, and LLP 0060 to the `Related` metadata because they are explicit Phase 2 prerequisites.

- Remove the author’s topology-C instinct from open question 1 (§Open questions, lines 457–459), or record it as a pre-registered hypothesis. Leaving it beside an evidence gate risks biasing topology selection.

- Clarify that the Gate 0 “adversarial” leg is defense-in-depth for shared trusted operator code and does not graduate `hosted_untrusted_code`.

- Record the exact Node/Miniflare/workerd identity automatically in every Gate 0 and Gate 1 receipt, rather than relying on prose transcription.

- Add explicit provider-outage and facet-runtime rollback behavior to the risk section, including what happens when an artifact is valid but temporarily unavailable.

## 6. Open questions

- Open question 1 is not an author decision that should remain open during execution; topology selection is Gate 0’s evidence-driven output.

- Open question 2 contains two executor evidence tasks, not discretionary design questions. They belong in the Gate 0 checklist and LLP 0014 fact-refresh receipt.

- Open question 3 is a legitimate Phase 2 design decision, but it needs an owner, deadline, and criteria beyond size caps—particularly integrity, latency, availability, confidentiality, and lifecycle behavior.

- Open question 4 is a present blocker. Phase 0 cannot be considered executable from this document alone while its owner, reviewer, and time box are unresolved.

## 7. Verdict — NOT READY

**NOT READY.** The Plan is technically well grounded and accurately describes the repository, but an executor cannot yet run Phase 0 and evaluate Gate 0 from this document alone. Gate 0’s classification and measurement procedures, Phase 0 ownership/time box, and the Gate 2 control-plane fallback contradiction require resolution.
