# LLP 0184 round 3 review — OpenAI Codex / GPT-5 family

**Verdict:** NOT READY  
**Bound to revision:** 1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030  
**Reviewer:** OpenAI Codex, GPT-5 family; exact serving version not exposed  
**Blindness:** self-attested with one disclosed tooling accident — I intentionally read only my family’s round-1 and round-2 reviews (`llp/reviews/0184-agent-accessible-control-plane.gpt-5.md` and `llp/reviews/0184-agent-accessible-control-plane.gpt-5-round2.md`) and did not open another family’s review or the run journal. One repository-wide `rg` command inadvertently surfaced one matching line from `llp/reviews/0184-agent-accessible-control-plane.run.md:240`, restating the current RFC’s `snapback admin link` example. I did not inspect that file further or use that line as review evidence.

## Round-1/round-2 concern resolution

1. **Completeness cannot detect undeclared console or client operations — round 1, still open after round 2** — NOT RESOLVED

   Revision 3 says `admin-ui/app.contract` is a “closed, machine-readable enumeration of every `action` the console can invoke” and that the AdminClient public method list is similarly closed (`llp/0184-agent-accessible-control-plane.rfc.md:376-381`). It acknowledges the existing imperative exceptions and proposes:

   > “a second declared call-site manifest”

   for `admin-ui/main.ts` and `src/admin/setup.html` (`:439-444`).

   That catalogs the two known exceptions, but it remains a voluntarily maintained manifest. Nothing requires a future console module that directly imports `AdminClient`, calls `fetch`, or installs an imperative callback to appear in it. The existing exceptions demonstrate the problem: `admin-ui/main.ts:155,165` directly calls `requestConsoleApproval` and `pollConsoleApproval`, while `src/admin/setup.html:271-273` has its own raw `fetch` wrapper.

   The AdminClient claim is also not true of the current package. `packages/snapback-admin-client/package.json:6-8` exports only `index.mjs`; there is no closed public-method manifest, and the public methods are ordinary class methods beginning at `packages/snapback-admin-client/index.mjs:19`. The RFC does not specify prototype reflection, AST enforcement, an import boundary, or a negative fixture proving that an undeclared method or imperative console call fails.

   The declarative Contract portion is improved, but the central “silence is a build failure” property remains unproved. Resolution still requires a mechanically closed boundary and negative fixtures, not another hand-authored list of currently known call sites.

2. **Mutable instance availability can remain identity-valid while stale — round 1** — RESOLVED

   The revised text now explicitly states that the projection is a snapshot, can become stale while startup nonce and catalog digest remain unchanged, and that:

   > “invocation admission is the authoritative check”

   (`llp/0184-agent-accessible-control-plane.rfc.md:345-363`).

   Refetch and `runtimeProbe` are defined freshness paths. Acceptance repeats the call-time admission requirement at `:908-911`. This is coherent and no longer overclaims that projection identity proves current availability.

3. **Table scan claimed a cursor that the shipped route does not have — round 1** — RESOLVED

   Revision 3 correctly specifies “table, limit, and offset” and explicitly declines to disguise offset paging as a cursor (`llp/0184-agent-accessible-control-plane.rfc.md:595-605`).

   This matches `src/storage.rs:4145-4193`, which implements deterministic offset paging, and `src/admin.rs:5012-5014`, which invokes that API. The known concurrent-write limitation is now disclosed.

4. **`data.patch` invented or conflated authority modes and widened derived authority without an owner grant — round 1/round 2** — RESOLVED

   The new text correctly uses LLP 0024’s `devUser` and `devAdminBypass`, describes bypass as an admitted skip rather than application-policy evaluation, and removes the supposed third “operator bypass” mode (`llp/0184-agent-accessible-control-plane.rfc.md:697-704`).

   It also now recognizes that LLP 0158 permits derived identity solely for network-profile activation and explicitly keeps the patch’s derived leg unavailable until an owner amendment lands (`:662-674`, `:888-889`). That matches LLP 0158 at `llp/0158-instance-forking.rfc.md:950-957`.

   The remaining false operator-identity claim belongs to the preview/apply concern below.

5. **Preview/apply was not bound to the complete authority tuple — round 1/round 2** — PARTIALLY RESOLVED

   The token now binds target identity, startup nonce, catalog/schema identity, table, row, expected per-row version, normalized patch, validated diff, authority tuple, reason, and expiry, and is single-use (`llp/0184-agent-accessible-control-plane.rfc.md:683-711`). This substantially fixes the original patch-substitution defect.

   However, revision 3 defines the bypass tuple as including “operator identity” (`:686-689`) and requires receipts to disclose `devAdminBypass plus operator identity and reason` (`:881-887`). That tuple does not exist in the cited owner or implementation:

   - LLP 0024 defines `devAdminBypass` as local admin bypass with a reason, not an operator principal (`llp/0024-agent-operating-surface.spec.md:273-289`).
   - LLP 0058 says `AdminBypass` grants an operator access path “but no app identity” (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1083-1112`).
   - `ResolvedAppAuthority::AdminBypass` contains only `reason` (`src/auth/invocation.rs:278-320`).
   - The shipped host-ops projection explicitly emits `actor_principal: None` for `devAdminBypass` (`src/host_ops.rs:583-592`).

   Round 2’s suggested resolution itself included an unverified operator-identity assumption, and revision 3 copied that assumption into a normative requirement. As written, the required tuple and receipt are unbuildable. The RFC must either bind the actual existing tuple or make an explicit owner-level decision to introduce and authenticate a stable operator/credential identity.

6. **Ephemeral-entry deletion had an ABA hole — round 1** — RESOLVED

   Revision 3 requires collection/room/entry identity plus both scope epoch and entry generation, compared under the room lock, and includes the required prune/recreate acceptance case (`llp/0184-agent-accessible-control-plane.rfc.md:748-770`).

   This matches the existing room-incarnation and entry-generation behavior. A restarted version counter can no longer make a stale delete match a reborn room.

7. **The RFC assumed a remediation registry/carrier that LLP 0146 leaves open — round 1** — RESOLVED

   The catalog now keeps remediation absent until LLP 0146 lands its carrier and registry answer and explicitly declines to mint a competing enum (`llp/0184-agent-accessible-control-plane.rfc.md:338-343`). Wrappers preserve existing diagnostics, and remediation is not an Implemented-status prerequisite (`:550-555`, `:903-907`).

8. **Selected operation scope contradicted its open questions — round 1** — RESOLVED

   `debug.live.forceResync` is now unambiguously single-subscription in v1, with connection-wide behavior deferred (`llp/0184-agent-accessible-control-plane.rfc.md:721-742`, `:1000-1004`). The patch target rule is also explicit at `:662-674`.

   The new derived-authority inconsistency affecting the ephemeral delete is recorded separately below; it is not the old open-question contradiction.

9. **The access classification was not mutually exclusive — round 2** — PARTIALLY RESOLVED

   The new `surfaceAccess` field genuinely repairs the surface-topology portion. Given the presence or absence of CLI, MCP, and stable API projections, `native`, `cliOnly`, `mcpOnly`, `apiOnly`, and `none` can be made mutually exclusive (`llp/0184-agent-accessible-control-plane.rfc.md:239-252`).

   The replacement nevertheless moves the seam into `operability` rather than eliminating it:

   - `unavailable` is implementation status, not “who may invoke.” It explicitly forces `surfaceAccess: none` (`:254-261`), so the fields are not independent.
   - The RFC immediately encounters the exposed-but-unbuilt counterexample it said motivated the split. It declares `(mcpOnly, unavailable)` contradictory and relabels `acceptance.run` as `(mcpOnly, internal)` (`:270-275`). But LLP 0042 explicitly defines it as an externally exposed desired tool whose runner is deferred (`llp/0042-agent-mcp-surface.rfc.md:198-208`). That is precisely “desired but not implemented,” while `internal` is defined as unsupported as an author/operator action. The relabeling makes the owner’s decision false merely to satisfy the new schema.
   - `mediated` says a person “must approve” (`llp/0184-agent-accessible-control-plane.rfc.md:258-260`), while the supposedly independent `approvalPosture` includes `humanApprovalRequired` and may coexist with `(native, direct)` (`:277-282`). Such an operation satisfies both `direct` and the normative definition of `mediated`.
   - Operability can vary by carrier. Revision 3 lists stdin/file-descriptor and browser handoff carriers for the same `config.set` operation (`:639-648`); LLP 0036 explicitly permits an agent to acquire a credential and then call `config.set` itself (`llp/0036-app-secrets-and-config.rfc.md:836-856`). That invocation is direct, while browser/custodian entry is mediated.

   The row already has a separate `status` field (`llp/0184-agent-accessible-control-plane.rfc.md:295-320`). Implementation status, support policy, mediation requirements, and human approval should not be collapsed back into one “operability” value. The author must decide whether classification belongs to the semantic operation, each invocation variant, or each projection/credential carrier.

10. **Forced resync required an undefined subscription generation — round 2** — RESOLVED

   Revision 3 explicitly rejects a new generation and uses connection ID, UUIDv7 subscription ID, and startup nonce (`llp/0184-agent-accessible-control-plane.rfc.md:721-736`).

   The required identifiers are discoverable through `LiveSubscriptionInfo` (`src/local.rs:376-382`, `:6338-6345`), and subscription IDs are UUIDv7 identities (`:15477-15480`). LLP 0095’s subscription resync transition requires only `subscription_id` (`llp/0095-client-lifecycle-and-conformance.spec.md:237-241`), while `src/live_wire.rs:125-147` has no generation field. The revised fence is coherent.

11. **`config.unset` was incorrectly classified as secret mediation — round 2** — RESOLVED

   Revision 3 now treats unset as a direct AdminWrite mutation carrying only an entry identifier (`llp/0184-agent-accessible-control-plane.rfc.md:623-637`). That matches `src/server.rs:17522-17535` and LLP 0036’s one-to-one operation design at `llp/0036-app-secrets-and-config.rfc.md:683-710`.

12. **Commit-only guide matching did not establish a build-matched carrier — round 2** — RESOLVED

   The revised carrier no longer packages an independent guide snapshot. It invokes the co-installed native runtime and obtains the guide from that binary’s embedded `snapback mcp` surface, or proxies the reachable server’s embedded guide (`llp/0184-agent-accessible-control-plane.rfc.md:505-536`).

   This is buildable from the existing seams: the CLI package declares platform runtime optional dependencies (`packages/snapback-cli/package.json:86-89`), `resolveRuntimeBinary` resolves their exact binary (`packages/snapback-cli/index.mjs:175-238`), and `mcp-control` already uses that resolver (`packages/snapback-cli/mcp-control.mjs:20-29`, `:440-461`). The native guide reads its compile-time embedded manifest (`src/guide_mcp.rs:1-62`), generated by `build.rs:102-173`. Returning an explicit unavailable diagnostic when no compatible binary exists is also coherent.

## New MATERIAL concerns (not in round 1 or round 2)

1. **MATERIAL — The domain predicate is local-only but the completeness claim is cross-target**

   The revised predicate is:

   > “`RouteClass::SystemApi` routes, plus every `host_ops.*` identity, plus `app.ensure.provision`”

   (`llp/0184-agent-accessible-control-plane.rfc.md:394-412`).

   Against the Rust/local registry, this is now substantially correct: `RouteClass` has the claimed three variants, `direct_runner.*` is SystemApi, and `app.ensure.provision` is the named AppData/Operator-policy exception (`src/server.rs:15057-15068`).

   It is not an exhaustive Snapback control-plane predicate across targets. LLP 0031 explicitly says:

   > “The hosted arm has no enforceable route registry (the gateway is a hand-routed Worker)”

   (`llp/0031-server-route-taxonomy.spec.md:1130-1140`).

   That same section enumerates hosted system controls including cron run/status, config status, app reset, object eviction, host calls, and testing seams (`:1106-1119`). The implementation is indeed hand-routed in `cloudflare/src/gateway.js:110-173`; `/_snapback/api/object/evict`, for example, is a real hosted system API absent from the Rust `RouteClass` registry.

   Therefore a new or existing hosted control can remain absent from the catalog while every stated rule passes. Platform availability on a locally discovered semantic row also cannot prove parity with the hosted route actually installed.

   Resolution requires a closed declaration/enforcement seam for every hosted adapter or an explicit local-only catalog scope with separate target catalogs. Cloudflare acceptance files alone do not supply the enumerable checked join the RFC promises.

2. **MATERIAL — Derived-instance authority is still widened outside the one operation that received the new caveat**

   The authority section correctly says LLP 0158 recognizes derived identity only for network-profile activation and that the catalog cannot create grants (`llp/0184-agent-accessible-control-plane.rfc.md:97-106`). Section A now honors that boundary for `data.patch`.

   Section C does not. It declares the new operator ephemeral-entry delete “local/derived-only” (`:754-767`) without making derived eligibility conditional on an LLP 0158 owner amendment or requiring the derived case to remain unavailable. Section B similarly refuses only “primary hosted instances” (`:738-742`), leaving any derived-target interpretation unstated.

   The stale contradiction also survives in Risks:

   > “Restrict v1 to existing-row patches on local/derived instances”

   (`:967-970`),

   despite §A and Acceptance saying derived patching must be refused until LLP 0158 grants recognition (`:662-674`, `:888-889`).

   Resolution is to make all three v1 target rules exact and owner-valid: either local-only with explicit derived refusals, or dependent on named owner amendments. The catalog cannot infer that a grant proposed for `data.patch` also authorizes forced resync or ephemeral deletion.

## New DETAIL concerns (not in round 1 or round 2)

1. **DETAIL — Forced-resync acceptance does not test the new fence’s negative cases**

   The request contract now depends on exact connection ID, subscription ID, and startup nonce, but Acceptance proves only the positive resync/re-snapshot lifecycle (`llp/0184-agent-accessible-control-plane.rfc.md:890-892`). Add negative witnesses for a wrong connection, unknown/retired subscription, and stale startup nonce. The design is coherent without these tests, but the safety fence should be exercised directly.

## Verification notes

- Recomputed the target SHA-256 twice; it is `1260f4e716b257f27f9756ff2ef374c22e0bd3c49ad23dc962f263619c3fe030`.

- Rechecked the concrete classifications named in the request:

  - Network-profile get/set have CLI and MCP projections and fit `(native, direct)`.
  - Assets have a rich Rust CLI and host operations but no fixed control-MCP tools, fitting `cliOnly`.
  - `host.restart` has the fixed `snapback_restart` MCP tool (`packages/snapback-cli/mcp-control.mjs:208-214`) but no `Restart` variant in the current Rust `HostCommand` (`src/cli.rs:702-819`), fitting the current `mcpOnly` topology.
  - `function.run` has both the Rust `Run` command (`src/cli.rs:733-744`) and `snapback_run_function` (`packages/snapback-cli/mcp-control.mjs:414-428`), fitting `native`.
  - `app.ensure.provision` is an AppData-positioned, AdminWrite/Operator operation and fits API-only topology.
  - `snapback admin link` is a real CLI-mediated workflow.
  - `config.unset` is direct; `config.set` has carrier-dependent direct and mediated forms.
  - `acceptance.run` is the counterexample the proposed `operability` model mishandles.
  - The CLI-only declaration family is present in `HostCommand`, including telemetry, auth, fork, and build identity (`src/cli.rs:752-819`), without corresponding server routes.

- Rechecked the fixed MCP inventory by invoking `listTools` against a fixture: the first 17 names are the claimed fixed control tools, followed by generated app-data tools. `acceptance.run` still proxies the real server operation and returns the pinned unimplemented diagnostic rather than fabricating success (`packages/snapback-cli/mcp-control.mjs:903-912`).

- The per-row-version claim is correct. `scan_table` returns `_version` for each row (`src/storage.rs:4145-4193`), and `get_row_version` reads that row’s own committed version (`src/storage.rs:12650-12670`). An unrelated row write does not change this row’s version.

- The proposed apply-token field set is otherwise coherent and the ordinary buffered patch/changeset machinery provides a feasible implementation substrate. I did not verify atomicity by execution because `data.patch` does not yet exist.

- The resync fence is discoverable and coherent as specified. I did not locate an existing operator injection function; implementation must add one that emits the ordinary `ResyncRequired` path rather than creating a second protocol transition.

- The ephemeral epoch/generation fence remains feasible against the existing room-lock and notification machinery.

- I did not run Rust builds or integration tests. The catalog compiler and the three proposed operations are not implemented, and the checkout is read-only. The native-guide carrier was verified statically, not through a packed npm installation on every supported platform.

- I could not verify any existing closed AdminClient method manifest, console imperative-call boundary, or hosted route declaration artifact; those absences are findings rather than merely unverified implementation details.

- The remaining defects are solvable, but not all by another drafting pass. The false completeness and operator-tuple claims can be repaired mechanically once their registration/identity seams are chosen. The access-axis model, hosted catalog scope, and derived-operation grants require explicit author and semantic-owner judgment.