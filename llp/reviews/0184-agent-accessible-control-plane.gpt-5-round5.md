# LLP 0182/0184 round 5 review — OpenAI Codex / GPT-5 family

**Verdict:** NOT READY  
**Bound to revision:** c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81  
**Reviewer:** OpenAI Codex, GPT-5 family; exact serving version not exposed  
**Blindness:** self-attested — read only my own family's round-1/2/3/4 reviews (gpt-5.md + gpt-5-round2/3/4.md); did not read the other family's review or the run journal

## Round-1/2/3/4 concern resolution

1. **MATERIAL — Completeness cannot detect undeclared console or client operations (round 1, still open in rounds 3/4)** — NOT RESOLVED

   Round 5 honestly retains the admission that the secondary console manifest is not mechanically closed:

   > “nothing technically stops a future imperative `AdminClient` call from being added to `main.ts`/`setup.html` without a manifest entry”

   ([llp/0184-agent-accessible-control-plane.rfc.md:580-594](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:580)).

   But the Summary still says:

   > “Every console action … must be cataloged”  
   > “An omission requires a reason; silence is a build failure.”

   ([RFC:49-54](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:49)).

   Rule 10 likewise says a new console action with an incomplete join fails proof ([RFC:631-633](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:631)). That is false for an unmanifested imperative call under the posture the RFC explicitly selected.

   The AdminClient side also remains undefined. The RFC says its “public method list supplies a closed enumeration” ([RFC:451-452](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:451)), but the package exports only `index.mjs` ([packages/snapback-admin-client/package.json:6-8](/Users/ccheever/projects/snapback/packages/snapback-admin-client/package.json:6)), and its public operations are ordinary class methods ([packages/snapback-admin-client/index.mjs:19](/Users/ccheever/projects/snapback/packages/snapback-admin-client/index.mjs:19)). No manifest, reflection rule, AST boundary, or negative fixture for an undeclared method is specified.

   The author may choose audit-only coverage, but Summary, rule 10, and Acceptance must then be narrowed to the mechanically closed and explicitly declared domains. Otherwise this remains a false central guarantee.

2. **MATERIAL — `surfaceAccess` and `operability` are not fully independent and uniquely classifiable (round 2, partial in rounds 3/4)** — PARTIALLY RESOLVED

   The exposed-but-unbuilt case remains fixed: `acceptance.run` can truthfully be `(mcpOnly, unavailable)`. The remaining `direct`/`mediated` overlap persists.

   `direct` permits a `humanApprovalRequired` gate, while `mediated` includes an “out-of-band approval” ([RFC:282-287](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:282)). The later explanation distinguishes a generic confirmation gate from an operation-inherent approval ([RFC:343-355](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:343)), but no structural rule determines which category applies.

   That ambiguity affects enforcement, not just terminology: rule 6’s plan/initiate/status/resume and negative-leak obligations apply only to `mediated` rows. The same out-of-band approval could be labeled `direct + humanApprovalRequired` and evade those obligations.

   Resolve this by defining the boundary in terms of an observable contract—for example, generic confirmation of an otherwise complete direct request versus an operation-specific ceremony or continuation that supplies an essential input—or remove approval from `mediated` and model all approvals solely through `approvalPosture`.

3. **MATERIAL — Hosted completeness and dispatcher identity (round 3, new concern in round 4)** — PARTIALLY RESOLVED

   The new hand-maintained-plus-audit posture is substantially more honest:

   > “a new hand-routed `gateway.js` case with no manifest entry at all is caught by audit, not by this rule”

   ([RFC:711-721](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:711)).

   Acceptance now repeats that limitation ([RFC:1133-1143](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:1133)). This correctly abandons round 4’s unsupported claim that omissions in imperative routing are mechanically detectable.

   The known-case identity remains too coarse, however. The manifest and rule 11 are consistently described as path-keyed: “every path … every manifest entry has a catalog row” ([RFC:660-670](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:660), [RFC:713-721](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:713)). One real path already contains two semantic operations:

   - `gateway.js` forwards all methods for `/_snapback/api/debug/network-profile` ([cloudflare/src/gateway.js:147-155](/Users/ccheever/projects/snapback/cloudflare/src/gateway.js:147)).
   - The coordinator dispatches GET through `adminReadGated` but PUT/non-GET through the write activation gate ([cloudflare/src/coordinator.js:1584-1595](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:1584)).

   One path-keyed row cannot carry both operations’ distinct method, authority, effect, schema, and identity. The hand-maintained choice does not excuse incorrect representation of cases that are declared.

   Phase 1 also still says the manifest will be enforced “against `gateway.js`’s actual dispatcher” ([RFC:1096-1098](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:1096)), contradicting §3a’s explicit statement that this is not mechanically possible.

   The manifest can remain hand-maintained, but each entry must be keyed by at least method, path template, and semantic operation identity, with explicit downstream identities for prefix routes. Phase 1 must describe declared-case checking plus audit, not actual-dispatcher completeness.

4. **MATERIAL — `host.restart` owner and composition (round 4)** — RESOLVED

   The correction is factual and structurally correct:

   > “`projections.hostOps` and `composedFrom` are both populated”

   ([RFC:463-489](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:463)).

   `host_ops.host.restart` is registered as `AdminWrite` ([src/server.rs:15519-15535](/Users/ccheever/projects/snapback/src/server.rs:15519)), and operation dispatch resolves it ([src/server.rs:15838-15855](/Users/ccheever/projects/snapback/src/server.rs:15838)). The MCP tool declares `operation: 'host.restart'` ([packages/snapback-cli/mcp-control.mjs:208-214](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:208)) and composes stop/start into one `host.restart` envelope ([packages/snapback-cli/mcp-control.mjs:817-831](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:817)).

   The HTTP path requires authentication and returns `SNAPBACK_HOST_OP_CLI_ONLY` ([src/server.rs:35397-35424](/Users/ccheever/projects/snapback/src/server.rs:35397)). The MCP lifecycle admission instead invokes the native stop/spawn helpers, with startup-nonce validation on stop, rather than invoking the registered `host.restart` path.

   `composedFrom` now supplements rather than replaces the semantic owner. The remaining authority-invariant defect is recorded below as a new concern.

5. **MATERIAL — `config.secret.acquire` lacks an implementable owner contract (round 4)** — PARTIALLY RESOLVED

   The revision correctly establishes that the two value paths are disjoint. The shipped page reads the human-entered value and POSTs it directly to `config.set` ([src/admin/setup.html:470-483](/Users/ccheever/projects/snapback/src/admin/setup.html:470)), whose route is registered at [src/server.rs:8762-8768](/Users/ccheever/projects/snapback/src/server.rs:8762). An agent does not need a secret-bearing artifact from that browser call.

   This resolves round 4’s specific “what is handed to the later `config.set` call?” objection. It relocates the remaining problem into the proposed handoff state machine, however.

   `config.secret.acquire` promises initiate/poll with `pending`, `complete`, `expired`, and `cancelled` ([RFC:301-325](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:301)). LLP 0036’s closed operation table has only status/plan/set/unset/verify ([llp/0036-app-secrets-and-config.rfc.md:677-710](/Users/ccheever/projects/snapback/llp/0036-app-secrets-and-config.rfc.md:677)); L0 is a human-driven wizard, while tracked `awaiting-human` acquisition is explicitly L1/v2+ and v1 metadata is passive ([llp/0036-app-secrets-and-config.rfc.md:826-847](/Users/ccheever/projects/snapback/llp/0036-app-secrets-and-config.rfc.md:826)). Current `ConfigStatus` reports entry state, verification, and apply state, but has no handoff identity, deadline, cancellation, or expiry state ([src/local.rs:2826-2894](/Users/ccheever/projects/snapback/src/local.rs:2826)).

   Thus a bare status can observe “entry became set,” but cannot distinguish one bounded acquisition attempt from a stale prior value, cancellation, or expiry. LLP 0036 must define the new non-secret continuation identity, state transitions, authorization, concurrency semantics, expiry, and cancellation. Calling it a projection of existing L0 is inaccurate.

6. **MATERIAL — Hosted leg and `apiOnly` sensitivity pin were absent from enumerated enforcement in round 4** — RESOLVED

   Both are now present where required:

   - Hosted rule 11 is enumerated at [RFC:711-721](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:711), and the first Acceptance bullet records both its check and its audit-only limitation ([RFC:1133-1143](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:1133)).
   - Rule 5 refuses threshold promotion for `CredentialSecret` responses or `ImpersonationCapability` effects ([RFC:599-613](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:599)), and the second Acceptance bullet repeats the same pin ([RFC:1144-1151](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:1144)).

## New MATERIAL concerns (not in prior rounds)

1. **MATERIAL — The restated lifecycle authority invariant is contradictory and non-constraining**

   §Design/2 accurately calls `host.restart` a live counterexample to the original invariant, then proposes:

   > “no projection *widens* the authority its own gate enforces”

   ([RFC:472-504](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:472)).

   But the normative Security section was not restated. It still says:

   > “CLI, MCP, AdminClient, and console call the same gate and return the same result semantics.”

   ([RFC:1201-1205](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:1201)).

   The proposed replacement is also vacuous: any projection, including one with an arbitrarily broader gate, trivially does not widen “the authority its own gate enforces.” It compares neither against the semantic owner nor against sibling projections. It therefore cannot support the RFC’s claim that a projection is not a second authority.

   The RFC leaves the real decision unresolved—Phase 2 may either gate MCP equivalently or preserve the divergent lifecycle authority indefinitely. The author and LLP 0024/security owner must decide whether owner-only local process/filesystem access is the intended lifecycle authority or whether MCP must prove an AdminWrite-equivalent credential. Then the owner, catalog fields, and one normative invariant must say the same thing.

2. **MATERIAL — The promised native `config.set` has no feasible MCP secret carrier**

   `native` requires both a direct CLI command and a typed MCP tool ([RFC:246-252](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:246)). P3 targets `config.set` as `(native, direct)` but permits only “stdin/file descriptor” input and forbids a literal MCP argument ([RFC:893-898](/Users/ccheever/projects/snapback/llp/0184-agent-accessible-control-plane.rfc.md:893)).

   The current MCP server’s stdin is already the newline-delimited JSON-RPC transport; tool inputs arrive in `params.arguments` ([packages/snapback-cli/mcp-control.mjs:1017-1045](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:1017), [packages/snapback-cli/mcp-control.mjs:1075-1089](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:1075)). An already-running MCP client cannot transfer a new OS file descriptor through that protocol. Passing a path or descriptor number would require an additional provisioned carrier and security contract covering ownership, binding to the exact request/entry, lifetime, cleanup, replay, symlink/race checks, and arbitrary-file-read prevention.

   Either define that carrier with LLP 0036/security-owner approval or keep `config.set` `cliOnly` until a safe MCP carrier exists. The current `(native, direct)` target is not buildable as written.

## New DETAIL concerns (not in prior rounds)

1. **DETAIL — “No admin credential gate at all” overstates the MCP restart path**

   Lifecycle admission itself is native-process based, but `startEnvelope` verifies the restarted server by calling `postHostOp({ operation: 'app.inspect' })` ([packages/snapback-cli/mcp-control.mjs:708-755](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:708)). `postHostOp` reads the managed admin-token carrier and sends `x-snapback-admin-token` ([packages/snapback-cli/mcp-control.mjs:659-679](/Users/ccheever/projects/snapback/packages/snapback-cli/mcp-control.mjs:659)).

   This does not repair the lifecycle admission discrepancy, because stop/spawn occurs outside that gate. Still, the precise statement should be “no caller-presented/admin gate for lifecycle admission; the post-start inspection uses the filesystem-derived managed token,” rather than “no admin credential gate at all.”

## Verification notes

- Recomputed SHA-256 immediately before review completion: `c81845de5135aaef9325521f850716b98663212b57553ae395a67c78528dfb81`.
- Verified the `host.restart` registration, operation lookup, HTTP refusal, MCP declaration, stop/start composition, native stop nonce check, and post-start authenticated inspection.
- Verified the hosted routing shape against both `cloudflare/src/gateway.js` and `cloudflare/src/coordinator.js`, including the network-profile GET/write split and the downstream `/_snapback/test/*` dispatcher.
- Verified that the setup page POSTs the human-entered value directly to the sole registered local `config.set` route and that the response does not read the value back.
- Verified the owner’s current config operation table, passive-v1/L1-v2 acquisition distinction, and current `ConfigStatus` fields.
- The earlier fixes for table-scan offset paging, patch authority tuple and apply-token binding, ephemeral epoch/generation fencing, remediation ownership, single-subscription resync, direct `config.unset`, build-matched guide transport, derived-instance refusals, and `app.ensure.provision` operation-identity keying remain coherent.
- I did not run builds or integration tests. The catalog compiler, hosted manifest, handoff state machine, and three new debugging operations are not implemented, so their runtime properties can only be reviewed statically.
- The remaining concerns are fundamentally solvable, but not by another prose-only cleanup. The lifecycle authority model, direct-versus-mediated approval boundary, and config handoff/MCP carrier require author and semantic-owner decisions. The overbroad completeness claims, hosted manifest identity, Phase 1 wording, and stale Security invariant can then be repaired mechanically around those decisions.