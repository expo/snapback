# client-bundle-metrology ratchet is red on main — pre-existing, environment-implicated

**Status:** Open
**Opened:** 2026-08-06
**Related:** scripts/client-bundle-metrology.mjs;
tests/fixtures/client-bundle-metrology/baseline.v1.json; LLP 0063
workstream 8 (packaging budgets)

`node scripts/client-bundle-metrology.mjs --check` fails with
`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED` — ~28 metric regressions, the
largest `react-external` / `external-react-application` minifiedBytes
49,943 → 67,655 (+35%), plus 2–8% on every rqs-store profile.

Reproduction evidence (all under volta node 24.18.0):

- red on the main checkout at 3a6da9133 (origin/main tip, 2026-08-06);
- red at b884202e1 (pre-sbsb2 base) in a fresh worktree — byte-identical
  numbers, so the sbsb2 implementation series is NOT the cause;
- red at 05306b990 and its child 753329137 (fix(react): presence bridge)
  — byte-identical, so that commit is not the (sole) cause either;
- red even at 474900850 (2026-08-03, the last commit that touched
  baseline.v1.json) — the very commit that froze the current baselines
  reproduces bigger bundles today;
- identical numbers under two different node_modules trees (the main
  checkout's install and a fresh bun install in a worktree).

Since the baseline-freezing commit itself no longer reproduces its own
baselines, the regression is either (a) environmental — bundler/minifier
or zlib/brotli version drift in the dependency tree relative to when the
baselines were recorded (gzip/brotli bytes vary with zlib; minified bytes
with the bundler) — or (b) a landed dependency change that rotated
resolution for every profile. Either way the ratchet has been failing for
every fresh proof run, and `scripts/verify-local-proof` aborts at this leg
(the ~40 legs after it never run), which is how it stayed unnoticed.

Next steps: identify when the leg last passed in a recorded proof receipt;
diff the bundle module-attribution output (the script emits per-module
attribution) between a recorded green run and today; either fix the
resolution drift or re-freeze baselines deliberately with the growth
accounted for (the ratchet is "never loosened" by design — a re-freeze
needs review, not a silent bump). Until then, proof runs mask this leg
explicitly and say so.

Filed by the sbsb2 implementation session, which hit it as a false
positive on an unrelated series (2,312/2,312 cargo tests green).
