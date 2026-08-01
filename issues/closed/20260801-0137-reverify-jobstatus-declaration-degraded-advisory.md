# 0137 re-verify: defineJobStatusQuery emits a degraded-result advisory
# the guide contradicts

**Opened:** 2026-08-01 (0.1.8 re-verification pass)
**Systems:** Codegen, Documentation
**Related:** LLP 0137, LLP 0070,
issues/closed/20260801-0137-a6-jobstatus-query-boot-refusal.md (a6-f1),
issues/20260801-0137-g1-react-template-degraded-result-contract.md
(same advisory class),
demos/improvement-sweep/arms/reverify-0.1.8/run-capsule.json (RV-A6-F1)

Small papercut found while re-verifying a6-f1 on 0.1.8 (the boot fix
itself is verified: the app boots and the projection serves live). The
guide's jobs page says "Declaring it is the whole authoring step" for
`export const jobStatus = defineJobStatusQuery({ auth: 'authenticated' })`,
but `snapback generate` then advises:

    degraded jobStatus: functions.mjs -> generated/api.d.ts#GeneratedApi["jobStatus"]
    Add `result: results.documents("table")` ... and regenerate.

The declared job-status query cannot take an authored result contract
(its projection is platform-owned), so the advisory asks for something
the surface deliberately refuses to need. A guide-following consumer
lands in the same degraded-advisory noise g1-f1 tracks for the react
template.

Fix shape: teach codegen that the generated job-status plan carries its
own complete result contract (suppress the degraded advisory for it), or
have the advisory text exempt declared platform queries by name.

Witness: `snapback generate` over the guide's own declaration prints
zero degraded advisories, or the advisory names why jobStatus is exempt.

## Resolution

Fixed (2026-08-01, backlog lane P) on the design-true arm of the fix shape:
codegen now knows the generated job-status plan carries its own complete
result contract. effectiveResultContract
(packages/snapback-codegen/result-contracts.mjs) emits the exact
platform-owned projection for HostPlan.JobStatusQuery — the fifteen
JobStatusRow::to_row_value fields, the five-state lifecycle literal union,
and nullable terminal/error/producer-snapshot fields — instead of falling
through to `unknown`. The degraded advisory therefore does not fire (the
contract is genuinely complete, not merely exempted), generated api.d.ts
types the rows precisely (lifecycle literal union instead of unknown rows),
and provider introspection carries concrete result rows. Queries are not
runtime-enforced against result contracts (all ten validate_handler_result
sites are mutation/action paths), so no serving-path behavior changes.

Witness: jobs-authoring.test.mjs now asserts the records contract shape,
the exact field/state vectors, zero SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED
diagnostics for jobStatus, and the literal-union api.d.ts emission — the
guide declaration generates with zero degraded advisories. Codegen suite
green; check-generated-artifacts clean (no committed backend declares
defineJobStatusQuery).
