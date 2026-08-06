# LLP 0182 round 4 review — OpenAI Codex / GPT-5 family

**Verdict:** NOT READY  
**Bound to revision:** 3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868  
**Reviewer:** OpenAI Codex, GPT-5 family; exact serving version not exposed  
**Blindness:** self-attested — read only my own family's round-1/2/3 reviews (gpt-5.md + gpt-5-round2.md + gpt-5-round3.md); did not read the other family's review or the run journal

## Round-1/2/3 concern resolution

1. **Completeness cannot detect undeclared console or client operations — round 1, still open after round 3** — NOT RESOLVED

   Revision 4 now accurately admits that the secondary console manifest is not closed:

   > “This second manifest is v1's chosen posture, hand-maintained rather than mechanically enforced”  
   > “nothing technically stops a future imperative `AdminClient` call from being added … without a manifest entry”

   (`llp/0182-agent-accessible-control-plane.rfc.md:528-543`).

   That is an honest scope decision, but the rest of the RFC still claims the stronger property: “Every console action … must be cataloged” and “silence is a build failure” (`:48-53`); rule 10 says a new console action with an incomplete join fails proof (`:575-576`); Acceptance says a bootstrap/setup-page admin call lacking a join fails (`:1028-1032`). Those claims are false under the explicitly selected posture. The proposed negative fixture can prove that known manifest entries are checked, but, as the RFC itself says at `:539-541`, cannot detect a third imperative call.

   The AdminClient half is also unchanged. The RFC says its “public method list supplies a closed enumeration” (`:431-432`) without specifying prototype reflection, AST enforcement, or a generated export boundary. The current package exports only `index.mjs` (`packages/snapback-admin-client/package.json:6-8`), and its public operations remain ordinary class methods beginning at `packages/snapback-admin-client/index.mjs:19`; I found no closed method manifest or completeness test.

   Resolve this by either enforcing closed import/reflection/AST boundaries or narrowing Summary, rule 10, and Acceptance to the mechanically closed `app.contract` and explicitly declared manifests. An acknowledged audit-only seam cannot simultaneously support the RFC’s unqualified completeness guarantee.

2. **The access classification is not yet fully independent and unique — round 2, partially resolved in round 3** — PARTIALLY RESOLVED

   The `unavailable` coupling is genuinely fixed. Revision 4 says:

   > “`surfaceAccess` is **not** forced to `none`”

   (`llp/0182-agent-accessible-control-plane.rfc.md:286`), classifies `acceptance.run` as `(mcpOnly, unavailable)` (`:315-321`), and makes rule 7 validate that every exposed projection returns the pinned unavailability diagnostic (`:563-570`). That matches the implementation: the MCP tool proxies `acceptance.run` (`packages/snapback-cli/mcp-control.mjs:903-912`), and the host-operation core returns `SNAPBACK_HOST_OP_UNIMPLEMENTED` (`src/host_ops.rs:1457-1466`).

   The `mediated`/`approvalPosture` overlap remains. `direct` explicitly permits `humanApprovalRequired`, while `mediated` includes an “out-of-band approval” (`llp/0182-agent-accessible-control-plane.rfc.md:283-285`); the RFC then calls human approval on a direct row a confirmation gate (`:323-330`). There is still no structural predicate by which the compiler or an author decides whether an out-of-band approval is inherent mediation or a human-approval posture on a direct operation. The same flow can satisfy both definitions.

   The two-row config proposal attempts to remove the carrier-dependent case, but it does not yet define two implementable semantic operations; see New MATERIAL concern 2.

3. **Preview/apply was not bound to LLP 0024’s actual authority tuple — round 1/2, still partial after round 3** — RESOLVED

   Revision 4 now binds:

   > “`devUser`'s mode plus its impersonated user identity”  
   > “`devAdminBypass`'s mode plus its required reason”

   (`llp/0182-agent-accessible-control-plane.rfc.md:838-843`), requires the same tuple in the receipt (`:861-864`), and explicitly states that LLP 0024 defines no operator principal for bypass (`:1053-1060`).

   This matches the owner and implementation. LLP 0024 defines `devUser` with user identity/roles and `devAdminBypass` as local admin bypass with an explicit reason (`llp/0024-agent-operating-surface.spec.md:273-289`). `ResolvedAppAuthority::AdminBypass` contains only `reason` (`src/auth/invocation.rs:276-320`), and the shipped host-ops projection emits `actor_principal: None`, `effective_principal: None`, and the reason for `devAdminBypass` (`src/host_ops.rs:583-592`). The invented operator identity is gone.

4. **The domain predicate was local-only while the completeness claim was cross-target — round 3** — PARTIALLY RESOLVED

   The revision correctly recognizes the hosted arm as a fifth domain and proposes:

   > “a checked-in, hand-authored table … enumerating every hand-routed system/control path”  
   > “every case in `gateway.js`'s own routing table [must] reference a manifest entry by path”

   (`llp/0182-agent-accessible-control-plane.rfc.md:603-617`).

   Including hosted controls in v1 is coherent, but the proposed join does not close the actual dispatcher boundary. It is keyed too coarsely and checks the wrong layer; see New MATERIAL concern 1.

5. **Derived-instance authority was widened inconsistently — round 3** — RESOLVED

   The four relevant locations now agree on the v1 rule:

   - §A: local non-production only; derived remains unavailable until LLP 0158 grants recognition for patching; hosted-derived remains out of scope (`llp/0182-agent-accessible-control-plane.rfc.md:814-826`).
   - §B: local non-production; primary hosted/production and derived targets are refused pending the same operation-specific grant (`:891-896`).
   - §C: the same local/hosted/derived rule (`:924-926`).
   - Risks: local non-production, with derived bypass pending LLP 0158 (`:1141-1145`).

   This matches LLP 0158’s current boundary: derived identity is recognized solely for network-profile activation, while hosted fork materialization remains unbuilt (`llp/0158-instance-forking.rfc.md:945-963`).

6. **`app.ensure.provision` was keyed by the shared route rather than operation identity — round-3-touched concern** — RESOLVED

   The RFC now keys the exception by dispatched operation identity and excludes `app.ensure.legacy`/`.attest` despite their shared path (`llp/0182-agent-accessible-control-plane.rfc.md:468-490`).

   That matches the implementation: the request `intent` selects the operation (`src/server.rs:9114-9123`), and the three operation rows have distinct policies even though all use `/app/ensure` (`src/server.rs:15023-15068`). The revised predicate is mechanically meaningful.

7. **Secret/capability-bearing `apiOnly` rows could be promoted automatically — round-4-touched concern** — RESOLVED

   Revision 4 forbids threshold promotion when response sensitivity is `CredentialSecret` or effect is `ImpersonationCapability`, requiring a separately reviewed authored override (`llp/0182-agent-accessible-control-plane.rfc.md:253-269`).

   The named mailbox example is accurate: `GET /_snapback/api/auth/mailbox` is `AdminWrite`, `CredentialSecret`, and `ImpersonationCapability` (`src/server.rs:8649-8660`; `llp/0031-server-route-taxonomy.spec.md:363-365`). The same predicate also catches credential-producing control operations such as `host_ops.auth.mintSession` (`src/server.rs:15537-15555`). None of the other shipped-operation shortfall rows has those same registry axes; `config.set` instead carries a secret input and remains governed by its separate carrier review.

## New MATERIAL concerns (not in prior rounds)

1. **The hosted manifest is not joined to the actual semantic dispatcher**

   The RFC proposes checking every gateway case “by path” (`llp/0182-agent-accessible-control-plane.rfc.md:611-617`), but the actual implementation has neither a declarative gateway route table nor a single dispatcher at that layer.

   `cloudflare/src/gateway.js` mixes a path set (`:37-43`), exact imperative branches (`:102-174`), regex routes, and prefix routing. In particular, it forwards every `/_snapback/test/*` request through one prefix branch (`:156-168`). The actual semantic operations are then selected in `cloudflare/src/coordinator.js`, including many separately gated test/control cases beginning at `:1672`, so a new coordinator operation under that prefix requires no new gateway case and would evade the proposed gateway-manifest check.

   Path-only identity is also insufficient for an existing production route. `/_snapback/api/debug/network-profile` is one gateway path, but the coordinator dispatches GET to an admin-read operation and non-GET to the admin-write activation operation (`cloudflare/src/coordinator.js:1584-1595`). One path-keyed row cannot carry the correct authority, effect, schema, and operation identity for both.

   This recreates the exact failure LLP 0031 warns about: a descriptive list cross-checked against known literals does not stop a new imperative route from bypassing the list (`llp/0031-server-route-taxonomy.spec.md:181-188`). The hosted seam must be manifest-driven or mechanically closed across both gateway and coordinator, keyed by at least method, path template, and semantic operation identity. Prefix/catch-all routes need explicit rules proving that every downstream operation is declared. This requires an implementation-boundary decision, not another assertion that “every case” will be checked.

2. **`config.secret.acquire` is not an owner-defined operation and has no secret-safe handoff artifact**

   The RFC says `config.secret.acquire` never returns the value to the agent, after which the agent runs direct `config.set` with a value or reference it holds (`llp/0182-agent-accessible-control-plane.rfc.md:288-306`, `:784-800`). It never defines what artifact crosses between those operations. If acquisition never reveals the value, direct `config.set` cannot consume it unless acquisition returns an opaque reference or continuation and `config.set` is extended to resolve that artifact. Neither contract is specified.

   LLP 0036 does not currently define `config.secret.acquire`. Its closed operation table contains `config.status`, `config.plan`, `config.set`, `config.unset`, and `config.verify` (`llp/0036-app-secrets-and-config.rfc.md:677-710`). Its v1 acquisition metadata is explicitly passive; the tracked human handoff is L1/v2+, while an agent that acquires a key directly calls the existing `config.set` (`:810-847`). Its `external-resolver` backend is also v2+ (`:368-373`).

   The shipped human flow confirms that mediation still terminates directly in `config.set`: the setup page reads the human-entered value and POSTs it to `/_snapback/api/config/set` (`src/admin/setup.html:470-483`), and that is the only registered value-write route (`src/server.rs:8762-8768`, handler at `:17490-17519`).

   As written, `config.secret.acquire` is either merely a workflow label rather than the “stable catalog entry per administrative operation” promised at `llp/0182-agent-accessible-control-plane.rfc.md:341-344`, or it secretly performs the write and duplicates/mediates `config.set`. Resolve this through an LLP 0036 amendment defining the new operation, its opaque continuation/reference, custody, expiry/cancellation, and atomic consumption—or move operability to a projection/carrier variant rather than inventing a row split. This needs semantic-owner judgment.

3. **`composedFrom` incorrectly discards the existing `host.restart` semantic owner**

   Revision 4 says `snapback_restart`:

   > “does not project a registered `host.restart` host-operation — there isn't one”

   and proposes deriving its authority/effects from `host.stop` and `host.start` instead of requiring an atomic owner (`llp/0182-agent-accessible-control-plane.rfc.md:443-456`).

   That factual and ownership claim is wrong. LLP 0024 registers `host.restart` as a stable operation with its own result contract and explicitly permits implementing it as a composition (`llp/0024-agent-operating-surface.spec.md:148-172`). The server operation registry has `host_ops.host.restart` at `AdminWrite` (`src/server.rs:15519-15535`), and `host_ops_operation_spec` resolves it (`:15838-15855`). The current MCP implementation composes stop/start and stamps the owned `host.restart` envelope (`packages/snapback-cli/mcp-control.mjs:817-831`).

   `composedFrom` is useful as implementation/projection provenance, but it must not replace the semantic owner or derive policy by a “more privileged constituent” heuristic. The row should retain `host.restart`’s LLP 0024 policy, schema, and result semantics; `composedFrom: ["host.stop", "host.start"]` can explain how that owned operation is implemented. The HTTP projection may be absent or return its current `CLI_ONLY` refusal without implying that the operation owner does not exist.

## New DETAIL concerns (not in prior rounds)

None.

## Verification notes

- The requested file initially existed and hashed directly to `3c71252e10685adbace8f21467c6433e0a12e5e622fa475f0b26e27694237868`. During review the worktree renumbered the document and permitted review artifacts from 0182 to 0184. The current 0184 target has the same 1,197 lines, and streaming substitution of `0184`→`0182` reproduces the requested hash exactly. Citations above use the requested 0182 path and unchanged line numbers.
- I read only the three permitted GPT-5-family review histories. I did not open another family’s review or the run journal.
- I verified the hosted proposal against both `cloudflare/src/gateway.js` and `cloudflare/src/coordinator.js`, not only LLP 0031’s description.
- I verified the `config.set` split against LLP 0036, the registered server routes, and the shipped setup-page call.
- I verified `devAdminBypass` against LLP 0024, `ResolvedAppAuthority`, and the shipped host-ops authority projection. The no-operator-identity correction is sound.
- I verified the `(mcpOnly, unavailable)` `acceptance.run` pairing against the MCP proxy and host-operation refusal. Rule 7’s revised behavior is coherent.
- I verified the promotion pin against the mailbox and credential-producing host-operation registrations and found no uncovered row with the same axes in the RFC’s shortfall table.
- I did not run builds or integration tests. The catalog compiler, hosted manifest, and three new debugging operations are unimplemented, and this checkout is read-only.
- The remaining defects are solvable, but not all through editorial cleanup. The `host.restart` ownership error and overbroad completeness wording are straightforward repairs. The hosted manifest boundary and `config.secret.acquire` contract require explicit author and semantic-owner decisions before a fifth-round drafting pass can close them.