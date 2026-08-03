# 0158 F0a: deny-all fork egress (fail-loud) — v1 posture

**Opened:** 2026-08-03. **Source:** LLP 0158 §Runtime plane (quarantine
matrix), §Implementation path F0a (author's 2026-08-03 scope cut).

In a fork-profile boot, every outbound-initiation family REFUSES with a
stable diagnostic (fail-loud, fail-closed): buffered `ctx.fetch`
(`host.fetch`), `push.send` + push-receipt maintenance polling, the
`action.streamOpen/Read/Cancel` family, effects deferred via
`jobs.enqueue` (inert under SNAPBACK_JOBS_DISABLED but must also refuse
if manually drained), S3/provider asset I/O under inherited
`SNAPBACK_ASSET_S3_*` env credentials, telemetry export. Plus the three
worker switches set at fork boot (SNAPBACK_CRON_DISABLED,
SNAPBACK_JOBS_DISABLED, SNAPBACK_ASSET_RUNNER_DISABLED). Anything not in
the closed set refuses by construction (EffectClass::classify posture,
src/branches.rs).

Deliberately OUT of scope (deferred, coordinate with LLP 0097's
mediation prerequisite before building): the capture-ledger integration
(captured intents instead of bare refusal). Do not let this ticket grow
into the 0097 wiring project.

Acceptance: refusal test per family, including manual cron tick and
forced-drain paths, run against a minted fork.

## Resolution — 2026-08-03

Landed fail-loud `SNAPBACK_FORK_EGRESS_DENIED` at action host dispatch,
transactional job enqueue, manual/autonomous cron claims, forced job drain,
push recovery/receipt polling, S3 provider construction before inherited
credentials are read, and both direct HTTP and host-op telemetry export. Fork
boot forces cron/jobs/asset workers disabled and ignores inherited admin-token
authority. Each closed family records only family/count/timestamps in the
bounded durable marker; unknown future action host operations refuse under an
unclassified family. No LLP 0097 capture-ledger path was changed or integrated.
