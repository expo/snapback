# Snapback 4 worker fixtures parse JSON before the writer finishes

Date: 2026-10-04
Status: Closed
Scope: `packages/snapback4/test/worker-regressions.test.mjs`

RPF's full Darwin suite reports `Unexpected end of JSON input` in three cases:

- `dev workers/push.mjs snapshot does not add the temporary directory to package lookup`, line 132.
- `dev credentialed worker receives only the explicit runtime environment`, line 674.
- `serve credentialed worker receives only the explicit runtime environment`, line 674.

Each fixture uses worker-side `writeFileSync` to create a JSON result file.
The test waits only for `existsSync` before immediately reading and parsing it.
Opening/truncating the file precedes writing its JSON; file existence does not
prove the content is ready. These fixtures have no tables, so their empty
reservation maps are identical before and after RPF. Test, worker SDK and
supervisor source are unchanged by that lane.

The unmodified base binary (`f2ec498379376421ce7f329c9efee972463cedc3`) reproduces
the **dev environment** case at the same line with the same JSON error.
Four further base repetitions pass all five selected cases. The RPF filtered
rerun fails both environment cases. The package-lookup and serve-environment
failures were observed in the full run; they were not separately reproduced on
base. All share the same premature read pattern. No environment allowlist or
package-isolation assertion was reached in the failing cases.

Reproduce from `snapback4/`, with Node 24 on PATH:

```sh
SNAPBACK4_BIN=/path/to/base/snapback4 node --test --test-name-pattern='snapshot does not add the temporary directory|credentialed worker receives only' packages/snapback4/test/worker-regressions.test.mjs
```

Follow up by atomically renaming the fixture result after writing, or waiting
for complete JSON under the existing bounded helper. Preserve the exact
package-lookup and environment assertions. RPF changed no assertion or timeout.

Evidence: `/tmp/rpf-full.log`, `/tmp/rpf-worker-baseline.log`,
`/tmp/rpf-worker-baseline-{2,3,4,5}.log`, `/tmp/rpf-worker-rerun.log`.
The retained baseline CLI is `/tmp/rpf-baseline-snapback4`.

## Resolution — 2026-10-04, Lane FX

The fixture workers write each result to a sibling temporary file and rename
it atomically after the write completes. Package lookup, schema-local package
resolution, explicit environment, source-replacement and entry-copy fixtures
use the same publication boundary. Append-based fixtures retain their append
semantics, so duplicate writes remain observable. Package-lookup and environment
assertions are unchanged.

The repository-wide test audit also repaired analogous PID/path handoffs and
asynchronous log observations. Repetition counts, deterministic delayed-write
probes, full-suite results and the excluded 13:51Z infrastructure interruption
are recorded in the [FX report](../../snapback4/reports/20261004-fx-test-races/REPORT.md).
No product code changed.
