# Internal implementation review 2

Provenance: follow-up by the same independent agent, 2026-10-06. Read-only;
no tests run. This is its delivered verdict, before the last binding fix.

Verdict: **APPROVE WITH ONE SMALL CHANGE** for the custody fixes, by inspection. No tests run.

- Reclaimed and cross-viewer opening reuse is fixed. Registrations share session quota, counts and expiry custody; successful traversal replaces the registration without double charging its base.
- Cancellation preserves quota until reclamation. Unused registrations also expire and reclaim through bounded cleanup.
- Accepted units and authorized replay update the observed head while leaving B unchanged, fixing the detectable rewind case.
- Terminal empty-token rejection and regression are present. The ID-width rationale is corrected.

Remaining change: following_history.rs:405 checks only `sessions` when an issued opening is changed to page size `0` or `101`. Include `openings.contains_key(&key)` so this binding mismatch returns `restart`, matching the declaration branch. Add that case to the registration regression.

No additional material custody/accounting defect found. The follow-churn termination finding remains open pending the author decision; this verdict does not close it or qualify the deferred product protocol.
