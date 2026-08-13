# Charter — restore the dropped CLI test-inventory entry

**You do not commit.** Use apply_patch. Touch ONLY
scripts/check-package-test-inventory.mjs (and packages/snapback-cli/package.json
if its test command also lost the entry).

Failure: `node scripts/check-package-test-inventory.mjs` reports
unexpected: ['generate-check.test.mjs'] — the file exists in
packages/snapback-cli but its registry entry was lost in a merge
resolution. The integration-side parent had it (see
`git log --oneline -8` and `git show <substrate-era commit>:scripts/check-package-test-inventory.mjs`
or simply the S1 commit 03125be6a's version). Restore the entry in the CLI
package's expectedFiles (correct position), verify the CLI package.json test
chain still runs it, and adjust expectedTotal ONLY if the arithmetic is now
wrong (the current 263 already counted it — verify rather than assume;
the correct end state is: every on-disk maintained test declared, total
equal to the actual count, changelog comments intact).

Verify: `node scripts/check-package-test-inventory.mjs` PASS;
`node scripts/check-inventories.mjs` package-test section PASS. Report
(REPORT-invfix.md): what was restored, final total, verification tails.
