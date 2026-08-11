# main red: 46 tests fail — `_snapback_job_rehearsal_provenance_v1` has no declared fork custody

- **Status:** Open
- **Date:** 2026-08-10
- **Systems:** instance forks, storage, testing
- **Detected during:** Lane L4 full-lib verification (base `bbfb871f14c3`)

Commit `ec96f04e55` added the Snapback-owned table
`_snapback_job_rehearsal_provenance_v1` without a declared fork-custody
classification. 43 `instance_fork::tests`, two `admin::tests`, and one
`cli::tests` test fail with `SNAPBACK_FORK_CUSTODY_UNCLASSIFIED` naming that
table; exact isolated reruns of an admin caller and the CLI caller reproduce
the same code and table.

Owner: the `ec96f04e55` landing's author — declare the table's fork custody
class (copy, exclude, or whatever the fork-custody registry requires for
rehearsal provenance). Per the 2026-08-10 author sitting convention, a
main-red ticket unclaimed by its landing's author for 24 hours converts to
fix-forward-by-anyone.

## Resolved (2026-08-11)
Classified all rehearsal + catalog-v3 tables in TABLE_CUSTODY (src/instance_fork.rs):
durable catalog-v3 account state (_auth_credentials/password/passkey/recovery_codes/
recovery_code_sets/assurances/provisioning_receipts/security_events) → Copy (matches
_auth_users/_auth_identities); instance+boot-bound rehearsal state
(_snapback_auth_rehearsal_* grants/idempotency/audit/store_markers/identities/sessions/
windows/window_*) → Scrub; _snapback_job_rehearsal_provenance_v1 → Copy (matches
_snapback_jobs_v1 so a copied job retains its egress-gate provenance tag).
instance_fork:: 52/0, admin:: 47/0, auth:: 383/0 (all no-DYLD). Verified.
