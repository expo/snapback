# Review: LLP 0274 — Explicit write-authority postures (round 1)

**Reviewer:** Codex (gpt-5.6-sol, reasoning effort xhigh)
**Date:** 2026-08-16
**Document:** `llp/0274-explicit-write-authority-postures.spec.md`
**Round:** 1 — full blind review of the initial Draft
**Review basis:** independent and mutually blind within the round (neither
family saw the other's review); run read-only against the full checkout,
orchestrated by the sbs-orchestrate dual-family loop.
**Renumber note:** this review was written while the document was numbered LLP 0272; it was renumbered to LLP 0274 at landing after a fleet collision assigned 0272 to a different spec, and all in-body references were renumbered mechanically.
**Verdict:** NOT READY

---

VERDICT: NOT READY

The two-posture boundary is coherent, the formwise rank order is conservative, and the Graffiti append-only claim is correct. However, ten material issues remain.

## MATERIAL concerns

1. **Admitted patch can acquire read authority over previously hidden contents.**

   LLP 0274 allows either posture with any ordinary read policy and deliberately omits old-row checks ([D1](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:194>)). This leaves post-update policy fields unrestricted.

   Failure scenario: `documents` is owner-readable by `ownerId`, authenticated-write uses `lastEditorId`, and patch is admitted. Bob knows Alice’s row ID and patches `{ownerId: Bob}`. No owner predicate runs; Bob then reads Alice’s entire pre-existing document through ordinary owner visibility. The membership analogue patches `resourceField` to a room Bob belongs to. Open-write lets an anonymous caller set `ownerId`, then authenticate as that principal and read the row.

   The same-field case is even simpler: if attribution and owner fields coincide, Bob submits an empty patch and the host restamps ownership to Bob. The spec explicitly recognizes this read-audience change ([D3](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:343>)), but calls it a governed policy transition. It is not: the policy was approved once; each row-level ownership transfer is ungoverned. This contradicts the claim that a point write “does not confer permission to read” ([D2](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:285>)) and LLP 0231’s reservation of post-update checks ([LLP 0231 D6](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0231-class-r-row-visibility.rfc.md:408>)).

   Require a transactional post-image rule: either read-policy discriminator fields and their membership closure fields are immutable under these postures, or the resulting read-authority transfer must be explicitly represented, governed, and negatively qualified.

2. **The required anonymous authenticated-write diagnostic is unreachable on valid executions.**

   D3 requires every operation reaching authenticated-write to have effective `authRequirement: authenticated` ([D3](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:350>)). The actual invocation gate rejects an anonymous caller first with `SNAPBACK_AUTH_REQUIRED` ([invocation.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/auth/invocation.rs:2140>)). LLP 0065 pins the same precedence ([LLP 0065](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0065-generated-data-pattern-soundness.rfc.md:376>)).

   D8 nevertheless requires anonymous handler and HostPlan calls to return `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED` ([D8.9](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:782>)). No conforming invocation can reach that assertion.

   Split the contract:

   - Normal generated invocation: `SNAPBACK_AUTH_REQUIRED` at the invocation gate.
   - Forged/stale/direct lower-seam execution: `SNAPBACK_TABLE_WRITE_AUTHENTICATION_REQUIRED` before target access.

3. **The JavaScript census has false-negative zero-site paths, so auth coupling and Phase 1b closure are not complete.**

   The scanner recognizes only direct member calls resembling `*.db.insert|patch|delete`; `opaque` remains false unless parsing fails ([write-policy.mjs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/packages/snapback-codegen/write-policy.mjs:147>)).

   Failure scenarios:

   ```js
   const patch = ctx.db.patch;
   await patch("records", id, values);
   ```

   ```js
   await helperThatWrites(ctx, args);
   ```

   ```js
   await ctx.db[form](table, ...args);
   ```

   These can produce `sites: []`, `opaque: false`. In Phase 1b an operation can therefore publish no rows and appear closed despite executing a generic write. A public operation can evade authenticated-write generation coupling; an aliased insert can also evade unique-disclosure analysis.

   Define an exact admissible JavaScript subset or a sound interprocedural census. Every unproved call/alias/helper/computed dispatch must default to opaque, and declared write sets must be reconciled against the exact enumerated site set rather than allowing zero rows.

4. **There is no specified trusted operation carrier for runtime auth/disclosure enforcement.**

   Operation-bound disclosure requires the commit seam to distinguish operation A from B. The present function carrier contains disclosures and ceilings but no sealed per-site authority closure ([FunctionWritePolicyV1](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/manifest.rs:8991>)). HostPlan storage execution receives only plan and handler input ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:2914>)); buffered commit payload likewise carries no operation/write-policy identity ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:950>)).

   Failure scenario: A and B insert into the same open table and unique constraint, but only A appears in `operations[]`. At the authoritative uniqueness seam, both writes are structurally identical. Without a server-constructed operation identity, B cannot be refused as D2 requires. The same omission makes D6’s HostPlan claim that preflight rechecks the function auth requirement impossible as written.

   Specify a versioned, host-constructed execution carrier binding operation identity, effective auth value/origin, write-policy semantic version/digest, and exact/ceiling site facts, and pass it to both HostPlan execution and buffered commit. State the activation cross-check algorithm.

5. **The claimed specialized permission-backing refusal is not currently exhaustive.**

   `generic_owner_write_field` returns `None` for permission-backing tables ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:18103>)). HostPlan preflight separately refuses only `membership` tables ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:3082>)). The early JavaScript permission-backing gate refuses only service principals ([runtime.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/runtime.rs:5115>)), while the buffered membership gate checks only `table.membership` ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:13780>)).

   A direct/stale ordinary-user HostPlan or buffered write to a non-membership `permissionBacking` table can therefore pass through the Phase 1a null-authority arm. D6 must not describe this as an existing exhaustive seam. Require its implementation explicitly and add ordinary user, anonymous, service, HostPlan, buffered, stale-carrier, and direct-storage negatives.

6. **The v2→v3 lift is impossible for actual valid corpus bodies.**

   D4 requires a non-ordinary class to have null `ownerField` ([D4](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:422>)), while its lift requires preserving `ownerField` byte-for-byte and classifying an all-refused matrix as `authorityKind: refused` ([lift](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:490>)).

   This is not hypothetical. Team Chat’s valid v1 `roomMembers` body is membership-class, all-refused, and carries `ownerField: "userId"` ([baseline](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/generated/table-visibility-policy-baseline.json:74>)). The successor must both preserve `"userId"` and replace it with null.

   Define a single canonical successor. If dropping the dead owner field is representation-only, say so explicitly and bind that normalization into the exact lift. Otherwise permit a closed legacy-preserved field shape. Add current authority-table bodies as lift fixtures.

7. **Rewriting historical approved nodes invalidates their immutable approvals and receipts.**

   D4 says to recompute v3 node, ledger, and approval-scope digests for retained nodes. But the approval scope digest includes the complete predecessor/successor bodies and node identity ([visibility-governance.mjs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/packages/snapback-codegen/visibility-governance.mjs:1281>)), and approved transitions revalidate the retained approval and signed separation receipt ([visibility-governance.mjs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/packages/snapback-codegen/visibility-governance.mjs:1500>)).

   Rehashing the node makes the old approval stale; rewriting the approval destroys its remotely-prior immutable identity. The current corpus happens not to contain approved-transition nodes, but the specified reader is general.

   Preserve historical nodes under their original version and add a v3 head/lift boundary, or constrain the representation lift to root-only/G1 histories and refuse real predecessor chains, as the existing v1→v2 implementation does.

8. **`writePolicyChecks` v3 cannot unambiguously represent a refused form or verify its claimed digest preimage.**

   D5 adds posture-level `genericWriteDisposition` values but no required form-specific disposition. For an open-write table whose patch form is refused, a candidate patch row must either:

   - say `genericWriteDisposition: open-write`, which looks admitted; or
   - say `generic-refused`, which loses the installed posture.

   The opaque `policyDigest` is not a reviewable substitute. D5 also says row ID binds effective auth value and origin, but it does not add those as row fields ([D5](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:538>)). A consumer cannot reconstruct or verify the advertised ID preimage.

   Add a closed `formDisposition` enum using the exact D4 disposition vocabulary and explicit `authRequirement: {value, origin}` facts—or an equally exact operation-join identity. Publish the complete v3 JSON-schema delta, including refused candidates and `missing-disclosure`; the current schema’s enum excludes the latter even though code emits it ([schema](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/packages/snapback-codegen/authorization-review.schema.json:306>)).

9. **The closed qualification battery misses the existing empty-patch restamp bypass.**

   D3 requires restamping even when authored values are unchanged ([D3](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:323>)). The current buffered commit skips an empty patch before reading or applying any host mutation ([storage.rs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/src/storage.rs:4847>)).

   Failure scenario: Alice inserts; Bob calls `patch(id, {})`; the operation reports success but attribution remains Alice. D8.11’s ordinary Bob patch can pass while leaving this optimization intact.

   Add empty-object and semantically same-value patches through both JS and HostPlan. Specify whether a host-only restamp creates a version/change record, what `changedFields` contains, and how companion effects behave.

10. **Team Chat cannot reach Phase 1b closure under D9’s stated migration.**

   D9 says “No new posture” and describes only replacing deliveries with recipient-owned read markers ([D9](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/llp/0274-explicit-write-authority-postures.spec.md:843>)). Actual Team Chat still has:

   - membership-visible `messages` ([schema](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/schema.mjs:70>)) written by generic `ctx.db.insert` ([handler](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/handlers.mjs:145>)); and
   - `roomParticipants` under `any-of` owner/membership visibility, with cross-principal invite and moderator patch paths ([schema](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/schema.mjs:47>), [handler](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/team-chat/snapback/handlers.mjs:49>)).

   Phase 1b refuses both generic write classes. Recipient markers solve neither message insertion nor participant maintenance. D9 must select a declaration-owned specialized writer or a further table restructure for these paths while retaining the settled “no delegated/recipient generic posture” ruling.

## Minors

1. “Explicit open-write is the only route” is false during Phase 1a pass-through. Say “only admitted steady-state/claimable route.”

2. Add LLP 0065 negatives proving `defineOwnedCrud` is eligible only when the installed write authority is owner, and that owner-read plus open/authenticated-write cannot silently reuse owner-pattern semantics. Include bare service principal, delegated service principal, system/cron, and admin-bypass cases.

3. `SNAPBACK_TABLE_WRITE_POSTURE_INVALID` says it covers appearance on an authority table, while the pinned precedence says the authority-table code wins first. Choose one public code.

4. State explicitly that `insert-each` reaches the same unique-disclosure set as insert and that one conflict rolls back the whole batch.

5. Physical point existence is a deliberate disclosure for restricted-read tables, not read noninterference. Project it explicitly and test hidden-present versus missing. Delete-where changed-count/result oracles remain outside the claim and should be named as such.

6. The Phase 1b receipt should be keyed by the registry-derived canonical backend-job set, exactly one record per job. “34” is a current census, not an enduring schema rule; rows/sites must not be countable as separate jobs.

7. D2’s claim that caller-controlled author-like fields “cannot authorize a later mutation” is too broad for handwritten handler logic. Narrow it to Snapback policy enforcement and generated standard patterns unless a taint system is intended.

8. The Campfire, Chirp, and non-view-once Messaging mappings match current generic forms. Graffiti is indeed append-only: `paintCell` contains one `Insert` and no patch/delete path ([functions.mjs](</private/tmp/claude-501/-Users-ccheever-projects-snapback/b6c9f681-3da6-45dd-8d7c-ca12e936a76b/scratchpad/wt-llp/demos/graffiti/snapback/functions.mjs:51>)). Their unique constraints still require operation-bound disclosure entries during migration.