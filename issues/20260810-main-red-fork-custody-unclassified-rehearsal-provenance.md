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
