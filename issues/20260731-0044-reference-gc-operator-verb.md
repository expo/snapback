# No operator verb drives the asset GC sweep deterministically

**Status:** OPEN — from demos/party-wall (diary 0041)

Reference GC's product moment — "the deleted post's photo goes away a
minute later" — cannot be demonstrated deterministically: suites disable
the runner for hermeticity and there is no host-op to drive
`asset_gc_sweep(now)` on demand (the cron-family tick endpoint precedent
exists for schedulers). Party Wall proves the edge-cleared state via the
now-admissible explicit delete instead. Add an admin-gated
`asset.gcSweep` host-op (deterministic `now` input, receipted) so demos
and operators can show reclamation happening.
