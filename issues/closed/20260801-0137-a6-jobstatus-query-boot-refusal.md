# A6 sweep: defineJobStatusQuery makes the whole app unbootable on packaged 0.1.7

**Opened:** 2026-08-01
**Systems:** Codegen, Runtime, Jobs (jobs_one_off_v1)
**Related:** LLP 0137 (A6 arm), LLP 0070, LLP 0121,
demos/improvement-sweep/arms/a6-snapback-web/findings/0137-a6-f1-jobstatus-query-boot-refusal.json

The generated declared job-status live query — the only authorable
client-facing status surface for `jobs_one_off_v1` — cannot boot on the
public 0.1.7 closure. Codegen accepts

    export const platformJobStatus = defineJobStatusQuery();

and emits a plan referencing table `_snapback_jobs`
(functions.manifest.json, contract-data.manifest.json,
provider-bindings.json), but the server refuses the whole app at load:

    SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID: function manifest
    references unknown table _snapback_jobs

so `snapback dev` exits before writing dev.ready.json
(SNAPBACK_DEV_SERVER_START_FAILED). The packaged runtime's SQL schema
names the platform table `_snapback_jobs_v1`, and the authored-manifest
reference validator admits neither spelling. One declared line turns a
fully working app into one that cannot start.

Everything else in `jobs_one_off_v1` worked end to end for the A6 arm
(external consumer): transactional `ctx.jobs.enqueue` with bounded
`enqueues` facts on the mutation envelope, producer association on the
job row, premature drain running nothing, injected-clock drain executing
exactly once, terminal no-rerun. Status had to be read through the admin
route `GET /_snapback/api/jobs/{id}` instead (secret-read custody —
see the companion guide-gap ticket).

Fix shape: emit the platform-table reference the runtime validator
admits (or teach the validator the platform alias), plus a boot-level
regression — a schema declaring `defineJobStatusQuery()` must reach
dev.ready.json and serve a pending row.

Evidence: `demos/improvement-sweep/arms/a6-snapback-web/evidence/probe-jobstatus-boot-refusal.json`
and `probe-jobstatus-manifest-excerpt.txt`.

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane)

**Root cause.** Codegen's emission is design-correct: `_snapback_jobs` is
the reserved *logical* stream name the runtime itself pins — the Rust
read-summary builder records the job-status plan as a point read of
`JOBS_STATUS_TABLE = "_snapback_jobs"` (src/manifest.rs), the live matcher
wakes subscriptions on that name (src/live_matcher.rs), and the emitted
effect ceiling must name it or the runtime's ceiling subset check would
refuse. `_snapback_jobs_v1` is only the physical SQLite spelling inside
src/jobs.rs. The defect was the whole-manifest schema-reference preflight
(`validate_function_schema_references`, src/local.rs): the wave-1 C2
landing exempted the JobStatusQuery *plan* from schema checks but the
read/write-set dependency loop still looked every summary table up in the
application schema, so the codegen-emitted
`readSetSummary: { tables: ['_snapback_jobs'] }` refused the entire
manifest at load. The C2 test missed it because it built
`FunctionDefinition::new` fixtures with empty summaries and no app schema.

**Fix.** The dependency loop now splits read/write positions and admits
exactly the reserved `_snapback_jobs` read on functions whose runtime is
the JobStatusQuery host plan (src/local.rs, @ref LLP 0070); writes naming
it, and any other runtime declaring it, keep the refusal (fail closed).
Regression tests proven to fail pre-fix:

- `local::tests::codegen_shaped_job_status_query_boots_with_an_app_schema_and_serves_live`
  — the codegen-shaped manifest (summary + effect ceiling as emitted, an
  ordinary app schema applied) activates with zero error diagnostics, then
  enqueues and subscribes the job-status query live, serving the pending
  row (pre-fix: the exact
  `SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID: ... _snapback_jobs`
  refusal from this ticket).
- `local::tests::reserved_job_projection_admission_stays_narrow` — the
  admission stays read-only and plan-scoped.
- `packages/snapback-codegen/jobs-authoring.test.mjs` now pins the emitted
  readSetSummary/writeSetSummary/effectCeiling naming so neither side can
  drift silently.

The jobs guide page (`guide/backend/jobs.md`, companion ticket) documents
the declaration; the misleading define.d.ts/define.mjs capability sentence
was corrected in the same lane.
