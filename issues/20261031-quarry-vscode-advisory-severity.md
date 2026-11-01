# Quarry VS Code matcher: give advisory `N_` notes a warning severity

**Opened:** 2026-10-31 · **Source:** LLP 3000.041 §10 landing record; REPORT-R2 "Deferred"

The `$quarry-check` problem matcher in `snapback4/editors/vscode/package.json`
marks every matched line as an error, including the compiler's non-blocking
`N_*` notes (for example `N_BROAD_READ`, `N_NO_CURSOR`). The check wrapper
(`editors/vscode/scripts/check-problems.mjs`) prints the code on every line, so
the information is there; the matcher just has one severity.

Fix: either a second matcher keyed on the `N_` prefix with `severity: warning`,
or a severity column in the wrapper's line form that the matcher maps. Add a
replay test with one `E_` and one `N_` line asserting the two severities.
Not a correctness bug; a reviewer reading squiggles today sees advisories as
errors.
