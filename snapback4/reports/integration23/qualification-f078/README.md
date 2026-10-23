# Integration 23 qualification snapshot

This is the completed `f07884e368` rollback integration snapshot, before the final
RT3 authority merge. It is not a claim that the release has landed. See the root
WORKSTREAM-REPORT.md for the final integrated source, subsequent checks and landing.

The full five-crate Rust run and complete 430-file client pool pass; the source
is clean after the pool. The packed consumer qualification passes every case on
Ubuntu/Alpine; `publicationQualified` remains false because the prohibited
`scripts/test.sh` is replaced here by the separately executed requested suites.
No npm publication is claimed.

Lean exits 1 for the same 130 known baseline mismatches; oracle/coverage reports
and all 76 worker JSON/Quarry artifacts match the fresh 0.4.38 base. The comparison
retains raw exit codes. Original production stores are read-only; replay copies
are deleted. Two historical upgrades have explicit authored reverse adaptations.

Exact commands and source/artifact identities are in exact-commands.md and
artifact-bindings.json. Raw output is gzip compressed; Mac archives retain commands
and source manifests. No executable, database, credentials or installed dependency
tree is committed.
