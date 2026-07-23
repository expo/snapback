**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-23
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0075 reviews — GPT family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0075-convex-checkpoint-protocol.spec.md`, sha256 `bcdc0352a2294046c0a10b802d78f4c52d870df4f5ebd918188a24cf7a4e866a` (untracked file at repo HEAD `4a1024a7`)
**Runtime detail:** codex session id 019f8dd4-6997-7a42-97cb-522813c083b4, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Working web search: all nine comparator-inventory sources in protocol.v0.json were fetched from official Convex documentation 2026-07-23, stated as such in the body.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — **MATCH**. `shasum -a 256 llp/0075-convex-checkpoint-protocol.spec.md` returned `bcdc0352a2294046c0a10b802d78f4c52d870df4f5ebd918188a24cf7a4e866a`; `git rev-parse --short HEAD` returned `4a1024a7`.

2. **Overall assessment**

This is a good idea with a strong overall shape. It narrows the claim to one fixture, preserves raw evidence, separates product completeness, cost, and evidence confidence, and refuses to turn local or deterministic proofs into hosted capability claims. The authority split and prospective change-control discipline also agree with the governing documents.

However, it is not yet a sound executable preregistration. The machine-readable authority contains a noncanonical target-profile identity, omits material prose requirements, is not content-bound by the reviewed pin, and leaves important metrics, scoring rules, and outcomes open to adjudicator judgment. The prompt, scaffolds, agent policy, authentication setup, frontend hosting boundary, and statistical implementation are asserted as pinned without actually being identified.

The direct author decision is provenance-honest and the repository evidence supports a conservative project-readiness disposition of `reprioritize`. It does not yet support treating that result as mechanically derived from this frozen protocol. These are substantive defects, not objections to direct author ratification itself.

3. **Strengths**

- The authority division is coherent: LLP 0075 limits itself to fixture, measurements, margins, and checkpoint adjudication, while LLP 0063 retains sequencing/evidence authority and LLP 0074 defines the proposed competitive classification (`llp/0075-convex-checkpoint-protocol.spec.md:43-56`; `llp/0063-partitime-platform-roadmap.plan.md:580-607`; `llp/0074-convex-competitive-strategy.rfc.md:179-204`).

- Baseline handling is disciplined. The cutoff, treatment-work rule, fresh external checkouts, and prospective two-arm correction/rollover rules agree with LLP 0063 (`llp/0075-convex-checkpoint-protocol.spec.md:58-66`; `llp/0063-partitime-platform-roadmap.plan.md:514-539`, `llp/0063-partitime-platform-roadmap.plan.md:587-599`).

- The behavioral fixture is demanding and substantially symmetric: server-derived identity, cross-user denials, durable intermediate progress, cancellation fencing, idempotent retry, ambiguous settlement, and fallback-disabled authoritative push are all explicit (`llp/0075-convex-checkpoint-protocol.spec.md:98-122`).

- The protocol corrects a known earlier unfairness. Diary 0016 admits that the gateway/polling Convex arm understated Convex, then records an idiomatic `ConvexClient` WebSocket witness using the unchanged React tree (`diaries/0016-partiful-matrix.diary.md:39-43`, `diaries/0016-partiful-matrix.diary.md:935-956`). LLP 0075 now requires isolated credentials and provider-native subscriptions (`llp/0075-convex-checkpoint-protocol.spec.md:85-88`, `llp/0075-convex-checkpoint-protocol.spec.md:182-187`).

- Capability honesty is unusually good. The Spec says passing evidence remains only evidence for proposed criteria while governing authorities are Draft (`llp/0075-convex-checkpoint-protocol.spec.md:38-41`), and implementation status keeps public npm and complete hosted evidence explicitly open (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:26-44`, `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:77-93`). Diary 0018 likewise repeatedly denies a competitive or remote-hosted win (`diaries/0018-competitive-checkpoint.diary.md:50-52`, `diaries/0018-competitive-checkpoint.diary.md:80-98`, `diaries/0018-competitive-checkpoint.diary.md:202-224`).

- The comparator refresh held up. On 2026-07-23 I fetched all nine official sources recorded at `demos/competitive-checkpoint/acceptance/protocol.v0.json:88-97`: [local deployments](https://docs.convex.dev/cli/local-deployments), [Agent Mode](https://docs.convex.dev/cli/agent-mode), [deploy](https://docs.convex.dev/cli/reference/deploy), [backup/restore](https://docs.convex.dev/database/backup-restore), [migrations](https://docs.convex.dev/database/writing-data), [indexes](https://docs.convex.dev/database/reading-data/indexes/), [Components](https://docs.convex.dev/components/understanding), [quickstarts](https://docs.convex.dev/quickstarts), and [runtimes](https://docs.convex.dev/functions/runtimes). I found no material contradiction in the inventory claims at `llp/0075-convex-checkpoint-protocol.spec.md:308-317`.

- The absence of prior model-family review is disclosed rather than laundered, and LLP 0000 identifies Charlie Cheever as the ratifying source (`llp/0075-convex-checkpoint-protocol.spec.md:280-282`; `llp/0000-snapback.explainer.md:33-45`).

4. **Concerns**

1. **Major — The frozen local target and retained receipt use the wrong profile identity.**

   The machine protocol declares `local-ibex-sqlite.v1` (`demos/competitive-checkpoint/acceptance/protocol.v0.json:16`), and the harness hardcodes that value into the retained receipt (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:238-245`; `demos/competitive-checkpoint/acceptance/results/local-streaming.v0.json:2-5`). The actual generated capability and schema manifests identify the target as `local-dev-sqlite-ibex` (`demos/competitive-checkpoint/snapback/generated/capability.manifest.json:145-147`; `demos/competitive-checkpoint/snapback/generated/schema.manifest.json:159-161`), matching the Rust authority and package receipt (`src/manifest.rs:29-33`; `demos/competitive-checkpoint/acceptance/results/package-cold-install.v1.json:62-67`).

   This is load-bearing because target identity is itself a scored confidence dimension (`llp/0075-convex-checkpoint-protocol.spec.md:240-249`). A receipt that labels the actual target with a hardcoded alias cannot provide direct reproducible target attribution.

   Resolution: preserve v0, issue a versioned instrument correction under LLP 0063, use `local-dev-sqlite-ibex`, derive and verify the receipt identity from the generated/served capability manifest, and prospectively rerun the affected witness.

2. **Major — The prose and claimed machine authority are materially incomplete and divergent.**

   The Spec calls the JSON “the machine-readable authority,” but the JSON points back to the Spec as its authority while the precedence section places both at the same level (`llp/0075-convex-checkpoint-protocol.spec.md:23-30`, `llp/0075-convex-checkpoint-protocol.spec.md:50-56`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:2-6`). No rule decides which wins when they differ.

   The JSON fixture encodes tables, three generated patterns, basic visibility, numeric stream limits, one negative actor, and disabled fallback (`demos/competitive-checkpoint/acceptance/protocol.v0.json:21-38`). It omits material prose predicates covering CRUD lifecycle, cancellation/late-patch fencing, reconnect, negative-test surfaces, backpressure, diagnostics, retry identity, and most hosted gates (`llp/0075-convex-checkpoint-protocol.spec.md:98-142`, `llp/0075-convex-checkpoint-protocol.spec.md:164-203`).

   There is also a direct margin divergence: prose makes required failures, retries, skips, and cleanup defects comparator-relative, while JSON omits the first three and sets cleanup defects to absolute zero (`llp/0075-convex-checkpoint-protocol.spec.md:221-229`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:56-67`). The required comparator inventory promises a separate maturity fact, but JSON generally records only `deliveryClass` (`llp/0075-convex-checkpoint-protocol.spec.md:299-300`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:88-97`).

   Resolution: select one normative representation, encode every outcome-affecting predicate there or bind digest-versioned gate manifests, and add a schema/parity validator that rejects prose/JSON disagreement.

3. **Major — The reviewed artifact does not actually freeze the execution inputs or metrology.**

   The Spec says each runner receives a frozen prompt, arm scaffold, pinned agent configuration, and assistance policy (`llp/0075-convex-checkpoint-protocol.spec.md:144-154`), but the JSON initial state supplies only booleans and package-source constraints (`demos/competitive-checkpoint/acceptance/protocol.v0.json:39-48`). Neither artifact identifies or digests the prompt, initial scaffold trees, model/tool configuration, documentation policy, application-auth setup, hardware/network class, or statistics implementation. Those facts are deferred to post-run artifacts (`llp/0075-convex-checkpoint-protocol.spec.md:287-302`), despite LLP 0074 requiring them to be pinned in the protocol (`llp/0074-convex-competitive-strategy.rfc.md:723-737`).

   The reviewed SHA pins only the Markdown. The protocol JSON contains no content digest, and implementation status binds only its mutable protocol ID (`demos/competitive-checkpoint/acceptance/protocol.v0.json:2-6`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:2-4`).

   Metric calculation is likewise underspecified: no exact clock events define “first local live row” or “hosted live URL”; command/token/tool-call aggregation is not stated; and seven-sample p95/bootstrap reporting has no estimator, bootstrap target, resample count, seed, invalid-sample replacement rule, or starting-arm schedule (`llp/0075-convex-checkpoint-protocol.spec.md:208-226`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:49-64`). LLP 0063 requires frozen metric definitions and formulas (`llp/0063-partitime-platform-roadmap.plan.md:484-504`).

   Resolution: content-address the Spec, JSON, prompt, both scaffolds, harness, and analysis implementation together; define exact event/accounting schemas and a complete sampling/statistics algorithm before further metric-affecting work.

4. **Major — The outcome rules do not make adjudication decidable.**

   `Reprioritize` includes “one gap dominates” and an adapter that “cannot implement the profile honestly,” neither of which has a predicate (`llp/0075-convex-checkpoint-protocol.spec.md:252-263`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:83-86`). The Spec maps hosted/npm skips to `reprioritize`, but later says a required remote skip “blocks the checkpoint outcome” (`llp/0075-convex-checkpoint-protocol.spec.md:265-285`, `llp/0075-convex-checkpoint-protocol.spec.md:304-306`). The JSON outcomes are free-text strings with no precedence for a run containing both a Stop-class defect and a dominant deployment gap, and there is no `incomplete` or `not-run` state.

   Implementation status records the decision and two skips but not the structured predicate that fired (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:5-9`, `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:77-93`). Diary 0018 supports “not currently runnable”—public npm, hosted profile, production identity, and the timed rerun remain open—but does not prove inherent Cloudflare impossibility (`diaries/0018-competitive-checkpoint.diary.md:50-52`, `diaries/0018-competitive-checkpoint.diary.md:80-98`).

   Resolution: define executable, mutually exclusive outcomes with explicit precedence, add an incomplete/readiness state, and either specify `required skip + no Stop defect => reprioritize` or call the present decision a pre-run readiness disposition rather than a checkpoint result.

5. **Major — The confidence rubric retains outcome-determinative adjudicator discretion.**

   The protocol defines eight dimensions and generic 0/1/2 labels, but no dimension-specific rule distinguishes indirect from direct reproducible evidence (`llp/0075-convex-checkpoint-protocol.spec.md:240-250`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:68-81`). Because 16/16 gates `Continue`, post-result scoring can determine the outcome.

   The arm boundary compounds this ambiguity. Snapback must use named generators and may not use handwritten validators, result types, ordinary CRUD, string names, or client-owned visibility (`llp/0075-convex-checkpoint-protocol.spec.md:124-142`); Convex need only be idiomatic, with Components admissible (`llp/0075-convex-checkpoint-protocol.spec.md:182-187`). Yet “generated owner patterns” appears inside product completeness (`llp/0075-convex-checkpoint-protocol.spec.md:231-247`). Managed-provider evidence could also be scored down merely because it differs from Snapback’s receipt vocabulary rather than because it is weaker.

   Resolution: provide an arm-equivalence table with identical behavioral oracles, a separate Snapback-only generated-boundary gate, and concrete per-arm artifact predicates for every score in every dimension. Use independent dual scoring or blinded adjudication for the confidence result.

6. **Major — Important local, hosted, and authentication asymmetries are not fixed.**

   Snapback’s local leg is local Ibex/SQLite, while Convex iteration is fixed to a cloud development deployment (`llp/0075-convex-checkpoint-protocol.spec.md:80-88`). The protocol’s own inventory records account-free local Convex (`demos/competitive-checkpoint/acceptance/protocol.v0.json:88-97`), and LLP 0074 correctly concludes local development alone is not a Snapback differentiator (`llp/0074-convex-competitive-strategy.rfc.md:299-330`). Official Convex [Local Deployments](https://docs.convex.dev/cli/local-deployments) and [Agent Mode](https://docs.convex.dev/cli/agent-mode), fetched 2026-07-23, present both local and per-agent cloud development as supported choices.

   The hosted endpoint is also unclear. React web is mandatory on the timed hosted path, but the Convex arm identifies only a Convex deployment and “idiomatic deploy commands,” not the frontend hosting provider, package, credentials, or timing boundary (`llp/0075-convex-checkpoint-protocol.spec.md:78-88`, `llp/0075-convex-checkpoint-protocol.spec.md:182-187`). I infer from the official [deploy command documentation](https://docs.convex.dev/cli/reference/deploy)—which describes pushing functions, indexes, and schema while optionally running a build command—that a separate frontend host must be pinned if “hosted live URL” means the actual React application.

   Finally, server-derived identity and two-user negative tests are central, but neither arm’s application identity provider, account creation, session flow, secret provisioning, nor timed/excluded setup is frozen (`llp/0075-convex-checkpoint-protocol.spec.md:100-116`, `llp/0075-convex-checkpoint-protocol.spec.md:146-154`).

   Resolution: use local Convex as the primary local comparator or preregister local/cloud sensitivity arms; pin the frontend host and full application-auth setup for both arms; and state exactly which provisioning actions occur before versus inside the timer.

7. **Moderate — Accepted status does not promote capabilities, but it treats mutable Draft authorities too categorically.**

   The main claim boundary correctly says Draft criteria do not close gates (`llp/0075-convex-checkpoint-protocol.spec.md:38-41`). Nevertheless, the Accepted Spec says LLP 0074 currently “owns” classification even though LLP 0074 calls itself a Draft proposal rather than a ratified decision (`llp/0075-convex-checkpoint-protocol.spec.md:43-48`; `llp/0074-convex-competitive-strategy.rfc.md:35-42`, `llp/0074-convex-competitive-strategy.rfc.md:154-177`).

   The frozen protocol also references Draft profiles without binding their revisions. LLP 0072 says its complete hosted profile remains unsupported while Draft (`llp/0072-trusted-single-tenant-control-plane.rfc.md:4`, `llp/0072-trusted-single-tenant-control-plane.rfc.md:510-519`); LLP 0065 calls its implementation a candidate (`llp/0065-generated-data-pattern-soundness.rfc.md:4`, `llp/0065-generated-data-pattern-soundness.rfc.md:174-177`); LLP 0076 says its stream gate cannot close while Draft (`llp/0076-bounded-streamed-actions.rfc.md:4`, `llp/0076-bounded-streamed-actions.rfc.md:24-25`). Their contents can therefore evolve while supposedly frozen checkpoint requirements remain path-references.

   Resolution: describe LLP 0074 as the proposed classification authority unless accepted, bind exact hashes/revisions of Draft criteria consumed by v0, and require a versioned protocol amendment when an accepted authority changes an outcome-affecting requirement.

8. **Moderate — The current generated-owner “passed” claim is broader than its witness.**

   Implementation status marks “local generated owner patterns” passed, and the receipt describes generated owner CRUD retaining negative authorization (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:10-15`; `demos/competitive-checkpoint/acceptance/results/local-streaming.v0.json:11-21`). The executable check covers list, lookup, pagination, and cross-user update, but not cross-user delete (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:70-97`). The frozen fixture and LLP 0065 both require delete refusal (`llp/0075-convex-checkpoint-protocol.spec.md:108-116`; `llp/0065-generated-data-pattern-soundness.rfc.md:156-172`).

   Resolution: add a real-server negative delete witness and regenerate the receipt, or narrow implementation status and the “locally proven generated-owner” wording at `llp/0075-convex-checkpoint-protocol.spec.md:265-272` to the exact tested subset.

5. **Suggestions**

- Generate both prose tables and JSON from one typed protocol source, with CI rejecting unknown fields, missing predicates, and prose/JSON drift.

- Publish the statistics implementation beside the protocol. With only seven samples, report the maximum explicitly or increase the sample count rather than presenting an estimator-dependent p95.

- Randomize or counterbalance the starting arm across paired runs instead of leaving alternation’s initial arm implicit.

- Have two independent scorers apply the evidence-confidence rubric and retain their dimension-level reasons before adjudication.

- Separate readiness disposition, comparison execution, and competitive classification into distinct machine-readable records.

- Give Cloudflare separate explicit `adapterId`, `adapterVersion`, `targetProfileId`, and hosted-profile fields; likewise distinguish the hyphenated gate slug in implementation status from `trusted-single-tenant-app-complete.v1`.

- Attribute the selected next tranche explicitly to LLP 0063’s sequencing decision, since the current choice agrees with LLP 0063 but LLP 0075 does not itself own sequencing (`llp/0075-convex-checkpoint-protocol.spec.md:274-285`; `llp/0063-partitime-platform-roadmap.plan.md:609-617`).

6. **Open questions**

- Which artifact is normative, and what immutable manifest binds the Spec, JSON, fixture prompt, both scaffolds, harness, analysis code, and delegated authority revisions?

- Is Convex local or cloud development the primary local-leg comparator, and what sensitivity result is required for the other mode?

- Which frontend host, identity provider, two-principal setup, plan/tier, and provisioning actions are inside each arm’s timed boundary?

- What exact artifacts earn 0, 1, or 2 for every evidence-confidence dimension in each arm, and who scores them?

- Does a required pre-run skip yield `reprioritize`, `incomplete`, or no checkpoint outcome, and what precedence applies when Stop-class evidence also exists?

- Does `Accepted` mean only that the current v0 text is author-ratified, or that it is complete enough to execute without another prerequisite amendment?

- Who becomes the long-lived program owner/operator, and who maintains comparator inventory and adjudication instruments after this session (`llp/0075-convex-checkpoint-protocol.spec.md:319-326`)?

7. **Verdict**

Verdict: NOT READY

The noncanonical target identity and incomplete, non-decidable preregistration must be corrected in a versioned, content-bound protocol before this Spec can govern a fair rerun.

## Round 2 — 2026-07-23

**Revision under review:** `llp/0075-convex-checkpoint-protocol.spec.md`, sha256 `7755c14ee1cf175d74ae522cd2171b0977726075d1852d3e4711ebfb3fdea0fd` (untracked file at repo HEAD `4a1024a7`), carrying protocol amendment v0.1 (`protocol.v0.json` sha256 `209917ba486ebfef932eb4189b4bbb703ff4ad9fd3a3f7f412967ba0f83ae8da`)
**Runtime detail:** codex session id 019f8de4-795e-74f0-b155-a39a6c5d4c1a, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Working web search: the nine comparator-inventory sources were re-fetched from official Convex documentation 2026-07-23.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH. `shasum -a 256 llp/0075-convex-checkpoint-protocol.spec.md` returned `7755c14ee1cf175d74ae522cd2171b0977726075d1852d3e4711ebfb3fdea0fd`; `git rev-parse --short HEAD` returned `4a1024a7`.

2. **Overall assessment**

The proposal is directionally strong: it narrows the claim, separates completeness, cost, and evidence confidence, preserves raw evidence, and treats `reprioritize` as a pre-run readiness disposition rather than inventing a competitive result. The current adjudication is supported by the public-npm and complete-hosted-profile skips; no timed two-arm sample exists (`llp/0075-convex-checkpoint-protocol.spec.md:298-347`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:89-105`).

It is not yet a sound executable preregistration. There is one definite outcome-affecting prose/JSON divergence, while the frozen prompt, starting scaffolds, environment, metric event definitions, comparator topology, and authentication boundary remain selectable. Those are protocol inputs, not ordinary implementation gaps.

The workload is not an obvious Snapback softball: prior evidence favored Convex for first-hour AI chat and streaming, while Snapback still carried packaging and hosted gaps (`diaries/0017-chat-matrix.diary.md:14-40,158-163`; `diaries/0018-competitive-checkpoint.diary.md:39-52,80-98`). Nevertheless, the unresolved arm choices prevent a final fairness judgment.

3. **Strengths**

- The authority split is clear and mostly coherent: LLP 0063 retains sequencing and evidence control, LLP 0074 classifies competitive results, and LLP 0075 limits itself to this checkpoint (`llp/0075-convex-checkpoint-protocol.spec.md:53-85`; `llp/0063-partitime-platform-roadmap.plan.md:580-617`; `llp/0074-convex-competitive-strategy.rfc.md:179-204`).

- Apart from the security-failure omission below, the numeric margins agree with JSON. Sampling order, warmups, seven samples, elapsed conjunctions, stream ceilings, settlement kinds, and the evidence rubric are consistently represented (`llp/0075-convex-checkpoint-protocol.spec.md:143-147,222-296`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:40-118`). The stream bounds also match LLP 0076 (`llp/0076-bounded-streamed-actions.rfc.md:52-65`).

- The protocol explicitly blocks timed work while statistics, assistance, rubric anchors, and frontend-hosting boundaries remain unpinned (`demos/competitive-checkpoint/acceptance/protocol.v0.json:72-83,114-118`).

- The evidence posture is commendably honest about Cloudflare, public npm, and the selected container/VM adapter. The diaries and status artifact consistently distinguish deterministic/local machinery from a complete remote profile (`diaries/0018-competitive-checkpoint.diary.md:129-137,261-285`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:26-74,89-105`).

- Convex is allowed its idiomatic client, subscriptions, dashboard/CLI evidence, and Components, while the rubric forbids penalizing managed-provider evidence merely for using different vocabulary (`llp/0075-convex-checkpoint-protocol.spec.md:209-218,283-296`). Diary 0016 confirms the idiomatic Convex WebSocket path is concise and effective (`diaries/0016-partiful-matrix.diary.md:935-981`).

- On 2026-07-23 I fetched the nine official pages encoded at `demos/competitive-checkpoint/acceptance/protocol.v0.json:127-136`. The substantive inventory claims remain supported by Convex’s [local deployment](https://docs.convex.dev/cli/local-deployments), [Agent Mode](https://docs.convex.dev/cli/agent-mode), [deploy](https://docs.convex.dev/cli/reference/deploy), [backup/restore](https://docs.convex.dev/database/backup-restore), [writing data](https://docs.convex.dev/database/writing-data), [indexes](https://docs.convex.dev/database/reading-data/indexes/), [Components](https://docs.convex.dev/components/understanding), [quickstarts](https://docs.convex.dev/quickstart/overview), and [runtime](https://docs.convex.dev/functions/runtimes) documentation.

- `./ref-check --verbose` completed successfully with zero errors.

4. **Concerns**

1. **Major — The first-hour security margin diverges from the machine authority.** Prose requires cleanup defects, correctness failures, and security failures all to be zero (`llp/0075-convex-checkpoint-protocol.spec.md:252-265`). JSON contains `correctnessFailuresMax` and `cleanupDefectsMax`, but no `securityFailuresMax` (`demos/competitive-checkpoint/acceptance/protocol.v0.json:84-99`). Although a security defect also triggers `Stop`, the separately reported first-hour result can differ. Under the protocol’s own disagreement rule, this blocks timed runs (`llp/0075-convex-checkpoint-protocol.spec.md:70-72`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:6`). Resolve by adding `securityFailuresMax: 0`, or removing that margin from prose, in a dated amendment.

2. **Major — The purportedly frozen fixture and symmetric arm configuration are not content-addressed.** The runner is supposed to receive a frozen prompt and an arm-specific fresh scaffold, but neither has a path or digest (`llp/0075-convex-checkpoint-protocol.spec.md:170-180`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:36-63`). A canonical fixture-tree digest is only listed as a future retained artifact (`llp/0075-convex-checkpoint-protocol.spec.md:349-365`). LLP 0074 requires the fixture digest, protocol implementation, exact arm versions, plan/tier, hardware, network, credentials, and preconditions to be pinned before execution (`llp/0074-convex-competitive-strategy.rfc.md:723-737`). Convex is pinned to 1.42.3, but Snapback package/runtime identities and both arms’ full execution environment are not. Resolve with a content-addressed run capsule containing the neutral prompt, starting scaffold for each arm, harness, machine image, hardware/network policy, exact package integrities, provider/region/plan, and credential preconditions.

3. **Major — Several decisive metrics are not mechanically decidable.** The median rule is explicitly defined only for elapsed margins, leaving command, token, tool-call, failure, retry, and skip aggregation across seven samples unstated (`llp/0075-convex-checkpoint-protocol.spec.md:240-265`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:64-99`). Timer start/stop events, token classes, “top-level command,” wrapper scripts, tool-call batching, and the difference between expected refusal witnesses and actual failures are undefined. The current harness deliberately produces expected authorization refusals (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:70-96,140-157`). Sample invalidation and “one gap dominates” also retain substantial adjudicator discretion (`llp/0075-convex-checkpoint-protocol.spec.md:242-250,298-316`). Resolve with an event schema, per-metric aggregation rule, expected-refusal taxonomy, wrapper policy, coded invalidation criteria, and blinded invalidation adjudication.

4. **Major — Outcome-affecting fairness choices remain open without comprehensive machine blockers.** The prose both names a Convex cloud-development local leg and leaves cloud versus account-free local versus both unresolved; JSON pins no Convex target (`llp/0075-convex-checkpoint-protocol.spec.md:107-113,397-398`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:26-35`). Official Convex documentation confirms these are materially different workflows. Identity provider, two-principal setup, and timed provisioning boundary are also open despite server-derived identity and cross-user refusal being required facts (`llp/0075-convex-checkpoint-protocol.spec.md:123-141,394-396`). The current Snapback surface still supplies a hardcoded client user ID, appropriately proving only a narrower compile/projection subset (`demos/competitive-checkpoint/surfaces/react-expo/App.tsx:22-30,86-93`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:21-24`). Finally, prose requires the “same” pinned agent configuration, while JSON merely requires per-arm policies (`llp/0075-convex-checkpoint-protocol.spec.md:172-180`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:76-79`). Resolve and encode all these choices as `unpinned-blocks-timed-runs`.

5. **Major — The frozen authority set is incomplete and precedence after upstream acceptance is ambiguous.** LLP 0075 freezes only Draft LLPs 0065, 0072, and 0076 (`llp/0075-convex-checkpoint-protocol.spec.md:73-75`), while LLP 0074 also makes Draft LLP 0041 mandatory for deploy and LLPs 0051 and 0064 mandatory for generated-pattern/React-Expo gates (`llp/0074-convex-competitive-strategy.rfc.md:206-226`). A date does not uniquely identify those living documents. In addition, accepted subsystem authorities supposedly govern first, while changes to frozen Draft authorities supposedly do not bind until amendment (`llp/0075-convex-checkpoint-protocol.spec.md:62-75`). Resolve with a digest-pinned manifest of every consumed authority and a rule that newly accepted incompatible semantics immediately block timed runs pending prospective amendment; an old Draft snapshot must never authorize obsolete semantics.

6. **Moderate — Accepted-status and adjudication provenance do not bind the current revision cleanly.** The header records two 2026-07-23 `NOT READY` reviews and an outcome-affecting v0.1 amendment, while the only explicit author acceptance is of v0 on 2026-07-22 (`llp/0075-convex-checkpoint-protocol.spec.md:8-21`). The implementation-status artifact says `recordedAt` 2026-07-22 but contains 2026-07-23 defects and binds only the protocol ID, not v0.1 or its hash (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:2-9,77-87`). Resolve with an explicit post-amendment author decision—or a return to Review—and add `revisedAt`, protocol version/hash, and an implementation-status hash pin.

7. **Moderate — Arm-specific and historical fields are ambiguous in JSON.** `generatedPatterns` sits in the common fixture despite prose making generated CRUD/lookup/pagination a Snapback-specific authoring constraint (`demos/competitive-checkpoint/acceptance/protocol.v0.json:36-39`; `llp/0075-convex-checkpoint-protocol.spec.md:149-168`). JSON still names Cloudflare as `proposedHostedAdapter`, while prose and implementation status select the container/VM adapter prospectively (`demos/competitive-checkpoint/acceptance/protocol.v0.json:26-35`; `llp/0075-convex-checkpoint-protocol.spec.md:99-106,335-347`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:99-105`). Resolve with explicit `commonFixture`, `snapbackConstraints`, `convexAllowances`, `historicalAdapter`, and `nextExecutableAdapter` fields.

8. **Minor — Some preserved-evidence language is broader than the receipts.** The Spec calls streaming, generated-owner, and React/Expo facts “locally proven” while immediately acknowledging a noncanonical target and missing cross-user-delete witness (`llp/0075-convex-checkpoint-protocol.spec.md:320-333`). The status artifact more accurately says “passed-for-witnessed-subset,” and LLP 0065 requires delete refusal before its acceptance (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:10-15,77-87`; `llp/0065-generated-data-pattern-soundness.rfc.md:156-177`). Resolve by naming exact receipt-backed subfacts and saying they satisfy portions of proposed Draft criteria.

5. **Suggestions**

- Counterbalance or randomize arm order within paired samples instead of always starting with Convex; fixed ordering can confound monotonic network or platform drift (`llp/0075-convex-checkpoint-protocol.spec.md:242-244`).

- Record the product rationale for 1.25× and the two-/five-minute caps, then report sensitivity at nearby thresholds. Earlier setup evidence was qualitative rather than timed (`llp/0074-convex-competitive-strategy.rfc.md:156-162,240-260`).

- Rename JSON’s `authoritativePatchRatePerSecond` to `authoritativePatchRatePerSecondMax`; prose clearly treats ten as a ceiling (`llp/0075-convex-checkpoint-protocol.spec.md:222-238`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:40-50`).

- Add a JSON Schema plus a semantic “protocol compiler” that refuses unpinned blockers, missing metric definitions, stale hashes, or an executable adapter still marked historical.

- Reword “scoped expiring tokens” as “deployment-scoped token for an expiring deployment,” matching the official Agent Mode documentation (`llp/0075-convex-checkpoint-protocol.spec.md:371-380`).

- Have `Continue` return the result to LLP 0063 for sequencing rather than directly instructing stage broadening (`llp/0075-convex-checkpoint-protocol.spec.md:307-309`; `llp/0063-partitime-platform-roadmap.plan.md:609-617`).

6. **Open questions**

- Which Convex topology is the primary local comparator, and is the other topology a preregistered sensitivity arm?

- What exact identity provider, two-principal fixture, credential provisioning, and timed/excluded boundary applies to each arm?

- What bytes constitute the neutral prompt and each starting scaffold, and what exact machine/network/package capsule runs them?

- How are commands, tokens, tool calls, retries, expected refusals, skips, and invalid samples counted and aggregated?

- Which authority snapshot governs if a Draft dependency becomes Accepted with changed semantics?

- Has the author explicitly ratified v0.1 after the recorded `NOT READY` reviews, and who independently adjudicates future invalidations and rubric disputes?

7. **Verdict**

Verdict: NOT READY

The explicit security-margin divergence and the still-unpinned fixture, arm, authority, and metric choices must be resolved before this can serve as a reproducible accepted checkpoint protocol.

## Round 3 — 2026-07-23

**Revision under review:** `llp/0075-convex-checkpoint-protocol.spec.md`, sha256 `0cc94bebe0ac21b4f26e7b1cff921f8b5dc7af810da8cb738fec2b15b28ab4e1` (untracked file at repo HEAD `4a1024a7`), carrying protocol amendments v0.1 and v0.2 (`protocol.v0.json` sha256 `f06c2fd3b8f9df8a36b33e228df5088b66fad1e63fe2aaecaf28e6f09b6eb58f`)
**Runtime detail:** codex session id 019f8df2-1d47-74e1-8337-6eb1756f6f83, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Working web search: all nine comparator-inventory sources re-fetched from official Convex documentation 2026-07-23.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH. `shasum -a 256 llp/0075-convex-checkpoint-protocol.spec.md` returned `0cc94bebe0ac21b4f26e7b1cff921f8b5dc7af810da8cb738fec2b15b28ab4e1`; `git rev-parse --short HEAD` returned `4a1024a7`. The protocol JSON also matches its embedded `f06c…b58f` pin. `./ref-check --verbose` passed with zero errors.

2. **Overall assessment**

The checkpoint is a good idea. Its exact-fixture scope, separate completeness/cost/confidence outcomes, fail-closed security floors, explicit skips, and preserved raw evidence are substantially better than a retrospective benchmark assembled around favorable results. The evidence does not suggest an easy Snapback fixture: earlier diaries say Convex was fastest to working AI chat and already had streaming and the shorter hosted path.

The pinned revision is nevertheless not sound as an Accepted, frozen protocol. It is an unusually honest protocol framework that explicitly blocks timed runs, but critical fixture bytes, measurement definitions, topology, authentication, hosting, and scoring anchors remain deferred. The machine-readable authority also omits normative gates and contains at least one sampling ambiguity.

Most seriously, the current v0.2 revision was never explicitly accepted by the author: the document records acceptance of v0, then material amendments, two review rounds, and an unresolved decision about whether Accepted still stands. These are structural blockers, not editorial polish.

3. **Strengths**

- Numeric consistency is strong. Stream bounds, sample count, elapsed and effort margins, absolute failure floors, outcome precedence, and the confidence score agree between prose and JSON (`llp/0075-convex-checkpoint-protocol.spec.md:242-316`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:58-68,82-93,118-161`).

- Authority boundaries are mostly careful. LLP 0075 limits itself to the checkpoint slice while preserving LLP 0063’s sequencing/change-control authority and LLP 0074’s proposed classification role (`llp/0075-convex-checkpoint-protocol.spec.md:62-88`; `llp/0063-partitime-platform-roadmap.plan.md:580-599`; `llp/0074-convex-competitive-strategy.rfc.md:179-204`).

- Capability honesty is excellent. Cloudflare remains a narrow proof, the container/VM profile remains unsupported pending remote evidence, and `reprioritize` is explicitly not presented as a timed comparison result (`llp/0075-convex-checkpoint-protocol.spec.md:128-134,339-374`; `llp/0072-trusted-single-tenant-control-plane.rfc.md:205-230,444-473,510-519`; `demos/competitive-checkpoint/acceptance/implementation-status.v0.json:92-108`).

- The fixture does not appear obviously cooked for Snapback. Prior evidence calls Convex the fastest AI-chat implementation and records its concise native subscription path, while the checkpoint requires idiomatic provider-native Convex behavior (`diaries/0017-chat-matrix.diary.md:14-40,158-168`; `diaries/0016-partiful-matrix.diary.md:935-981`; `llp/0075-convex-checkpoint-protocol.spec.md:229-238`). The absolute zero correctness/security/cleanup floors are also stringent against Snapback (`llp/0075-convex-checkpoint-protocol.spec.md:272-288`).

- On 2026-07-23 I fetched all nine official Convex sources encoded at `protocol.v0.json:162-171`: [local deployments](https://docs.convex.dev/cli/local-deployments), [Agent Mode](https://docs.convex.dev/cli/agent-mode), [deploy](https://docs.convex.dev/cli/reference/deploy), [backup/restore](https://docs.convex.dev/database/backup-restore), [migrations](https://docs.convex.dev/database/writing-data), [staged indexes](https://docs.convex.dev/database/reading-data/indexes/), [Components](https://docs.convex.dev/components/understanding), [quickstarts](https://docs.convex.dev/quickstarts), and [runtimes](https://docs.convex.dev/functions/runtimes). They support the inventory as written, including the beta/account-free classification of local deployments.

4. **Concerns**

1. **Major — The pinned v0.2 revision has no coherent Accepted decision.** The metadata says Accepted (`llp/0075-convex-checkpoint-protocol.spec.md:3-4`), but the recorded author decision accepted v0 on 2026-07-22 (`llp/0075-convex-checkpoint-protocol.spec.md:24-30,341-345`). Material v0.2 changes followed (`demos/competitive-checkpoint/acceptance/protocol.v0.json:20-29`), and the Spec twice says whether Accepted stands remains open (`llp/0075-convex-checkpoint-protocol.spec.md:8-16,363-374`). `implementation-status.v0.json` compounds this by binding the 2026-07-22 adjudication to the later v0.2 hash (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:3-10`). LLP 0005 defines Accepted as author-approved and stable; direct acceptance without review is permitted, so that is not itself the defect (`vendor/llp/llp/0005-rfc-process.guide.md:21-37`). Resolve by explicitly ratifying and re-adjudicating v0.2, or set Status to Review and record the historical decision as `adjudicatedProtocolVersion: v0`.

2. **Major — The claimed frozen protocol remains materially unfrozen.** The Summary says the fixture and measurements are frozen (`llp/0075-convex-checkpoint-protocol.spec.md:39-46,57-60`), but the neutral prompt, scaffolds, harnesses, machine image, packages, provider, and credentials are not content-addressed (`llp/0075-convex-checkpoint-protocol.spec.md:183-199`). Statistics, assistance, metric definitions, local topology, authentication, and frontend hosting are all future blockers (`demos/competitive-checkpoint/acceptance/protocol.v0.json:90-117`). LLP 0074 requires those facts to be pinned symmetrically before metric-affecting work, specifically to prevent implementation knowledge shaping the fixture (`llp/0074-convex-competitive-strategy.rfc.md:655-665,723-742`), while Diary 0018 records protocol and treatment implementation in the same tranche (`diaries/0018-competitive-checkpoint.diary.md:8-52`). No timed result has occurred, so the current readiness disposition is not numerically retroactive; nevertheless, future choices can still be tailored to observed Snapback treatment work. Resolve by freezing one content-addressed run capsule before further comparative rehearsal or metric-affecting work.

3. **Major — The machine-readable authority is incomplete and contains an outcome-affecting sampling ambiguity.** Detailed CRUD, retry, cancellation, cross-user, push, stream-exclusion, and hosted lifecycle requirements appear only in prose (`llp/0075-convex-checkpoint-protocol.spec.md:136-160,211-255`); JSON records only a subset and has no per-arm product-completeness gate/equivalence matrix (`demos/competitive-checkpoint/acceptance/protocol.v0.json:53-71,155-177`). The already-missed cross-user delete witness demonstrates why enumerated operation IDs matter (`demos/competitive-checkpoint/acceptance/implementation-status.v0.json:80-90`). Prose says “two untimed warmups,” while JSON says two warmups per arm (`llp/0075-convex-checkpoint-protocol.spec.md:262-264`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:82-88`). Under the Spec’s own divergence rule, that blocks timed runs (`llp/0075-convex-checkpoint-protocol.spec.md:79-81`). Resolve with a complete machine gate matrix, explicit provider-native equivalence/N/A rules, generated prose from the same source, and an unambiguous warmup count.

4. **Major — Confidence anchors may be chosen after seeing the evidence.** The Spec requires anchors only before scoring, and JSON marks them `unpinned-blocks-scoring`, not `unpinned-blocks-timed-runs` (`llp/0075-convex-checkpoint-protocol.spec.md:303-316`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:135-153`). An anchor author could inspect both arms’ receipts and then decide what constitutes direct evidence, materially influencing the ≥2-point trust lead. Resolve by freezing per-arm anchors, scorer eligibility, dispute handling, and blinding before either timed runs or evidence reveal.

5. **Moderate — Remaining topology and setup choices can move minutes and commands between arms.** Snapback local is fixed while Convex cloud versus account-free local remains undecided (`llp/0075-convex-checkpoint-protocol.spec.md:112-126`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:106-109`). Prior same-machine Snapback versus hosted timing was explicitly “not a like-for-like comparison” (`diaries/0016-partiful-matrix.diary.md:915-918`), and the current deterministic stream source is loopback-only (`demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:323-362`). Authentication and frontend-host boundaries are likewise unpinned (`demos/competitive-checkpoint/acceptance/protocol.v0.json:110-117`), while the current local fixture uses development auth and injected user IDs (`demos/competitive-checkpoint/snapback/schema.mjs:16-33`; `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs:63-66,100-114`). Resolve with local-versus-local and hosted-versus-hosted primary comparisons, a neutral reachable stream source, and symmetric T0 provisioning/auth/hosting rules.

6. **Moderate — Sampling and invalidation retain arm-aware discretion.** Convex always runs first, rather than using balanced randomized order, and any named documenter may invalidate a sample using a retained rationale (`llp/0075-convex-checkpoint-protocol.spec.md:262-270`; `demos/competitive-checkpoint/acceptance/protocol.v0.json:82-93`). The protocol does not yet require fresh agent context per sample, blind failure classification, or specify whether a paired opposite-arm observation is repeated or discarded. Resolve with randomized AB/BA blocks, independent agent sessions, a preregistered instrument-failure taxonomy, and independent paired-sample adjudication.

7. **Moderate — The generic `reprioritize` rule leaks sequencing authority.** LLP 0075 says LLP 0063 owns sequencing (`llp/0075-convex-checkpoint-protocol.spec.md:62-77`), but its generic rule commands “Move the next tranche” (`llp/0075-convex-checkpoint-protocol.spec.md:334-337`). LLP 0063’s delegation explicitly withholds sequencing (`llp/0063-partitime-platform-roadmap.plan.md:580-599`). The current container/VM tranche is coherent because LLP 0063 itself selected it (`llp/0063-partitime-platform-roadmap.plan.md:609-617`; `llp/0075-convex-checkpoint-protocol.spec.md:356-361`). Resolve by making `reprioritize` return the named gap to LLP 0063 for sequencing.

8. **Moderate — The non-inferiority margins are decidable but unjustified.** The 1.25× ratios, absolute time caps, command deltas, and effort ratios are precisely stated but lack a product, empirical, or decision-theoretic rationale (`llp/0075-convex-checkpoint-protocol.spec.md:272-288`). The cited earlier AI-chat result was explicitly subjective after one build day, and earlier Convex timing was “useful feel, not a benchmark” (`diaries/0017-chat-matrix.diary.md:158-168`; `diaries/0016-partiful-matrix.diary.md:946-956`). Resolve by documenting why each value is the largest acceptable competitive disadvantage and preregistering sensitivity reporting without changing v0 after results.

5. **Suggestions**

- Create one external protocol-lock manifest hashing the prose, JSON, consumed authority revisions, prompts, scaffolds, harnesses, analysis code, and environment. Generate human-readable tables from that canonical bundle.

- Use a sealed-run ceremony: commit the capsule before credentials are revealed, have an independent operator execute it, and blind the evidence scorer to arm labels where possible.

- Rename “correctness and evidence confidence” to “user-observable evidence availability” or similarly narrow language. The document correctly admits that the rubric tests a non-neutral Snapback hypothesis (`llp/0075-convex-checkpoint-protocol.spec.md:303-316`).

- Report local-local and hosted-hosted results separately; retain cloud-development Convex as a preregistered sensitivity arm rather than mixing topologies into one primary margin.

- Replace “one gap dominates” with a deterministic outcome-to-gap mapping, and update LLP 0074’s now-stale question asking which first adapter to select (`llp/0074-convex-competitive-strategy.rfc.md:683-688,798-801`).

6. **Open questions**

- Does the author explicitly ratify v0.2, or should the document return to Review?

- Which Convex local topology, neutral stream endpoint, frontend host, identity provider, and timed provisioning boundary define the primary comparison (`llp/0075-convex-checkpoint-protocol.spec.md:418-426`)?

- What exact per-arm witness or provider-native equivalence satisfies every product-completeness gate?

- Who freezes the confidence anchors, who scores them, and must both happen before any evidence is visible (`llp/0075-convex-checkpoint-protocol.spec.md:427-428`)?

- What empirical/product rationale supports each margin and seven-sample design?

- Who owns and operates the long-lived competitive program after this session (`llp/0075-convex-checkpoint-protocol.spec.md:410-415`)?

7. **Verdict**

Verdict: NOT READY

The unratified v0.2 status, incomplete machine authority, unfrozen run capsule, and post-evidence scoring discretion must be resolved before this can be treated as an Accepted competitive protocol.
