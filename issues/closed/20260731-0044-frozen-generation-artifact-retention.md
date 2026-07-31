# 0044 follow-up: frozen-generation authorizer retention not yet implemented

**Status:** OPEN — discovered during L1-06 (2026-07-31)

LLP 0044 v6.1 pins witness re-validation to the frozen generation's
authorizer code, with a bounded artifact-retention obligation (superseded
intent artifacts retained until their open attempts terminate). The L1-06
implementation fails closed instead: when the intent's policy hash has
moved *and* the witness moved, finalization refuses
`SNAPBACK_ASSET_ADMISSION_STALE` rather than re-running the superseded
authorizer (hash-moved + witness-unmoved still publishes under frozen
policy facts).

This is strictly safer than the spec (refuses where 0044 would publish
after a frozen-code re-run) but degrades the benign-churn guarantee
across intent redeploys: a long upload spanning an ordinary redeploy
whose declared reads also churned re-transfers instead of finalizing.

Fix: retain superseded intent artifacts keyed by policy generation until
the last open attempt admitted under them terminates or expires, and
route witness re-runs through the retained artifact. Reflect the
narrowed behavior honestly in any acceptance claims until then.

---

**RESOLVED 2026-07-31 (W2a-2, branch 0044-wave2).** Implemented v6.1
reading (a): `_snapback_asset_intent_artifacts_v1` retains each
generation's serialized intent definition (upserted by
`ensure_intent_generation` in every arm, self-healing), finalization's
witness re-run loads the frozen generation's retained artifact instead
of the current deployment (`SNAPBACK_ASSET_ADMISSION_STALE` survives
only for a genuinely missing artifact, with the
`missingRetainedArtifact` detail), and `reclaim_intent_artifacts` runs
in the GC sweep once no non-terminal attempt pins a superseded
generation — each reclamation receipted (`intent-artifact-reclaimed`,
intent-scoped). Evidence: the case-3 rewrite in
`asset_finalize_witness_rechecks_benign_churn_publishes_denial_refuses`
(redeploy + churn now PUBLISHES via retained code; missing-artifact
fails closed) and
`asset_intent_artifact_retention_reclaims_after_last_attempt_terminates`
(pinning + release + receipts). Full lib 1522/1522; all pinned gates
green.
