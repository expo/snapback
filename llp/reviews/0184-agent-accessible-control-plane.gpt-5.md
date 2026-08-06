# LLP 0184 review — OpenAI Codex / GPT-5 family

**Verdict:** NOT READY  
**Bound to revision:** 39e3bc4ffbdf7b8210941a78def35a7fa4b15d1bf26aec929fa93cde80d180e8 (content sha256 of llp/0184-agent-accessible-control-plane.rfc.md at review time)  
**Reviewer:** OpenAI Codex, GPT-5 family; exact serving version not exposed  
**Blindness:** self-attested — did not read llp/reviews/0184-* or the run journal

## MATERIAL concerns

1. **The completeness gate cannot detect undeclared console or client operations**

   The central promise is that “silence is a build failure” (`llp/0184-agent-accessible-control-plane.rfc.md:34-37`) and that a new operation leaving the join incomplete fails proof (`:326-327`). Rules 2 and 3, however, only say that console actions “export” identities and that public `AdminClient` methods “that perform a control operation” resolve to rows (`:310-314`). They do not define a closed, machine-enumerable source for all console interactions and public methods, nor how a UI-local action is “excluded explicitly.”

   Consequently, a developer can add an ordinary callback, form handler, or public method without an export, and the catalog compiler has nothing to notice. The join can prove coherence among declarations it sees, but not completeness of declarations.

   LLP 0031 records the same failure mode for routes: Axum cannot enumerate its routes, so a separate descriptive list cannot prove parity and a new `.route(...)` could bypass the registry (`llp/0031-server-route-taxonomy.spec.md:181-188`). The current guide join demonstrates that this is not hypothetical: `guide/surface-map.md:146-182` has 37 host-operation rows but omits the four seed identities documented at `guide/operating/host-ops.md:104-107`.

   Resolve this by defining mandatory compiler-visible registration seams for console actions, CLI commands, MCP tools, and public client methods. Presentation-only exclusions need a typed record and reason. Negative fixtures must prove that adding an unannotated action or method fails generation.

2. **The instance projection identity does not track mutable runtime availability**

   The proposed identity contains startup nonce, target/profile, enabled capabilities, and catalog digest (`llp/0184-agent-accessible-control-plane.rfc.md:270-275`) and is claimed to prevent static metadata from misrepresenting a running target (`:277-279`). But profile and capability state can change without a process restart. The RFC’s own network-profile journey sets and restores profiles within one startup (`:102-115`), leaving both startup nonce and build digest unchanged.

   A previously fetched projection can therefore remain identity-valid while its profile or enabled-capability facts are stale. Invocation-time admission (`:685-687`) prevents unauthorized execution, but does not make discovery truthful, contrary to Acceptance’s requirement that availability be “runtime-observed rather than inferred from static tool presence” (`:619-620`).

   Resolve this with an availability revision/generation bound to every mutable availability input, or explicitly fresh per-operation probes with defined expiry and cache behavior. The RFC should also state that discovery availability is advisory and that invocation admission remains authoritative.

3. **The bounded table scan is not a projection of the existing route as specified**

   P1 describes a scan “over the existing schema-aware admin route” that “requires table, limit, and cursor” (`llp/0184-agent-accessible-control-plane.rfc.md:410-414`) and Phase 2 classes it as projection of a shipped operation (`:558-562`).

   The current route has `limit` and `offset`, not a cursor: `DataQuery` declares those fields at `src/admin.rs:4924-4928`, and `admin_data` passes `offset` directly to `scan_table` at `src/admin.rs:4990-5014`. `AdminClient.scanTable` likewise emits `?limit=...&offset=...` (`packages/snapback-admin-client/index.mjs:555-563`), and the console paginates by offset (`admin-ui/admin-boundary.mjs:200-209`).

   An opaque wrapper around an offset would not provide stable paging under concurrent writes. Either specify offset paging and its limitations, or treat a stable/snapshot-bound cursor as a new API/storage semantic with an owning-document amendment and move it out of the pure-projection phase.

4. **`data.patch` invents authority-mode names owned by LLP 0024 and conflates them with LLP 0031 authority axes**

   The RFC disclaims ownership of authority modes (`llp/0184-agent-accessible-control-plane.rfc.md:61-66`), but its required `data.patch` contract introduces `devImpersonation` and `operatorBypass` (`:463-470`).

   LLP 0024’s closed authority-mode identifiers are `none`, `unauthenticated`, `devUser`, `devAdminBypass`, and `servicePrincipal` (`llp/0024-agent-operating-surface.spec.md:273-289`). LLP 0042 repeats those as pinned IDs (`llp/0042-agent-mcp-surface.rfc.md:98-115`). Meanwhile, LLP 0031 independently defines route-level `InvocationAuthority`, including `Operator` and `DevImpersonation`, but no `operatorBypass` (`llp/0031-server-route-taxonomy.spec.md:198-205`).

   As written, the checked join would encounter conflicting vocabularies, and an implementation could mistake path-level operator authority for the application authority tuple under which the patch is evaluated.

   Resolve this by specifying the existing LLP 0024 tuple—presumably `devUser` or `devAdminBypass`—separately from LLP 0031’s credential, invocation-authority, route-policy, and effect axes. If a genuinely new mode is needed, amend LLP 0024 first.

5. **The preview/apply protocol for `data.patch` is not bound strongly enough**

   The RFC requires a preview and a later receipt “linking preview digest” (`llp/0184-agent-accessible-control-plane.rfc.md:465-474`) but never requires the apply request to present that digest or a preview capability. A receipt written after commit cannot prove that the committed normalized patch is the patch that was reviewed.

   Expected row/database version prevents stale-row writes, but it does not prevent previewing patch A and applying patch B against the same version, nor authority/reason or target substitution between the two calls. This leaves the principal safety property of the destructive bypass underspecified.

   Resolve this with a short-lived, single-use apply token or digest that is required on apply and binds at least target identity, startup nonce, catalog/schema identity, table, row identity, expected version, normalized patch, validated before/after diff, authority tuple, reason, and expiry. The server must compare and consume it atomically before the ordinary changeset commit.

6. **The ephemeral-delete generation fence has an ABA hole**

   The operator delete requires only “expected entry generation” and startup nonce (`llp/0184-agent-accessible-control-plane.rfc.md:508-511`). In the shipped ephemeral model, `entryVersion` is meaningful only within a `scopeEpoch` (`guide/realtime/ephemeral-state.md:146-150`). Every room incarnation receives a new epoch, while `next_entry_version` restarts at 1 (`src/ephemeral.rs:2114-2124`). The explicit recreation test proves a reborn room has a higher epoch and `entry_version == 1` (`src/ephemeral.rs:13345-13353`).

   A room can therefore empty and be recreated during the same server startup. A stale observation of version 1 could match a different entry in the new incarnation; startup nonce does not fence that ABA transition.

   Require both `scopeEpoch` and `entryVersion`, compare them atomically with collection/scope/key and current entry ownership under the room lock, and fail on either mismatch. Acceptance needs a room-prune/recreate test where the new entry reuses the old version.

7. **The RFC assumes remediation contracts that their semantic owner explicitly leaves open**

   The catalog schema “must” represent LLP 0146 remediation kinds (`llp/0184-agent-accessible-control-plane.rfc.md:265-268`), and every wrapper refusal is expected to carry an LLP 0146 remediation projection (`:369-372`).

   LLP 0146 defines remediation safety axes, but explicitly says the carrier belongs to LLP 0094/0095 and remains undecided (`llp/0146-agentic-authoring-affordances.rfc.md:966-973`). Its OQ6 also leaves both the kind registry and carrier open (`:1203-1207`). LLP 0184 has no delivery dependency that settles those owner decisions before Phase 1 schema generation or Phase 2 wrappers.

   Resolve this by either sequencing the LLP 0094/0095 and remediation-registry decision as a prerequisite, or narrowing v1 to preserve existing diagnostics opaquely while cataloging only currently authoritative remediation metadata. The catalog must not freeze a duplicate enum or carrier.

8. **The selected-operation scope contradicts its own open questions**

   Section B unconditionally specifies connection-wide force-resync targeting—“one subscription or all subscriptions on one connection” (`llp/0184-agent-accessible-control-plane.rfc.md:484-490`)—while Open Question 4 asks whether connection-wide targeting belongs in v1 at all (`:706-708`). Phase 3 therefore does not provide an implementer a settled v1 scope.

   The direct-patch target rule is similarly unclear: `:462` says “local non-production and LLP 0158 derived instances only,” while OQ3 asks whether bypass is allowed on ordinary local instances (`:703-705`). OQ5 leaves the approval and resulting `agentAccess` projection for destructive tools unsettled (`:709-712`), even though the recommendation directs the project to land the three selected operations (`:714-722`).

   Choose the v1 force-resync target, patch target/bypass rule, and initial projection/approval posture, or narrow the recommended decision to the catalog and Phase 0 while explicitly leaving the three operations pending their semantic-owner decisions.

## DETAIL concerns

1. **The five dispositions need normative precedence**

   `native` and `api` are not structurally exclusive: a native operation will normally also have a stable HTTP or `AdminClient` projection and therefore satisfies the stated `api` contract (`llp/0184-agent-accessible-control-plane.rfc.md:202-204`). “Common” versus “rare” is not mechanically defined, and `mediated` is orthogonal to how many projections exist. Exactly-one serialization is enforceable, but classification consistency would benefit from an explicit precedence rule and a recorded rationale/evidence field.

2. **Forced-resync fencing needs separate request shapes**

   “Current connection/subscription generation” (`llp/0184-agent-accessible-control-plane.rfc.md:488-490`) is ambiguous. Subscription-targeted and connection-wide requests should name their exact required generations separately. If connection-wide targeting survives, the contract should say whether subscriptions added concurrently are included, excluded, or cause a membership-generation conflict.

3. **The 17-tool wording should distinguish fixed control tools from total `tools/list` output**

   `CONTROL_TOOLS` contains 17 entries, but `listTools()` appends generated app-data tools (`packages/snapback-cli/mcp-control.mjs:987-1005`). “The fixed control-plane inventory contains 17 tools” would avoid implying that every `tools/list` response has exactly 17 entries.

## Verification notes

- **Revision identity:** The current target file hashed to `39e3bc4ffbdf7b8210941a78def35a7fa4b15d1bf26aec929fa93cde80d180e8`, not the `bd7584d1...` value supplied in the request. I cannot truthfully bind this review to bytes that were not present. The file was also untracked in this checkout, so the requested revision was not recoverable from its Git history.

- **Control MCP inventory:** I counted 17 entries in `CONTROL_TOOLS`, from `snapback_start` at `packages/snapback-cli/mcp-control.mjs:191-199` through `snapback_acceptance_run` at `:431-438`. The test lists the same 17 fixed names at `packages/snapback-cli/mcp-control.test.mjs:110-121`. Dynamic app-data tools can be appended separately.

- **`acceptance.run`:** The implementation proxies `acceptance.run` to the server rather than fabricating success (`packages/snapback-cli/mcp-control.mjs:903-912`). The integration test asserts `ok: false` and diagnostic `SNAPBACK_HOST_OP_UNIMPLEMENTED` (`packages/snapback-cli/mcp-control.test.mjs:332-338`). The RFC’s claim is correct.

- **Host-operation drift:** `guide/operating/host-ops.md:53` says 28 request spellings, and `:94-98` says 39 registry identities. The shipped mappings include `debug.networkProfileGet` and `debug.networkProfileSet` (`src/server.rs:15804-15807`), with corresponding registered identities at `src/server.rs:15161-15185`, supporting the RFC’s 30/41 correction. `guide/surface-map.md:175-176` contains those two but omits the four versioned seed identities, so the current generated-looking surface table is also incomplete.

- **Table scan:** Confirmed admin route registration at `src/admin.rs:3913-3919`, `AdminClient.scanTable` at `packages/snapback-admin-client/index.mjs:555-563`, and console use at `admin-ui/admin-boundary.mjs:198-211`. No direct Rust CLI command appears in the `HostCommand` variants at `src/cli.rs:702-813`, and no fixed control-MCP table-scan tool appears in `CONTROL_TOOLS`.

- **Cron and jobs:** Confirmed cron tick/run routes at `src/admin.rs:3941-3957`, job drain/list/show at `:3959-3999`, and matching `AdminClient` methods at `packages/snapback-admin-client/index.mjs:577-600`. I found no direct CLI or fixed control-MCP projections.

- **Ephemeral cleanup:** Confirmed the admin route at `src/admin.rs:4001-4007`, `AdminClient.cleanupEphemeral` at `packages/snapback-admin-client/index.mjs:603-605`, and console invocation at `admin-ui/admin-boundary.mjs:242-250`. No direct CLI or fixed control-MCP projection was found.

- **Connection disconnect and config:** Confirmed the admin-gated disconnect route at `src/server.rs:8735-8740`. Config status/plan/set/unset/verify routes are registered at `src/server.rs:8742-8781`; `AdminClient` exposes status and verify only (`packages/snapback-admin-client/index.mjs:607-615`). `guide/operating/secrets-and-config.md:78-89` documents all five route operations. LLP 0036 already proposes `snapback config status|plan|set|unset|verify`, with values through stdin rather than argv (`llp/0036-app-secrets-and-config.rfc.md:706`), so 0182’s projection work must remain subordinate to that owner.

- **Guide discovery drift:** `guide/index.md:35-40` prominently documents resource-only `snapback mcp` and does not mention `mcp-control`. `guide/capabilities.md:99` still describes the network-profile fork exception/OQ3 as a GAP, while LLP 0167 records OQ3 as resolved and implemented (`llp/0167-network-condition-profiles.rfc.md:428-439`). These RFC claims are correct.

- **Authority boundaries:** LLP 0017 owns direct-edit and ephemeral-inspector policy (`llp/0017-admin-console-inspection-surface.rfc.md:60-72`). Its direct-edit requirements at `:423-450` are broadly compatible with a bounded patch, and its ephemeral section already classifies forced resync and entry deletion as privileged writes (`:452-469`). LLP 0031 explicitly distinguishes app-data publish-parity deletion from the still-unbuilt operator delete (`llp/0031-server-route-taxonomy.spec.md:564-584`). Apart from the authority vocabulary and missing epoch fence identified above, 0182 respects those boundaries.

- **`ControlCatalog` versus `AppDescriptor`:** The separation holds. LLP 0179 defines an environment-independent application vocabulary (`llp/0179-generated-app-descriptor-and-surfaces.rfc.md:69-93`, `:154-177`) and states that binding is not authorization (`:288-302`). A build/instance-bound operator catalog is materially different and need not merge with it.

- **Simulated publish:** The rejection is coherent with LLP 0146’s real-client scenario-runner direction. A raw privileged write would not exercise connection, grant, heartbeat, TTL, or publish-policy behavior. I found no unaddressed capability that requires retaining the raw simulated-publish proposal.

- **Not verified:** I did not run builds or integration tests because this checkout is read-only and Rust execution requires the repository’s Ibex bootstrap. I did not exhaustively classify every route, console callback, CLI subcommand, or public client method; checks covered the quantitative claims and capability rows named in the review request. I also did not verify hosted-runtime behavior for the proposed operations, since they are unimplemented, nor locate an existing callable force-resync injection seam—the protocol behavior is plausible, but implementation feasibility still needs an owner-level design.