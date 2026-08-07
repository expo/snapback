# LLP 0184 round 2 review — OpenAI Codex / GPT-5 family

**Verdict:** NOT READY  
**Bound to revision:** 74135492985dbcb563d0ed6cbd259d20875f0a35ba9a56cac87119b87151b28b  
**Reviewer:** OpenAI Codex, GPT-5 family; exact serving version not exposed  
**Blindness:** self-attested — read only my own family's round-1 review (`llp/reviews/0184-agent-accessible-control-plane.gpt-5.md`); did not read the other family's review or the run journal

## Round-1 concern resolution

1. **The completeness gate cannot detect undeclared console or client operations** — PARTIALLY RESOLVED

   Revision 2 replaces the voluntary-export wording with purportedly closed enumerations:

   > “`admin-ui/app.contract` supplies a closed, machine-readable enumeration of every `action` the console can invoke”  
   > “`packages/snapback-admin-client`'s public method list supplies a closed enumeration of every client method”

   (`llp/0184-agent-accessible-control-plane.rfc.md:342-347`; enforcement at `:378-388`).

   That genuinely improves the Contract action and client-method sides, but the console claim is false for the current application. Console credential recovery directly calls `client.requestConsoleApproval()` and `client.pollConsoleApproval()` from `admin-ui/main.ts:146-165`; neither operation is an action in the purportedly complete `admin-ui/app.contract` enumeration at `admin-ui/app.contract:102-167`. Rule 3 can catalog the two client methods, but it cannot prove that the console projects them. A new imperative console call can therefore remain invisible to the console/catalog join while all declared rows pass.

   I also found no existing closed AdminClient method manifest separate from the ordinary JavaScript class. If that list is proposed rather than shipped, the RFC still needs a mechanism proving that adding a public class method without adding it to the list fails.

   Resolution: cover bootstrap/authentication UI with a second mandatory action manifest, move those calls behind the Contract action boundary, or add a static boundary rule forbidding direct AdminClient control calls outside registered seams. Acceptance needs a negative fixture for an imperative console call and an undeclared public method.

2. **The instance projection identity does not track mutable runtime availability** — RESOLVED

   The new text explicitly acknowledges the limitation:

   > “The instance projection is a snapshot, though, not a subscription…”  
   > “Discovery availability is therefore advisory; **invocation admission is the authoritative check**”

   (`llp/0184-agent-accessible-control-plane.rfc.md:320-329`).

   Acceptance repeats that every direct tool performs runtime admission at call time (`:771-774`). Refetch and `runtimeProbe` are named freshness paths. This is a coherent implementation of the round-1 alternative that did not require a mutable availability generation.

3. **The bounded table scan is not a projection of the existing route as specified** — RESOLVED

   Revision 2 now says:

   > “table, limit, and offset, matching `DataQuery`'s shipped fields — not a cursor”  
   > “a stable/snapshot-bound cursor is a new storage semantic that needs an LLP 0031/storage-owner amendment”

   (`llp/0184-agent-accessible-control-plane.rfc.md:508-518`).

   Acceptance also specifies “offset paging, as shipped” (`:743-745`). This now matches `AdminClient.scanTable` and the existing route.

4. **`data.patch` invents authority-mode names and conflates authority axes** — PARTIALLY RESOLVED

   The invented `devImpersonation` name is gone, and revision 2 correctly names LLP 0024’s `devUser` and `devAdminBypass` tuple (`llp/0184-agent-accessible-control-plane.rfc.md:580-585`).

   The revised semantics are still defective. It describes both `devUser` and `devAdminBypass` as evaluation under “the application's own authorization,” then contrasts them with a separate “operator bypass.” LLP 0024 says the opposite: `devAdminBypass` is itself “Local admin bypass with an explicit reason,” and both modes are local/dev-only (`llp/0024-agent-operating-surface.spec.md:273-290`). All direct admin writes must record the actual authority tuple (`:285-289`).

   The derived-instance widening is also unsupported. OQ3 permits bypass on an LLP 0158 derived instance (`llp/0184-agent-accessible-control-plane.rfc.md:857-861`), while LLP 0158 says derived identity is recognized “solely for network-profile activation” (`llp/0158-instance-forking.rfc.md:950-957`). LLP 0167’s hosted-derived exception is likewise operation-specific to network-profile activation (`llp/0167-network-condition-profiles.rfc.md:218-237`). A disclosure flag cannot create missing hosted authority.

   Resolution: use `devUser` for impersonated local evaluation and `devAdminBypass` for explicit local bypass. If derived-hosted patching is intended, amend LLP 0024/0031 and the derived-instance owner first. Remove the second, semantically duplicate “operator bypass” category or define it strictly as a projection of the recorded `devAdminBypass` tuple.

5. **The preview/apply protocol for `data.patch` is not bound strongly enough** — PARTIALLY RESOLVED

   The apply token is a substantial fix. It is short-lived and single-use and binds target, startup, catalog/schema, row, version, normalized patch, diff, evaluation mode, reason, and expiry (`llp/0184-agent-accessible-control-plane.rfc.md:569-577`).

   It still binds only the coarse “authority evaluation mode,” not the authority tuple required by the round-1 concern and LLP 0024. Two `devUser` invocations with different `userId` or roles have the same mode. Likewise, bypass principal, bypass reason, and approval identity can change without changing the named mode. Acceptance tests mismatched patch/version/target but not authority substitution (`:747-751`).

   Resolution: bind and compare the complete prepared authority tuple—mode, user ID, roles, bypass reason, operator identity, and applicable approval identity—not merely the mode. Consumption and the version/authority checks must occur at one serialized apply boundary.

6. **The ephemeral-delete generation fence has an ABA hole** — RESOLVED

   Revision 2 now requires:

   > “expected **scope epoch and entry generation together**”  
   > “The server compares both under the room lock and fails on either mismatch”

   (`llp/0184-agent-accessible-control-plane.rfc.md:627-639`).

   Acceptance includes the required room-prune/recreate case (`:756-759`). This matches the implementation: each room incarnation gets a new `scope_epoch` while `next_entry_version` restarts at 1 (`src/ephemeral.rs:2114-2124`), `with_existing_room` executes under the room lock (`:7552-7569`), and the existing test demonstrates a reborn room with a newer epoch and entry version 1 (`:13345-13353`).

7. **The RFC assumes remediation contracts their owner leaves open** — RESOLVED

   The catalog now reserves `remediation` as null/absent until LLP 0146’s carrier and registry decisions land and explicitly refuses to mint its own enum (`llp/0184-agent-accessible-control-plane.rfc.md:304-309`). Wrappers preserve existing diagnostics in the meantime (`:465-470`), and Acceptance says remediation is not a prerequisite for this RFC’s Implemented status (`:766-770`). This respects LLP 0146’s unresolved carrier ownership at `llp/0146-agentic-authoring-affordances.rfc.md:967-973` and `:1203-1207`.

8. **The selected-operation scope contradicts its own open questions** — RESOLVED

   Force-resync v1 is now unambiguously single-subscription, with connection-wide behavior deferred (`llp/0184-agent-accessible-control-plane.rfc.md:601-607`, `:862-866`). OQ3 now states the intended local impersonation/derived bypass split, and OQ5 separates access disposition from approval posture and provisionally selects `confirmFirst` (`:857-874`).

   Those old scope contradictions are resolved. The authority selected for the patch is still invalid for the reasons in concern 4, but that is an owner/authority defect rather than the former open-question contradiction.

## New MATERIAL concerns (not in round 1)

1. **The revised six-value `agentAccess` model is not the mutually exclusive surface partition it claims to be**

   Revision 2 newly makes this a normative claim:

   > “one closed `agentAccess` disposition, defined purely by **which surfaces it has**”

   (`llp/0184-agent-accessible-control-plane.rfc.md:219-224`).

   Only `native`, `cliOnly`, and `api` describe surface topology. `mediated` describes participation/credential custody, `internal` describes support policy, and `unavailable` describes implementation status (`:226-233`). Those properties overlap the surface properties:

   - A mediated operation can expose typed CLI and MCP plan/initiate/poll/resume projections and therefore also satisfy `native`.
   - An internal route can have a stable typed HTTP projection and therefore also satisfy `api`.
   - An exposed-but-unbuilt operation can have CLI/MCP projections while satisfying `unavailable`; `acceptance.run` is already described as an exposed fixed control tool that returns `SNAPBACK_HOST_OP_UNIMPLEMENTED` (`:137-144`).
   - Rule 5 even proposes promoting “`cliOnly` to `api` plus a CLI” (`:392-396`), although `api` is defined as having no direct CLI.

   The checks only validate properties after a developer selects an enum value. They cannot derive a unique value from the registered facts, so “exactly one” serialization does not establish correct classification. Two implementations can classify identical operations differently and both pass.

   This is stronger than round 1’s DETAIL-level request for precedence: revision 2 now claims a mechanically enforceable pure surface axis while normatively placing nonsurface states inside it.

   Resolution: split this into independent closed axes—for example `surfaceAccess: native | cliOnly | api | none` and `operability: direct | mediated | internal | unavailable`—or provide exhaustive, mutually exclusive predicates and precedence rules that the compiler derives from source facts. Approval/destructiveness should remain independent as already proposed.

2. **The force-resync request requires an undefined and undiscoverable subscription generation**

   Revision 2 requires “that subscription's current generation” (`llp/0184-agent-accessible-control-plane.rfc.md:601-604`) but neither identifies the generation type nor adds a discovery projection or negative acceptance case for it.

   The current subscription inspection type exposes only ID, connection ID, and function (`src/local.rs:376-382`, `:6338-6345`). `LiveSubscription` has an optional `expected_generation`, but that is explicitly the sessions artifact generation pinned at establishment, not a per-subscription incarnation fence (`src/local.rs:3194-3202`). Subscription IDs are UUIDv7 bearer capabilities (`:15477-15480`).

   The protocol owner’s ordinary subscription-scoped resync transition requires only `subscription_id` (`llp/0095-client-lifecycle-and-conformance.spec.md:237-241`). LLP 0095’s issuer/connection generation belongs to the distinct authorization-invalidation transition (`:250-255`). The `ResyncRequired` wire shape likewise has no generation field (`src/live_wire.rs:125-146`).

   An operator therefore cannot discover or supply the required value, and an implementer cannot tell whether the RFC means artifact generation, connection generation, or a new subscription-incarnation generation. Acceptance only tests the recovery lifecycle (`llp/0184-agent-accessible-control-plane.rfc.md:753-755`), not stale-fence rejection.

   Resolution: either define and expose a new per-subscription incarnation fence, amend the live owner, and test stale/mismatched values, or remove the invented generation and justify the existing UUID subscription ID plus connection ID and startup nonce as the fence. Do not reuse the optional sessions artifact generation or LLP 0095 authorization-invalidation generation under an ambiguous name.

3. **`config.unset` is incorrectly classified as secret mediation**

   The RFC groups `config.set` and `config.unset` together and says both are a “mediation/credential-custody problem” (`llp/0184-agent-accessible-control-plane.rfc.md:161-162`, `:540-550`).

   That contradicts both the semantic owner and shipped implementation. LLP 0036 defines `config.unset` as removing an entry value and already specifies direct CLI and one-to-one MCP projections (`llp/0036-app-secrets-and-config.rfc.md:683-710`). The handler is explicit:

   > “Carries no value, so the transit rule does not apply; the admin write gate does.”

   (`src/server.rs:17522-17535`).

   Treating unset as mediated with secret carriers is therefore a defective catalog decision and violates this RFC’s own rule that UI-first history is not a valid mediation reason (`llp/0184-agent-accessible-control-plane.rfc.md:251-253`).

   Resolution: separate the rows. `config.set` may require a mediated secret carrier; `config.unset` should be a direct AdminWrite operation with destructive/approval metadata and only the entry identifier as input.

4. **Commit-only guide matching does not establish a build-matched carrier**

   The proposed packaged `mcp-control` carrier compares only `buildIdentity.commit` and claims the same mismatch-refusal discipline as the catalog (`llp/0184-agent-accessible-control-plane.rfc.md:438-448`).

   LLP 0061 requires both guide content hash and server build identity so consumers can detect stale bytes (`llp/0061-agent-first-snapback-guide.rfc.md:467-497`). The current embedded guide identity already contains both `content_hash` and `build_commit` (`src/guide_mcp.rs:20-62`). The binary identity additionally records crate version, dirty status, and build profile; dirty or unidentifiable builds are deliberately treated conservatively (`src/identity.rs:41-60`).

   Two builds can share a commit while differing because of dirty source/guide files or generation inputs. `"unknown"` can also collide. The proposed comparison would then serve mismatched operating instructions while claiming fail-closed build identity.

   Resolution: package and compare the guide content hash plus a sound build identity or artifact digest, and refuse equality claims for unknown/dirty identities. When a server is reachable, its embedded guide remains authoritative.

## New DETAIL concerns (not in round 1)

1. **The Guide contract requires an MCP name for `cliOnly` operations**

   `cliOnly` deliberately means “no MCP tool yet” (`llp/0184-agent-accessible-control-plane.rfc.md:229`), but every `native` or `cliOnly` Guide entry must include the “exact MCP tool name” (`:486-490`). Require an MCP name only for `native`; a `cliOnly` page should instead present its `mcpDeferralReason`.

2. **Receipts should identify, not reproduce, the apply-token bearer**

   The RFC asks for a receipt “linking the consumed apply token” (`llp/0184-agent-accessible-control-plane.rfc.md:586-589`). State that this means a non-authorizing token ID or digest. Even a single-use token should not be copied verbatim into logs or receipts.

3. **The operator ephemeral delete does not specify its authority input**

   The ABA fence is now sound, but the operation only says it “reports whether authorization was evaluated or explicitly bypassed” (`llp/0184-agent-accessible-control-plane.rfc.md:633-636`). It should name the input/authority tuple that selects those paths and explain how the existing room-authority generation carried by removal notifications (`src/ephemeral.rs:8131-8188`) is obtained. A conservative always-bypass v1 would be implementable, but it should say so explicitly.

## Verification notes

- Recomputed SHA-256 from the file on disk: `74135492985dbcb563d0ed6cbd259d20875f0a35ba9a56cac87119b87151b28b`.
- Rechecked the fixed MCP inventory: `CONTROL_TOOLS` has 17 fixed control tools; generated app-data tools are appended separately. `acceptance.run` still proxies the real unimplemented operation rather than fabricating success.
- Confirmed the corrected table-scan contract, the shipped cron/job/cleanup/disconnect/config projections, the assets CLI/host-operation surface, and the current 30-request/41-identity host-operation drift claim.
- Checked authority and scope against LLPs 0017, 0024, 0031, 0036, 0042, 0044, 0058, 0061, 0094, 0095, 0146, 0158, 0167, and 0179. The separate `ControlCatalog`/`AppDescriptor` boundary and the decision to decline raw simulated publish remain coherent.
- A bounded row patch is mechanically feasible through the existing `BufferedWrite::Patch` path (`src/storage.rs:885-901`) and ordinary commit machinery, including membership transitions, projections, derived indexes, asset-reference checks, and version advancement (`src/storage.rs:5622-5961`). The unresolved defects concern authority and preview/apply binding, not the existence of a safe storage seam.
- The revised ephemeral epoch/generation fence was checked against the actual room allocator, room-lock path, removal notification, and room-recreation test. That mechanism is feasible as specified.
- I did not run builds or integration tests. The three proposed operations and packaged guide carrier are not implemented, so their atomicity, runtime admission, external package pairing, and end-to-end acceptance claims could only be reviewed statically.
- I could not verify an existing closed AdminClient public-method manifest or an existing callable force-resync injection seam. I also did not exhaustively classify every route, command, console callback, and client method; the proposed compiler must perform that exhaustive proof.