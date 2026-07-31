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
