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
