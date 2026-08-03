# 0158 F0a: mechanical custody schema sweep

**Opened:** 2026-08-03. **Source:** LLP 0158 §Design sketch (scrub-and-mint
custody manifest), §Implementation path F0a. **Order:** first F0a gate.

Build the build/test-time sweep that enumerates every `_snapback_*` and
`_auth_*` table (and every sidecar naming convention: `*.config.json`,
`*.admin-token`, `*.auth-keyring.json`, `resume-keyring.json`, ready
files, lock files) and fails when any lacks an explicit fork-custody
classification (`copy` / `scrub` / `rotate` / `share` / `refuse`).

Constraints from the review loop:
- `app.reset`'s deletion sequence is NOT the authority — it provably
  omits the durable-jobs tables (`_snapback_jobs_v1`,
  `_snapback_job_attempts_v1`, `_snapback_job_push_grants_v1`,
  src/jobs.rs). The sweep must be schema-derived, not precedent-derived.
- Unknown custody class ⇒ fork creation fails closed.
- The sweep is a standing gate: a new system table cannot land without
  declaring fork behavior.

Acceptance: sweep exists, runs in the local proof, initially classifies
every existing table/sidecar, and a test demonstrates the failure mode
(inject an unclassified table name → sweep fails).
