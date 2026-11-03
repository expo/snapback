import json
import pathlib
import re
import shlex

root = pathlib.Path(__file__).resolve().parent
records = [json.loads(line) for line in (root / 'commands.jsonl').read_text().splitlines()]
by_name = {record['name']: record for record in records}
required = ['delivery-fault-matrix', 'progressive-acquisition', 'progressive-recovery',
            'progressive-lifetimes', 'acquisition', 'typecheck', 'build', 'audit', 'seal', 'node-version']
for name in required:
    assert by_name[name]['exit'] == 0, (name, by_name[name])
    log = (root / by_name[name]['log']).read_text()
    assert all(line in log for line in by_name[name]['summary']), name
assert 'ℹ pass 447' in by_name['delivery-fault-matrix']['summary']
assert 'ℹ skipped 1' in by_name['progressive-acquisition']['summary']
shell_commands = json.loads((root / 'shell-commands.json').read_text())
report = '''# Progressive history — fix round 7

Date: 2026-11-03. Worktree: `snapback-ph-20261102`, branch
`sb4/progressive-history`, starting HEAD `05594aee8098078bb39dd9fd11ece8e79b9527fa`.
Changes are uncommitted for the supervisor and confined to `snapback4/`.
No agents, clones, remote commands, other checkouts, commit, stash, checkout,
restore, rebase, push, dependency installation or wasm build were used.

## Result

| Requested check | Observed result |
| --- | --- |
| Whole delivery-fault-matrix file | 447 passed, 0 failed |
| Whole progressive-acquisition file | 33 passed, 0 failed, 1 declared browser skip |
| Whole progressive-recovery file | 10 passed, 0 failed |
| Whole progressive-lifetimes file | 7 passed, 0 failed |
| Whole acquisition file | 47 passed, 0 failed |
| Typecheck | Exit 0 |
| JavaScript build | Exit 0 |

**216 classified delivery sites: 101 required, 115 optional.** No site was
removed, exempted, reclassified, or given a default recipe. Both seal files were
regenerated; their bytes are unchanged. The complete matrix passes its exact
boundary and site/recipe comparisons, plus every transient/persistent fault case.

## Diagnosis and classification

The supplied hypothesis differs from the code. Comparing round 4's commit
`f37bdfc0ae` with the current source using TypeScript's AST finds **zero new,
removed, moved-between-these-files or changed await expressions** in the three
named files. Their ordered expression lists are identical:

| Source | Round 4 | Current | Classification of this delta |
| --- | ---: | ---: | --- |
| `packages/snapback4/src/local.ts` | 134 | 134 | Startup condition and progress-reset logic changed synchronously; no new I/O or delivery site. |
| `packages/snapback4/src/local-runtime.ts` | 95 | 95 | Metadata reachability, overload handling and snapshot-restart state changed; the existing waits and delivery classes remain. Includes the existing async iterator. |
| `packages/snapback4/src/acquisition.ts` | 0 | 0 | Null-prototype progress maps are synchronous UI bookkeeping, not durable write delivery. |

The failing site is census index **16**, fixture recipe **166**, logical ID
`local.ts:syncRound:loadBackend(doFetch, base, requestCredentials().headers, aborter.signal)#1`,
physically `packages/snapback4/src/local-runtime.ts:295`. Round 5 (`918307c084`)
changed its guard to require `progressiveState(...).acquired === false`.
The old metadata recipe set compatibility unknown on an already-acquired device;
that device now correctly bypasses discovery. Consequently neither fault mode
reached the selected await. The focused before run reproduced exactly the two
reported injected-fault assertions, while the seal test passed.

This await remains **optional metadata I/O relative to durable write delivery**.
A failed capability fetch pauses sync; it cannot admit, dispatch, acknowledge,
settle, or persist a mutation itself. Its fixture now starts a negotiated cold
walk, durably publishes a real conversation unit into the wasm device, pauses
before the remaining units, and uses the existing unknown-compatibility hook.
The device's actual cursor, whole-table fact, `acquired=false`, and
`replacement_required=false` are asserted; no sync-state reply is forged.

Faults are thrown by the `/schema` transport below the selected await. The
transient case must experience exactly one such failure, and the persistent case
must experience repeated failures. Both retain all original delivery assertions:
three healthy unique sends, no repost, FIFO head/tail ordering, one terminal
notification per id, lookup agreement, bounded retries, successful caller
outcomes, and same-id outcome collection without another send. Acquisition stays
false during the paused walk even after sends succeed. Removing the fault and
resuming the remaining units must make explicit sync finish acquired.

The existing required durable-write sites and their fault/recovery recipes are
unchanged; all 101 remain exercised by the full file. `LocalAcquisition.sync`'s
already-reviewed owner-sequencing awaits remain covered by progressive-recovery's
first/later rejection and stopped-round cases. No new metadata or durable-write
site was silently exempted.

## Changed files

Paths and line numbers below are relative to `snapback4/`.

- `packages/snapback4/test/delivery-fault-fixture.mjs:30`: opt-in unfinished
  acquisition transport, capability advertisement, first published unit,
  remaining packed units/floors and explicit resume (`:123`). All default fixture
  paths retain their previous behavior. This is scripted transport over the real
  wasm device, not a server implementation change.
- `packages/snapback4/test/delivery-fault-matrix.test.mjs:113`: select that fixture
  only for metadata; `:129` records actual schema transport faults; `:154` checks
  durable partial state; `:161` and `:175` probe the healthy write transport after
  intentional sync pauses; `:293` checks one/repeated faults and incomplete
  acquisition; `:307` verifies full recovery. Existing FIFO/outcome assertions
  are retained, without loosening required/optional failure semantics.
- `packages/snapback4/test/delivery-fault-recipes.mjs:6`: document the metadata
  recipe's reachability and its delivery/recovery obligations. Mapping unchanged.
- `packages/snapback4/test/delivery-fault-instrument.mjs:863`: record the honest
  rounds-5/6 await audit and the repaired fixture; instrumentation/scope unchanged.
- `reports/20261102-progressive-history-reviews/fix-r7/audit.mjs:1`: reproducible
  AST comparison with round 4 and complete seal/classification verification.
  `seal.mjs:1` regenerates both seal files; `run.py:1` records exact child argv,
  exits, raw logs and verbatim summaries. This report and command evidence live
  beside them.

`delivery-await-boundary.json` and `delivery-fault-sites.json` were regenerated
successfully but produce no diff because expressions, IDs and classifications
were already correct. `git diff --exit-code -- packages/snapback4/src
packages/snapback4/test/delivery-await-boundary.json
packages/snapback4/test/delivery-fault-sites.json` exited 0 with no output.
No product behavior, contract, Rust, guide, refusal code, LLP, journal or budget
was changed. Changed test files are 140/869/425/269 lines, all below 1,500.

## Earlier diagnostics, retained rather than counted as passes

- `metadata-before`: 1 passed (census), 2 failed, matching the reported
  unreachable-injected-fault assertions on the original recipe.
- `metadata-after`: first fixture attempt, 1 passed, 2 failed on the expected
  partial cursor. The synthetic page mistakenly used an array for
  `committed_above`; the device protocol uses a map, corrected to `{}`.
- `metadata-after-wire-fix`: 1 passed, 2 failed because the deliberate acquisition
  pause left the transport offline before the head write. Added a real probe.
- `metadata-after-probe`: 1 passed, 2 failed on successful caller outcomes because
  the head's follow-up observation again paused sync before tail admission.
  Reconnected before admitting the tail; no assertion was weakened.
- `metadata-after-reconnect`: all 3 passed. The final full matrix additionally
  includes the strengthened exact-schema-fault and acquisition-recovery assertions.

## Scope limits and open questions

- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**, as instructed.
  Progressive acquisition reports its existing explicit browser skip:
  `not run (sandbox): react.test.mjs and witness/idb.mjs SIGABRT; supervisor owns browser validation`.
  No browser/React pass is claimed.
- No wasm build. The JavaScript build copies the existing supervisor-built wasm;
  the matrix executes that artifact. No wasm budget was changed.
- No Rust suite, complete battery, affected runner, publication qualification,
  remote test or performance measurement was run; this is test infrastructure
  maintenance and the requested scoped checks only. Supervisor-provided Rust
  verification is not represented as this round's work.
- All requested loopback suites passed their first full invocation in this round;
  there was no loopback-binding failure requiring a rerun.
- No unresolved product/design question. The supervisor owns committing and
  landing. The current implementation, rather than the prompt's new-await
  hypothesis, governs the classification above. STOP after this report.

## Commands and verbatim summaries

All bun and validation commands ran from `snapback4/`. The recorder selects
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first on PATH; the actual
runtime reports `v24.18.0`. No install was needed. For every recorded run below,
the shown wrapper is the actual shell command; `commands.jsonl` also contains
its child argv and exit. Raw logs are linked. All summary lines are copied
verbatim, including failed diagnostic runs. An exit-zero typecheck with only its
script line is not assigned an invented test count.
'''
for record in records:
    name = record['name']
    matches = [item['cmd'] for item in shell_commands if re.search(r'/run\.py ' + re.escape(name) + r' ', item['cmd'])]
    assert len(matches) == 1, (name, matches)
    report += f"\n### {name}\n\n`{matches[0]}` — exit {record['exit']}. [Raw log]({record['log']}).\n\n```text\n"
    report += '\n'.join(record['summary']) + '\n```\n'
report += '''
## Inspection and preparation commands

These commands inspect files, diffs, or running logs; they are not test passes.
Ordinary `cat`/`sed`/`rg`/Git reads emit source or inspection output, not a test
summary line. Their exact shell text and exit status follow in execution order;
the machine-readable copy is [shell-commands.json](shell-commands.json).
The first broad reads were output-truncated and followed by smaller reads.
Two mistyped inspection paths failed (listed as exit 1); neither ran a test.
Edits used apply_patch, not additional shell commands. Tool waits only collected
already-running processes and are not reruns.
'''
for item in shell_commands:
    if '/run.py ' in item['cmd']:
        continue
    report += f"\nDirectory: `{item['cwd']}`; exit {item['exit_code']}; no test summary.\n\n```sh\n{item['cmd']}\n```\n"
report += '''
Preparation command output:

```text
prepared fix-r7 command recorder and seal generator
```

`git diff --check` passed twice (exit 0, no output). The source-and-seal no-diff
check passed (exit 0, no output). No source file was restored from Git.

Final reporting command (from `snapback4/`):

```sh
python3 reports/20261102-progressive-history-reviews/fix-r7/write-report.py
```

It verifies the required successful exits and copied summary lines against their
logs, includes every diagnostic summary, and enforces this report's line limit.
Its success summary is:

```text
report written and verified; all command summaries retained; 216 classified sites
```
'''
assert len(report.splitlines()) < 1500
for record in records:
    assert all(line in report for line in record['summary']), record['name']
(root / 'REPORT.md').write_text(report)
assert (root / 'REPORT.md').read_text() == report
print('report written and verified; all command summaries retained; 216 classified sites')
