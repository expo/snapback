**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex / gpt-5.6-sol
**Reasoning effort:** xhigh
**Date:** 2026-08-15
**Redacted:** no
**Method:** manual, independent fresh-session delta review
**Revision reviewed:** `llp/0264-table-write-policy.spec.md` working-tree blob `e58aef360a2dbcead5e44c7fb2ac0a97b917f0fd` based on repository commit `6af92793517e5b688337f4914fa8bf7a15c50065`

## Overall assessment

The revision genuinely closes the round-1 comparator's read/write laundering,
the unrooted legacy-omission path, the undeclared global-uniqueness oracle, and
the concrete HostPlan pre-write `Get`/`Guard` mismatch. It also gives exact
HostPlan sites and closed runtime table ceilings a usable projection shape.

It is not ready for acceptance. The new HostPlan `no-effect` carrier does not
close observations later in the same plan, the new conflict-disclosure fact is
not identity-complete in the per-table transition ratchet, and the per-site D9
contract cannot represent opaque JavaScript using the declared/runtime carriers
the Spec and shipped code actually provide.

## Round-1 MATERIAL resolution

| Review finding | Resolution | Assessment |
| --- | --- | --- |
| GPT-5 1 — write-axis comparator and legacy omission | D1 makes the structural order a read × write product, makes write widening/incomparability receipted, and D2 freezes an exact protected pre-cut undeclared set while refusing removal/new omission (`llp/0264-table-write-policy.spec.md:154-169`, `:171-193`, `:550-554`). | **RESOLVED.** The transition cases and pre-G0 predecessor mechanism are implementable. New finding 2 concerns the newly added disclosure member of that product, not the original disposition/removal hole. |
| GPT-5 2 — HostPlan absent disposition not bound to the write | D4 adds a sealed checked-write carrier, binds complete refusal bytes, rejects arbitrary/prior aliasing reads, and adds the requested negative fixtures (`llp/0264-table-write-policy.spec.md:274-300`, `:526-533`). | **PARTIALLY RESOLVED.** The original pre-write `Get`/`Guard` divergence is closed, but a `no-effect` carrier still permits a later observation to distinguish the same two states; see new finding 1. |
| GPT-5 3 — global uniqueness existence oracle | D3 requires owner partitioning or an exact declared conflict disclosure for every reachable insert/patch constraint, treats uncertainty as reach, refuses opaque ceilings, and projects the residual bit (`llp/0264-table-write-policy.spec.md:241-258`, `:397-398`). | **RESOLVED.** The write no longer silently gains this oracle. New finding 2 is about governing expansion of the newly explicit disclosure. |
| GPT-5 4 — D9 multi-site/runtime loss | D9 keys exact rows by `siteId`, expands closed runtime ceilings per member, defines opaque target sentinels, separates preflight/authoritative checks, and adds conflict/absence facts (`llp/0264-table-write-policy.spec.md:406-450`). | **RESOLVED for the reported HostPlan collisions and target-dependent scalars.** New finding 3 identifies a distinct site/form census gap for opaque JavaScript. |
| Claude 1 — read-narrowing launders write widening | The same D1 product comparator makes refused-to-owner broadening even when reads narrow (`llp/0264-table-write-policy.spec.md:154-168`). | **RESOLVED.** |
| Claude 2 — removal becomes legacy; no pre-G0 predecessor | The installed-lineage root supplies the predecessor and only exact pre-cut members retain legacy behavior; removal, new omission, a missing root, and root mutation refuse (`llp/0264-table-write-policy.spec.md:171-193`). | **RESOLVED.** |
| Claude 3 — unique conflicts disclose hidden rows | The D3 gate and D9/D10 residual-disclosure facts make the conflict bit explicit or refuse the operation (`llp/0264-table-write-policy.spec.md:241-258`, `:434-435`, `:476-477`). | **RESOLVED.** |

## New findings

1. **MATERIAL — a HostPlan `no-effect` check still permits the public operation to distinguish missing from not-owned through a later read or return.**

   The revised definition says the *public operation* cannot distinguish the
   states (`llp/0264-table-write-policy.spec.md:128-134`). D4 rejects an
   aliasing/uncertain **prior** read and applies the carrier before row binding
   (`:274-280`), but says neither that `no-effect` terminates the plan nor that
   later target observations are normalized. D8 expressly leaves HostPlan
   bindings, expressions, and `ReturnValue::Document` outside v1
   (`:377-395`). Those statements permit a checked `Patch(id,
   no-effect)` followed by `Get(id)` or `ReturnValue::Document(table, id)`:
   missing returns null while another owner's present row returns the row.

   That is the shipped execution shape an implementation must change. A
   missing `Patch` simply falls through to later steps
   (`src/storage.rs:3158-3220`), and return bindings/documents are materialized
   after all steps with an unscoped storage read (`src/storage.rs:3752-3789`).
   The write effect is equally absent, but the public operation is not
   indistinguishable. D8 cannot both defer this egress and preserve D4's stated
   operation-level guarantee.

   **Resolution:** either make a `no-effect` owner check a terminal operation
   outcome, or carry a host-owned hidden/absent taint that makes every later
   same-target read, binding, expression, document return, copy, and changed
   count identical for missing and not-owned. Conservatively refuse uncertain
   aliases. Add post-write `Get`, `Binding`, `Document`, `Expr`, and mixed-step
   fixtures for both states. If v1 intends to guarantee only the local write
   effect, narrow the Summary/Absent/D4 claim explicitly and do not claim
   operation-level non-disclosure.

2. **MATERIAL — the new conflict-disclosure authority can expand to another operation without changing the D1 transition identity.**

   LLP 0234 D5's baseline and ledger are per table and retain one normalized
   predecessor/successor policy body (`llp/0234-visibility-override-governance.rfc.md:910-975`).
   D1 adds “declared global-unique disclosures” to that table write posture and
   treats a new disclosure as growth (`llp/0264-table-write-policy.spec.md:154-165`).
   D3, however, normalizes each operation declaration only as
   `{table, writeForm, constraint}` (`:243-253`), omitting the operation,
   entrypoint, and site identity.

   After operation A receives approval for
   `{users, patch, by_email}`, adding the same triple to operation B leaves the
   table's normalized set equal even though B has newly acquired the conflict
   oracle. B may have different invocation admission or external exposure. D9's
   `siteId` cannot repair this because D9 is explicitly review-only and carries
   no approval or enforcement authority (`:406-450`).

   **Resolution:** bind each disclosure in the D1 body/digest, baseline,
   transition ledger, approval, and comparator to a stable operation/entrypoint
   identity and the intended site/form/table/constraint identity; exact-set
   addition is broadening and removal is narrowing. Also bind the trusted
   runtime carrier to that identity. The coherent alternative is to declare
   the disclosure table-global, move it to the table policy, and honestly treat
   every matching owner operation as able to expose it; the current
   operation-local authoring plus table-global ratchet is not closed.

3. **MATERIAL — D9's exact per-site/per-form promise has no representable opaque-JavaScript case, and that also leaves D3's per-form gate under-specified.**

   D9 requires every site to have a stable `siteId`, an exact `writeForm`, and
   a separate row; it simultaneously permits `opaque-module` evidence and says
   no sites may merge or disappear (`llp/0264-table-write-policy.spec.md:413-439`).
   The opaque target sentinels do not include `writeForm` or site resolution:
   `writeForm` must be one of five exact values, and `absentDisposition` is
   source/carrier-fixed (`:424-435`).

   Shipped module-form JavaScript supplies only an operation-level table
   `writes` list (`packages/snapback-codegen/define.mjs:4504-4561`). The runtime
   host bridge receives only `op` and `args`, with no stable source-site
   identity (`src/runtime.rs:3187-3244`, `:3458-3527`). Thus an indirect or
   otherwise opaque handler can contain multiple insert/patch/delete sites that
   codegen cannot enumerate or assign exact forms to. One `opaque-module` row
   collapses them, while inventing exact rows violates the fact-only contract.
   The same missing form/changed-field census prevents generation from knowing
   which D3 patch constraints are reachable except by treating every form and
   field as possible.

   **Resolution:** add a closed, activation-bound write-call capability channel
   for JavaScript, carrying stable site id, form, table ceiling, changed-field
   ceiling, and conflict-disclosure identity; instrument the host call and
   refuse undeclared/scanner-invisible sites at runtime. Alternatively define
   honest operation-level opacity with `siteResolution: opaque-module`,
   `writeForm: runtime-resolved`, and changed-field/runtime sentinels, emit all
   conservative form × ceiling candidates, and make Phase 2 and capability
   claims refuse exact-site completeness for that class.

4. **MINOR — several D9 variants still lack closed serialized shapes.**

   `tableResolution` is described by examples but its enum is not listed;
   `ownerFieldResolution` appears conditionally without its own field
   definition; and `uniqueConflictDisposition` is described as both a scalar
   (`declared-disclosure`) and “plus constraint ids” without an object/array
   grammar (`llp/0264-table-write-policy.spec.md:423-435`).

   **Resolution:** give each field an exact closed JSON algebra, including
   required/null rules for exact, runtime-ceiling-member, and opaque rows, and
   pin it in the schema/golden fixtures.

5. **MINOR — refused-row acceptance wording conflicts with publication custody.**

   D9 says failed generation publishes no projection and places the complete
   refused candidate row in the diagnostic (`llp/0264-table-write-policy.spec.md:441-443`),
   while Phase-1 item 9 says `writePolicyChecks[]` has golden rows for refused
   classes (`:545-549`).

   **Resolution:** split the acceptance statement into published
   `writePolicyChecks[]` golden rows for successful generations and diagnostic
   candidate-row goldens for refused generations.

VERDICT: MATERIAL
