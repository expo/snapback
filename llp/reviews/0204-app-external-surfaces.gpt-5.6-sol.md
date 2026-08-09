# Reviews — LLP 0204: App external surfaces (family: gpt-5.6-sol)

## Round 1 — 2026-08-08

**Provenance:** External family reviewer — OpenAI gpt-5.6-sol via
`codex exec`, reasoning effort xhigh, cwd = capsule worktree at commit
26c16b2eb (structural blindness: capsule excludes `llp/reviews/0204-*`
and orchestrator notes). Orchestrator: Claude Fable 5 super-refine
session; reviser: orchestrator (did not review). Target revision:
26c16b2eb; target sha256:
b3d39fad27a8aba8f9deb61a3b39647725cefc4ca39fa2d441755e81ca50aac6.
Review received 2026-08-08 and preserved verbatim below.

**Verdict: NOT READY** (6 material, 6 minor).

---

The “one authority, many projections” direction is strong, but revision `b3d39fad27a8aba8f9deb61a3b39647725cefc4ca39fa2d441755e81ca50aac6` is not ready. Several decisions currently weaken established authority boundaries or claim guarantees their proposed evidence cannot support.

## Material concerns

1. **M1 — D6, lines 363–387: server-side code mode treats the handler VM as an untrusted-code sandbox.** Type-checking, `no-eval`, and per-call authorization prevent authority widening through the injected client, but do not establish containment of hostile caller-supplied programs. LLP 0062 explicitly classifies server-side code mode as ad-hoc function deployment with unresolved isolation, provenance, and resource limits; LLP 0047 requires a killable runtime, enforced CPU/heap/result limits, no ambient powers, and per-invocation isolation before untrusted execution is claimed. This is MATERIAL because `/api/v1/run` otherwise creates a denial-of-service or escape boundary on every exposed app. **Disposition:** gate code mode on a separately evidenced untrusted-code capability satisfying all LLP 0047 requirements; refuse it on targets lacking that capability. Do not treat ordinary handler qualification as sufficient evidence.

2. **M2 — D7 lines 395–404 and D8 lines 456–466: integration, OAuth-client, and agent ownership are conflated.** The integration record simultaneously carries OAuth client metadata, an LLP 0055 agent credential, budgets, and a required app-user owner, while DCR creates it before user consent. Under LLP 0055/0150, an owning user may re-credential the agent, revoke all its grants, and assume durable memberships it accumulated. If one OAuth integration serves multiple users, its first owner therefore gains control over other users’ installation; if every user gets a separate record, the proposed stable OAuth-client/DCR and per-integration semantics are not what the RFC describes. This is a load-bearing authority ambiguity, not storage plumbing. **Disposition:** separate client/integration registration from per-user installation/grant authority, or explicitly choose a strictly per-user client model. In either case, define when ownership is established and prove that no user can re-credential or assume another user’s delegated installation.

3. **M3 — D7 lines 405–432: the declared tier promotes an unauthenticated string into durable and later claimable identity.** Auto-creating a ledger row for every caller-chosen value contradicts LLP 0071’s requirement that unknown caller strings cannot create unlimited durable buckets; composing request budgets with a network ceiling limits rate, not accumulated rows over time. More fundamentally, an identifier with no secret or registration proof cannot later be “claimed” with continuity: another party can claim an aged, attributed, or operator-blessed string and inherit its history or treatment. This is MATERIAL as both a durable-state abuse channel and an unsound trust transition. **Disposition:** bound pre-auth state with a low-cardinality outer gate, global quota, TTL, and eviction; issue a new authenticated identifier on upgrade. Prior declared history may be attached only as explicitly untrusted attribution, or after a real contact/operator proof.

4. **M4 — D1 lines 211–214 and D7 lines 412–424: anonymous eligibility contradicts the corpus’s `optional-user` semantics.** LLP 0058 and LLP 0172 state that both `public` and `optional-user` admit anonymous callers. This RFC says exposure preserves existing function authorization, but then defines the declared lane as reaching only exposed `public` functions while claiming this is “same as anonymous.” Implementations can therefore legitimately derive different public APIs. Because the exposure declaration is the RFC’s keystone, this ambiguity is MATERIAL. **Disposition:** decide the external anonymous set explicitly. Either include both `public` and `optional-user`, or define and mechanically enforce a stronger external `public`-only rule across API, MCP, CLI, code mode, envelope, and documentation.

5. **M5 — D9.1 lines 481–495: “multi-viewer by default” is not authority-non-widening.** Stream chunks from an action or `ask` may be derived from data read under the initiating caller’s grant. A second principal’s permission to subscribe to a session or room does not prove that principal could have read every input incorporated into those chunks. Existing ephemeral machinery authorizes each subscriber and keeps authorization domains separate; “normal query authorization” does not by itself supply the missing result-level proof. This is MATERIAL because the chosen default can disclose one principal’s data to another. **Disposition:** make streams private to the initiating authority by default. Multi-viewer streams should require an explicit sharing declaration and either per-viewer re-evaluation/non-widening proof or delivery through a durable result query whose ordinary row authorization independently admits that viewer.

6. **M6 — D5 lines 351–354 and D9.5 lines 539–550: receipts are assigned guarantees they do not provide.** Function names plus argument/result digests are an audit trace; without result bytes and a stable snapshot identity they cannot verify the agent’s answer or its derivation. Likewise, an approval binding that revalidates only generation and authority can execute a materially different effect after relevant data, deterministic inputs, or provider state changes. LLP 0149 F4 and F9 explicitly distinguish these cases. This is MATERIAL because these receipts are presented as the trust basis for near-data answers and consequential writes. **Disposition:** label call traces as provenance only unless they carry verifiable evidence. For approval, use a short-lived plan receipt binding read/data versions, deterministic inputs, and effect summary, then re-execute and compare or refuse stale; otherwise present the ceremony honestly as prospective authorization, not approval of a verified preview.

## Minor / implementation-phase notes

1. **m1 — D1 lines 202–210:** `disclosure: "full"` is a deliberate exception to the preceding claim that exposure governs callability, disclosure, and documentation “as one fact.” State the exception directly so projections do not diverge accidentally.

2. **m2 — D2 lines 234–252:** the stability regime needs an implementation-phase compatibility classifier covering input, result, refusal, auth, pagination, and effect metadata, plus evidence that deprecated implementations remain callable throughout their window.

3. **m3 — D1/D2/D6:** add adversarial acceptance proving that an integration cannot reach an unexposed function through legacy `/query|mutation|action` routes, live subscriptions, nested calls, MCP, or code mode. The RFC states the invariant but does not enumerate these bypass paths.

4. **m4 — D9.4 lines 524–537:** capability links should formally amend LLP 0150’s bearer-exception inventory and inherit secret-URL controls: no logging or referrer leakage, no mutation on GET, preview-crawler safety, bounded maximum expiry, and explicit single-use/approval semantics.

5. **m5 — D4 lines 314–317 and D5 lines 341–357:** define the CLI’s currently undefined “task tier,” and specify no-store/redaction/custody rules for caller-supplied model credentials.

6. **m6 — D9.3 lines 510–522:** implementation should inherit LLP 0070’s captured-grant/revalidation, webhook SSRF, idempotency, retry, and ambiguity contracts rather than treating durable work as sufficient by itself.

VERDICT: NOT READY
## Round 2 — 2026-08-08 (delta round)

**Provenance:** External family reviewer — OpenAI gpt-5.6-sol via
`codex exec`, reasoning effort xhigh, cwd = capsule worktree at commit
e36ef7bfe (structural blindness: capsule excludes `llp/reviews/0204-*`
and orchestrator notes). Delta-round instructions enumerated the v0.3
delta and required IN-DELTA / PRE-EXISTING classification. Target
revision: e36ef7bfe; target sha256:
eaece79851f86ecd2e96cb08abb4f53c00b3c3382724866382301bae7666e9c5.
Review received 2026-08-08, preserved verbatim below.

**Verdict: NOT READY** (4 material, all IN-DELTA; 7 minors, 2
PRE-EXISTING). No MATERIAL concern in pre-existing text from this
family this round.

---

The revision materially improves the hosted-execution, untrusted-code, receipt, and streaming postures. However, four authority and exposure contradictions remain at the decision level, so this sha256 is not ready.

## Material concerns

1. [IN-DELTA] **Anchor: D1 “exposure declaration,” D2 transport.**  
   **Defect:** Exposure is not enforceable as the claimed callability boundary for anonymous functions. LLP 0031/0058/0093 admit anonymous callers to bare `/query`, `/mutation`, and `/action` routes whenever the function is `public` or `optional-user`. Such a caller has no integration credential, so the server cannot distinguish a first-party anonymous caller—declared unaffected by D1—from an external caller guessing an unexposed function name. The new bypass rule only covers “an integration credential invoking an unexposed function.”  
   **Why MATERIAL:** The keystone default-deny property is false for the newly defined external anonymous set. Either unexposed anonymous functions remain externally callable, or exposure changes first-party anonymous behavior.  
   **Suggested disposition:** Decide the boundary explicitly: gate every bare anonymous invocation by exposure; introduce a verifiable first-party carrier; or concede that bare anonymous routes remain externally callable and narrow exposure’s callability claim to `/api/v1` and credentialed carriers.

2. [IN-DELTA] **Anchor: D1 external anonymous set, D3 Authorization.**  
   **Defect:** D1 says the same anonymous-callable set applies to MCP, but D3 says all MCP tool calls carry a delegated grant. On hosted targets those granted calls are wholesale-refused under the corrected D2 ladder, so MCP cannot exercise the supposedly gate-free anonymous set.  
   **Why MATERIAL:** This contradicts “one authority, many projections” and materially changes whether the hosted MCP surface can do anything before LLP 0039 lands.  
   **Suggested disposition:** Either admit unauthenticated MCP calls only to the external anonymous set, or explicitly exclude MCP from anonymous invocation and narrow the uniform-projection claim.

3. [IN-DELTA] **Anchor: D7 integration versus installation; D8 DCR.**  
   **Defect:** The lifecycle authorities contradict each other. An installation is said to be revocable “by that user alone,” and integration-owner control supposedly never reaches other users’ installations; nevertheless re-credentialing kills every installation, and suspension/revocation revokes every associated grant. LLP 0055 confirms that owner re-credentialing terminally revokes third-party grants. Separately, DCR creates an integration before an app user is known, while D7 requires every integration to have an app-user owner; LLP 0055 makes open registrations unowned, while LLP 0150 binds an owner only during approval.  
   **Why MATERIAL:** This leaves consent revocation, global kill authority, and interoperable DCR registration undecided. A naïve resolution could give the first installer control over every later installation.  
   **Suggested disposition:** Define distinct registration-owner and installation-user authorities, including provisional DCR state, ownership binding, operator suspension, per-install revocation, and global credential retirement. State and disclose plainly which operations invalidate other users’ installations.

4. [IN-DELTA] **Anchor: D9.4 capability links; P3 external authority.**  
   **Defect:** Adding capability links to LLP 0150’s bearer-exception inventory addresses custody but not execution authority. LLP 0055’s `servicePrincipal` requires an actor principal, credential generation, grant, and token; LLP 0058’s resolved-authority set is sealed. A URL possessor supplies none of those. Executing as the minter misattributes the actual actor; executing anonymously cannot exercise the narrowed delegated grant.  
   **Why MATERIAL:** Capability links introduce a new bearer authority carrier while the RFC claims no new authority model and promises the LLP 0055 audit tuple for external calls. This is a security and audit-boundary defect.  
   **Suggested disposition:** Commission explicit LLP 0055/0058/0031 amendments defining the link carrier, actor/effective/grant attribution, route class, mint/revocation lineage, and invocation gate—or initially restrict links to functions already callable anonymously.

## Minor / implementation-phase notes

1. [IN-DELTA] **D3, D6, D9.2, D10:** D6 correctly makes server-side code mode target-conditional, but D3 advertises `run_code` prominently, the generated skill teaches code mode, and D10 promises “Code mode on all of the above” unconditionally. Derive availability and documentation from the evidenced target capability and qualify D10.

2. [IN-DELTA] **D2 hosted ladder:** “Gate-free external lanes are exactly the ungranted ones” can be misread as opening anonymous mutations, although the same section and sequencing retain the audit gate for external mutations. Say explicitly that ungranted calls bypass only the LLP 0055 service-principal gate; every external mutation remains F8-gated regardless of lane. Assign equivalent audit treatment for externally effectful actions.

3. [IN-DELTA] **D1 registration posture:** Clarify whether explicit `auth.agents.mode: "disabled"` is a valid anonymous-only `api.enabled` posture. The current text refuses only an absent declaration but then names `open` or user-invited as the production constraint.

4. [IN-DELTA] **D5 receipts:** Relabeling digests as provenance is correct, but retained argument/result digests can disclose low-entropy intermediate values. Follow LLP 0062’s value-minimization precedent: omit them from less-authorized audit projections or use domain-separated keyed commitments with an explicit custody/lifetime rule.

5. [PRE-EXISTING] **P3 and D7 admission:** “Every external call” resolving to an LLP 0055 grant tuple and being keyed by `(integration, principal)` excludes the document’s own anonymous and declared lanes. Scope those claims to granted calls and name the separate trusted-edge/declared attribution tuple.

6. [PRE-EXISTING] **D2 versus D9.1:** D2 defers integration connection-grant streaming to v2 while `ask` streams by default. Specify whether v1 `ask` uses request-bound private SSE, distinct from live subscription authority, with multi-viewer/reconnect subscription behavior remaining v2.

7. [PRE-EXISTING] **D9.3 watches:** Pin watch predicates as a closed declarative grammar, or apply D6’s untrusted-code gate. A caller-submitted executable predicate would otherwise become durable untrusted code despite D6’s “query plan, not deployment” boundary.

VERDICT: NOT READY
## Round 3 — 2026-08-08 (delta round)

**Provenance:** External family reviewer — OpenAI gpt-5.6-sol via
`codex exec`, reasoning effort xhigh, cwd = capsule worktree at commit
384c5f638 (structural blindness: capsule excludes `llp/reviews/0204-*`
and orchestrator notes). Delta-round instructions enumerated the v0.4
delta and required IN-DELTA / PRE-EXISTING classification. Target
revision: 384c5f638; target sha256:
adf915268374a39ed0f005303a8bd1e6be8281eb607602f7326e2497562d76a2.
Review received 2026-08-08, preserved verbatim below.

**Verdict: NOT READY** (6 material: 4 IN-DELTA, 2 PRE-EXISTING; 6
minors). PRE-EXISTING materials (M3, M6) block delta-round convergence;
round budget (3) exhausted → terminal escalation to the author.

---

The revision materially improves anonymous reachability honesty, hosted-lane scoping, code-mode gating, and capability-link staging. It is still not ready: D7’s lifecycle model contradicts LLP 0055/0150, and several newly claimed inheritance paths do not exist in the governing LLPs. Assessment binds to sha256 `adf915268374a39ed0f005303a8bd1e6be8281eb607602f7326e2497562d76a2`.

## Material concerns

1. [IN-DELTA] **D7, key-holder rotation.** D7 says grants bind to credential generation and therefore rotation terminally revokes every installation for fresh consent. LLP 0055 §Credentials and LLP 0150 §1 say the opposite: self-rotation preserves grants, keeps the credential id stable, and only invalidates old tokens/connections and queued work. A rotated integration can mint fresh tokens against every existing grant. This invalidates the claimed global-kill and consent semantics. **Disposition:** distinguish ordinary self-rotation from retirement. Add a separate atomic integration-retirement operation that revokes the credential family and every installation grant, or commission an explicit LLP 0055 amendment changing rotation semantics.

2. [IN-DELTA] **D7/D8, integration ownership.** “Never first-installer” conflicts directly with “owner is bound only as LLP 0150 binds one.” LLP 0150 §2 makes the approving user the owner under `open`; for a DCR-created integration, that approver is the first installer. D7 also says both the owner and the key-holder control lifecycle without resolving their competing powers. This leaves control of a multi-user integration undefined and may give an arbitrary first consenting user re-credential/deactivation authority. **Disposition:** choose one explicit model—publisher/key-holder ownership separate from installations, or acknowledged first-approver ownership—and specify `open`, invited, and operator-created cases through named LLP 0055/0150 amendments.

3. [PRE-EXISTING] **D7, “delegation-only” integrations.** An integration is declared to be an ordinary LLP 0055 agent principal, yet the RFC says it can receive authority only through installations. Existing LLP 0055 registration may apply `auth.agents.template`, creating an autonomous grant at registration; its owner/re-credential path can reapply that template. DCR therefore does not inherit the claimed delegation-only property. **Disposition:** define a named integration registration class/amendment that suppresses autonomous templates and grants and enforces installation-only token minting, including activation and migration checks.

4. [IN-DELTA] **D1/D7, anonymous-floor ownership.** LLP 0031 says `DeclaredPublicApplicationData` governs exactly LLP 0090’s HTML-inline and read-bundle lanes, requiring `public`, `authorityIndependent`, closed inputs, and `publicInline`. It does not cover arbitrary `optional-user` functions, finite API/MCP calls, mutations, or actions. LLP 0204’s external anonymous set is much broader. Consequently, the claimed inherited budget/response posture for the hosted anonymous-first rollout does not exist. **Disposition:** define a new LLP 0031/0071 external-anonymous admission and response contract—or explicitly extend the existing ones—and make callable API activation depend on its enforcement.

5. [IN-DELTA] **D4, developer full-surface discovery.** LLP 0031 D3’s gated full `/inspect` twin is an operator-plane `AdminSecretRead` surface containing sensitive implementation material. LLP 0062 explicitly makes the app CLI app-data-only and forbids it from accepting admin authority. The inspect projection also does not supply the complete operation schemas and declarations needed for code mode. The newly stated discovery path is therefore both insufficient and a plane-boundary violation. **Disposition:** retain LLP 0062’s explicit local-artifact path for trusted-local development, or commission a source-stripped full developer envelope with its own app-plane authority.

6. [PRE-EXISTING] **D5/D10, impossible `ask` acceptance.** D5 makes v1 `ask` query-only regardless of grant, while D10 requires “authenticated, listed, paged, sent, received” to pass on `ask` as well as the API, MCP, and CLI. “Sent” requires a mutation, so the stated acceptance bar cannot pass under the decided v1 safety boundary. **Disposition:** give `ask` a read-only v1 acceptance task and defer the send case to the post-audit-log mutating-`ask` phase.

## Minor / implementation-phase notes

1. [IN-DELTA] **D1, `disclosure: "full"`.** “Callability follows exposure regardless” contradicts the newly added anonymous residual. Change it to “credentialed callability follows exposure regardless.”

2. [IN-DELTA] **D2 versus Sequencing S1, CORS ownership.** D2 correctly requires a dedicated bearer-token `api.origins` statement, while S1 still says CORS lands “under the LLP 0039 contract.” Name the dedicated amendment consistently.

3. [IN-DELTA] **D2 versus Hosted gates.** D2 limits LLP 0019 F8 to granted external mutations/effectful actions, while Sequencing says it gates “any external mutation.” Publish one exact lane × function-kind matrix and use it in both places.

4. [IN-DELTA] **D9.4, anonymous capability-link plumbing.** “No amendment needed” can only mean no new execution-authority model. The v1 link still needs an LLP 0031 route/response registration, secret-token handling, and an explicit rule that link budgets compose with the anonymous network-evidence floor.

5. [PRE-EXISTING] **D3, MCP scale shaping.** Advertising `run_code` does not by itself solve LLP 0149 F3: an eager one-tool-per-function catalog still consumes discovery context. The implementation should adopt a bounded search/describe projection or define mechanically testable grouping/pagination.

6. [PRE-EXISTING] **D5, model-data egress.** The `ask` consent and receipt should identify the model/provider and disclose that authorized application data may be sent to it; the current scope language emphasizes token spend but not data egress.

VERDICT: NOT READY