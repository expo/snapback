**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0 (`codex exec`, read-only sandbox), invoked from the orchestrating /llp-super-refine Claude session; the orchestrating session did not author the document and Codex had no access to the concurrent Fable-family round or to llp/reviews/
**Date:** 2026-07-23
**Redacted:** no — repo-local review; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner (fresh context per round; prompt pinned the document sha256 and repo HEAD)

# LLP 0086 reviews — Codex (OpenAI) family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0086-prior-art-course-corrections.plan.md`, sha256 `521adc128eba6b4192f22d77efae0f4763ae1167e811b6a85eb3c2cd4f00364d` (untracked working-tree file), at HEAD `d408d3fd` (both MATCH the pinned values).
**Runtime detail:** ~19 tool calls (self-reported); verified claims against the files listed in the review's verdict section.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — Ran `shasum -a 256 llp/0086-prior-art-course-corrections.plan.md` and observed `521adc128eba6b4192f22d77efae0f4763ae1167e811b6a85eb3c2cd4f00364d`; ran `git rev-parse --short HEAD` and observed `d408d3fd`. Both equal the expected values: **MATCH**.

2. **Overall assessment** — The proposal has a useful program shape and generally identifies the highest-leverage findings from the research batch. CC-2, CC-3, and CC-5 are particularly well motivated, and the distinction between immediate truth maintenance, information-buying spikes, review-gated commitments, and watch items is directionally sound.

It is not yet a sufficiently coherent or executable Plan, however. Its governing assertion that no item changes a ratified decision is contradicted by LLP 0014 and LLP 0087: Facets adoption explicitly re-examines and potentially re-ratifies LLP 0014’s deploy-time bundle-loading one-way door. CC-1 also assigns hosted project lifecycle work to LLP 0024 even though that Spec expressly excludes hosted control planes and refuses hosted authority pending LLP 0060 and LLP 0019. LLP 0087 already recognizes these dependencies, but this parent plan does not.

The translation from research to work is selective without being explicit about the selection. Several actionable recommendations in LLP 0082–0085 disappear without a work item, watch disposition, or reasoned rejection. In addition, most entries identify document owners rather than accountable executors, lack issue/size/command-level receipts, and leave decisions inside “Work” that must be settled before an implementer can execute from the item alone. These are substantive Plan defects rather than editorial polish.

3. **Strengths**

- The summary accurately captures the broad architectural convergence: server-authoritative field-level LWW, a separate ephemeral lane, and physical per-app isolation (`0086:12–21`). This is supported by LLP 0082’s architecture/write-path synthesis (`0082:24–49`, `173–197`, `315–342`), LLP 0084’s Triplit/Ditto findings (`0084:18–40`, `101–106`, `186–197`), and LLP 0085’s first-party Jazz retreat (`0085:20–42`, `107–177`).

- CC-2 correctly identifies a real premise change rather than treating Facets as ordinary platform churn (`0086:65–86`). LLP 0083 confirms Worker Loader, per-facet SQLite, and Dynamic Workflows (`0083:135–160`), while LLP 0014 records that its prior dynamic-loading fact became stale (`0014:129–146`) and the checked-in Cloudflare configs confirm deploy-time aliases and separate handler services today (`cloudflare/wrangler.jsonc:15–30`, `cloudflare/wrangler.all-aboard.jsonc:17–38`, `cloudflare/wrangler.all-aboard.action-handler.jsonc:1–17`).

- The CC-2 spike questions cover the important dimensions—security boundary, storage, economics, lifecycle, and beta risk (`0086:88–111`). LLP 0087 strengthens these into measurable topology gates, budgets, and retained receipts (`0087:138–288`). The current micro-spike also supports the plan’s local feasibility premise while clearly preserving the unresolved real-platform questions (`cloudflare/spike-facets/README.md:13–50`).

- CC-3 correctly refuses to turn documentation silence into a competitive claim. It requires both implementation evidence and an empirical InstantDB probe (`0086:129–146`). LLP 0053 is an Accepted, detailed revocation contract (`0053:40–118`, `1930–1971`), Triplit documents server-driven eviction (`0084:70–99`), and Instant’s behavior remains explicitly unanswered (`0082:199–228`, `407–413`).

- CC-5 is appropriately bounded as a comparison amendment rather than premature adoption (`0086:167–178`). Instant Streams’ storage-backed, resumable, single-writer design is faithfully represented (`0082:230–252`), and LLP 0076 explicitly needs a decision about durable cursor ownership while currently refusing durable process-death resumability (`0076:75–86`, `523–559`).

- CC-7 preserves LLP 0008’s bounded-retention stance rather than importing Jazz’s unlimited history representation (`0086:198–213`). LLP 0085 explicitly recommends an RFC-level history/branching evaluation while warning against unbounded history without GC (`0085:220–263`), and LLP 0008 already pins a bounded journal with resnapshot below the retention floor (`0008:511–563`).

- The standing refusal on generic CRDTs is consistent with LLP 0068’s narrow document-only carve-out (`0086:226–233`; `0068:11–31`, `377–389`).

4. **Concerns**

1. **Major** — The plan’s “no item changes a ratified decision” invariant is false for CC-2. Lines `23–25` say every item only adds capabilities, refreshes facts, or evaluates without changing a ratified decision. But LLP 0014 calls deploy-time bundle loading a ratified one-way door and says the Facets evidence may support “re-ratifying or reaffirming it” (`0014:465–488`). LLP 0087 is even more explicit: Phase 1 requires LLP 0014 re-ratification (`0087:34–65`, `127–136`, `290–297`). CC-2’s own decision gate nevertheless says LLP 0014 may “adopt facets” (`0086:117–124`) without naming that ratification event. Its urgent rationale also suggests app code and isolated facet SQLite form the new per-app substrate (`0086:81–84`), whereas LLP 0087 preserves the ratified invariant that app rows remain in coordinator SQLite and facet storage is role-local only (`0087:38–46`, `92–125`).

   **Resolution:** Rewrite the governing constraint to distinguish premise-changing re-ratification from accidental reopening. Make CC-2 explicitly subordinate to LLP 0087’s topology candidates, storage invariant, Gate 0 receipt, and LLP 0014 door-2 re-ratification. Remove or qualify the implication that facet SQLite becomes the app-data store.

2. **Major** — CC-1 has no valid contract owner or complete dependency chain. It says LLP 0010/0024 will be revised to specify hosted create-app/schema/permission provisioning (`0086:53–63`), but LLP 0024 explicitly excludes “hosted control planes, billing, tenants, or project lifecycle” (`0024:84–93`). It also says hosted operations remain refused pending LLP 0060’s deployment-auth contract and LLP 0019 F8’s durable audit log (`0024:527–534`). LLP 0087 correctly recognizes all of this and requires a new hosted control-plane contract plus LLP 0060/0019/0011 prerequisites (`0087:347–368`). CC-1 additionally leaves MCP-versus-HTTP unresolved, although its Exit requires MCP, and omits acceptance for the `.md` docs and skills-package deliverables.

   **Resolution:** Name the document that owns hosted project lifecycle, or explicitly propose a reviewed scope amendment to LLP 0024. Add LLP 0060, LLP 0019 F8, applicable LLP 0011 service-principal work, credential bootstrap, audit requirements, and threat model as dependencies. Decide or gate the HTTP/MCP projection order before implementation, and add acceptance criteria for every retained deliverable.

3. **Major** — The evidence-to-work translation drops multiple actionable findings without disposition. Examples include:

   - Instant schema lockdown and query-scoped-cache ceremony (`0082:358–375`);
   - Cloudflare output-gate/bookmark vocabulary, lossy-alarm handling, partyserver positioning, uniqueness/version-skew constraints, and the Agents SDK anti-pattern (`0083:335–365`);
   - Triplit’s compatibility-classified schema pushes, convergent permission language, and Ditto’s read-time semantic-conflict guidance (`0084:227–262`);
   - Jazz’s first-party retreat citations for LLP 0008/0011 and Cambria-style migration lenses (`0085:220–252`).

   Some may correctly require no new work, but the Plan claims to convert the research batch into a bounded program (`0086:12–21`) and the review question specifically requires faithful translation. Silence makes it impossible to distinguish deliberate rejection, existing absorption, and accidental omission.

   **Resolution:** Add a compact evidence-disposition ledger mapping every “Do now,” “Adopt/strongly consider,” and “Treat as a deliberate decision” recommendation in LLP 0082–0085 to a CC item, an already-landed owner-document amendment, a watch trigger, or an explicit no-action rationale. New work items are not required for every row.

4. **Major** — The work items are not generally executable from Work/Exit alone, and “Owner LLP(s)” is not an accountable owner. CC-1 contains an unresolved transport choice and a very large control-plane build. CC-2 step 3 says to assess Dynamic Workflows with the LLP 0070 conformance suite but defines neither a time box, artifact, decision gate, nor prerequisite implementation; LLP 0070 itself remains a Draft semantic RFC (`0070:11–34`, `263–304`). CC-3 does not enumerate “current targets,” commands, or receipt format; this matters because LLP 0053 says the Cloudflare coordinator has no auth machinery (`0053:1926–1928`). CC-6 has four broad positioning deliverables but no evidence-class or review acceptance. CC-7 does not identify the RFC owner, required alternatives, or where a negative decision is recorded. This falls materially short of the more executable LLP 0079 model, whose items name dependencies, coordination, implementation choices, and concrete acceptance loops.

   **Resolution:** For every CC item, add an accountable owner or issue, size/time box, dependencies, exact output artifact, validation command or retained receipt, and a decision authority where choices remain. Split Dynamic Workflows from the Facets spike unless it receives its own bounded gate. Name local and Cloudflare explicitly in CC-3 and state whether lack of Cloudflare auth is an expected failing result or implementation scope.

5. **Moderate** — The review gates are not operationally coherent. “Pass `llp-review`” (`0086:23–27`, `222–224`) is not a binary mechanism; reviews produce findings and the author decides whether they are resolved. The selection also gates only LLP 0082 and LLP 0085 because CC-1/CC-7 are large, while CC-3 and CC-6 could publish competitive claims drawn from unreviewed LLP 0082/0084 and CC-2 is already advancing from unreviewed LLP 0083. Commitment size and evidence reliability are different gate dimensions.

   **Resolution:** Define review completion as specified independent review artifacts plus author disposition of all blocking findings, optionally accompanied by an evidence document status transition. Separately state which work may begin speculatively and which public claims or irreversible decisions require reviewed evidence. At minimum, gate CC-3/CC-6 claim publication on the relevant evidence review or fresh empirical verification.

6. **Moderate** — CC-6’s proposed triangle says Snapback is “open like both” Instant and Convex (`0086:182–186`). Instant is Apache-2.0, but LLP 0074 carefully says Convex is FSL source-available and that Snapback’s differentiator is permissive license terms and completeness, not merely visible/self-hostable source (`0074:111–125`, `359–384`). The proposed wording erases that load-bearing distinction and would be misleading in competitive material. CC-6 also fails to preserve LLP 0074’s required evidence classes (`0074:154–177`).

   **Resolution:** Replace the phrase with something precise, such as “MIT and fully open like Instant; more permissively licensed than Convex’s FSL backend,” and require every new competitive statement to carry LLP 0074’s `matrix-observed`, `doc-confirmed`, or `hypothesis` classification.

7. **Moderate** — The status board and CC-2 work are already stale relative to the cited elaboration. CC-2 says ENG-25387 still needs to land (`0086:88–90`, `126–127`), while LLP 0014 contains the refresh (`0014:8–15`, `93–146`) and LLP 0087 records step 1 as done, with a narrower pricing/GA follow-up still pending (`0087:138–166`). Keeping duplicate, divergent gates in LLP 0086 and LLP 0087 invites future inconsistency.

   **Resolution:** Mark CC-2 step 1 complete, replace it with the actual remaining follow-up, and make LLP 0087 the sole detailed authority for Facets phases and gates. Keep only a concise status/dependency summary in LLP 0086.

8. **Moderate** — CC-4’s title promises “auth paved-path adoptions,” but Work and Exit require only edits to LLP 0011 (`0086:148–165`). That records guest auth and onboarding ergonomics as requirements; it does not adopt or ship them. The pushdown exit also says the requirement is carried into “any” future implementation spec without naming an artifact that can prove completion.

   **Resolution:** Rename the item as a design amendment, or add implementation and acceptance work for guest creation, account claiming, and first-rule onboarding. Name the permission-language implementation artifact or split the later propagation into a dependent item.

9. **Minor** — The metadata header omits the required `Revised` field, and `Related` omits documents directly relied upon in the body, notably LLP 0008, LLP 0032, and LLP 0087 (`0086:3–8`, `113–115`, `198–213`, `257–263`).

   **Resolution:** Add `**Revised:**` and complete the `Related` list.

10. **Minor** — CC-7 slightly overstates Snapback’s ingredients by grouping Cloudflare’s platform PITR/bookmark capability with Snapback-owned history machinery (`0086:200–204`). LLP 0083 presents PITR as a property of SRS and says bookmarkable versions are prior art Snapback should preserve on its wire (`0083:65–98`), not an existing Snapback record-history API.

   **Resolution:** Distinguish Snapback’s bounded change journal/version machinery from provider-owned DO PITR bookmarks, and require the exploration to assess portability across targets.

5. **Suggestions**

- Add a one-page disposition matrix with columns: evidence finding, confidence/status, owner LLP, CC item or no-action reason, review gate, and trigger.

- Use LLP 0079’s status-board conventions more fully: size, code/docs classification, dependencies, issue key, and explicit acceptance evidence.

- Separate “truth maintenance,” “design amendment,” “evaluation spike,” “implementation,” and “positioning publication” as work-item kinds. They require different gates and definitions of done.

- Give competitive claims an expiry/reverification date because LLP 0082–0085 repeatedly warn that vendor facts move quickly.

- Make CC-3’s Instant probe preregister its observable behavior and timing threshold before execution, so ambiguous cache behavior cannot be interpreted after the fact.

- For CC-7, require separate recommendations for history reads, retained losing versions, branch creation, merge policy, GC/retention, authorization, and target portability; “history and/or branching” currently bundles several products with very different costs.

6. **Open questions**

- Which document is intended to own hosted app/project lifecycle if LLP 0024 continues to exclude it?

- Is CC-1 meant to deliver only the externally reachable provisioning contract, or also production hosting, credentials, audit, billing/quotas, and artifact publication?

- Does the author intend LLP 0087 to supersede CC-2’s detailed Work/Decision gate, or must both remain synchronized?

- Which “current targets” must pass CC-3—local Ibex, Cloudflare, both, and any client arms?

- Is CC-4 deliberately docs-only, or is guest account claiming expected to ship under this plan?

- Which omitted research recommendations were intentionally rejected, and on what grounds?

- Who is accountable for each CC item, and what program or issue docket owns sequencing across LLP 0063/0074 and this plan?

- What author action constitutes completion of an evidence-document review gate?

7. **Verdict** — Verified claims against: `llp/0001-prior-art.research.md`, `llp/0008-local-first-sync-and-realtime.rfc.md`, `llp/0009-code-execution-security.rfc.md`, `llp/0010-agent-dx-and-acceptance.spec.md`, `llp/0011-auth-and-permissions.rfc.md`, `llp/0014-cloudflare-strategy.rfc.md`, `llp/0018-app-instance-boundaries.rfc.md`, `llp/0024-agent-operating-surface.spec.md`, `llp/0033-license-posture.decision.md`, `llp/0040-cloudflare-narrow-proof.rfc.md`, `llp/0053-authorization-invalidation.rfc.md`, `llp/0068-collaborative-document-convergence.rfc.md`, `llp/0070-durable-background-work.rfc.md`, `llp/0074-convex-competitive-strategy.rfc.md`, `llp/0076-bounded-streamed-actions.rfc.md`, `llp/0079-serverpod-course-corrections.plan.md`, `llp/0082-instantdb.research.md`, `llp/0083-cloudflare-do-d1-prior-art.research.md`, `llp/0084-triplit-ditto.research.md`, `llp/0085-jazz.research.md`, `llp/0087-facets-hosted-adoption.plan.md`, `cloudflare/deploy.sh`, `cloudflare/src/gateway.js`, `cloudflare/src/coordinator.js`, `cloudflare/src/handler-worker.js`, `cloudflare/src/host-ops.js`, the checked-in `cloudflare/wrangler*.jsonc` profiles, and `cloudflare/spike-facets/README.md`/`spike.mjs`. No file under `llp/reviews/` was read. Approximate tool-call count: 19.

Verdict: NOT READY