# Snapback 4 API index test cannot read the proof-runner script export

Status: Resolved
Found: GEN1 affected client verification, 2026-10-28
Scope: snapback4/packages/snapback4/test/api-index.test.mjs

`node --test packages/snapback4/test/api-index.test.mjs` fails in
exportsBySubpath with `Cannot read properties of undefined (reading 'includes')`.
The manifest exports `./proof-runner` as `./bin/proof-runner.js`; the test only
looks for src/<subpath>.ts or .tsx, passes undefined into createProgram, and
has no script-export/index-row treatment.

Inherited from origin/main 11fb847329: the test's baseline and working file
SHA256 are both b03c9aeaf5ead2c1d9736bb26e2fcccb5191607bff0d04ac60948b5095925357.
The manifest and API card are also unchanged in GEN1. This is outside GEN1's
codegen and pointer-line ownership. Follow up by distinguishing the finite CLI
runner script from declaration-bearing module exports while preserving a
complete guide API index; do not weaken the typed-module export checks.

Resolution (Integration 32, 2026-10-28): census script-valued exports at their
manifest path using allowJs, retaining typed source export assertions. Add the
proof-runner row and five missing proof helpers to guide api. Both API-index
tests pass. No product export or module authority changes.
