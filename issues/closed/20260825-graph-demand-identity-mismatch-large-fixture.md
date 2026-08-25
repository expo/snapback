# Large-fixture max-bearing served registrations refuse with SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH

**Opened:** 2026-08-25 (P-B measurement battery, LLP 0209 G3-C arm)
**Closed:** 2026-08-25
**Status:** Closed

**Resolution:** TRACE named the mismatch `parent-key-set`. Principal-bound nodes (`viewState` / `issueNotifications`) emitted no per-parent capture when `identityBinding` missed the test principal (CSV ingest does not load that table). Empty-result point lookups therefore registered (zero parents) while any non-empty graph refused. The evaluator now emits a `found: false` parent-keyed fact for every parent when the binding misses; registration accepts that exact set. Bound-principal corpus worlds still register; a forged instance hash still refuses (`graph_registration_covers_unbound_principal_parent_set`, `graph_registration_refuses_semantically_forged_provenance`). Evaluate+register on the `VACUUM INTO` large/hot clone completed for `issueListV2`, `issueDetail`, and `listIssueByID` twice. `SNAPBACK_PB_MODE=observe` subscribe on the Aug-7 catalog still hits `SNAPBACK_AUTH_IDENTITY_CORE_REQUIRES_V3` (follow-on for live subscribe, not demand-identity).

The regenerated 2.5M-row fixture CSVs in the g3-lane worktree were not deleted.
