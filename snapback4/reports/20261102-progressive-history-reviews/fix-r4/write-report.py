"""Render the round's report from retained, observed command output."""
import json, pathlib, re, shlex

root = pathlib.Path(__file__).resolve().parent
records = [json.loads(line) for line in (root / 'commands.jsonl').read_text().splitlines()]
full = next(record for record in records if record['name'] == 'device-full')
assert full['exit'] == 0, 'Do not report an incomplete or failed device suite as green'
totals = [tuple(map(int, re.search(r'(\d+) passed; (\d+) failed; (\d+) ignored', line).groups()))
          for line in full['summary'] if line.startswith('test result:')]
passed, failed, ignored = map(sum, zip(*totals))

intro = """# Progressive history — fix round 4

Date: 2026-11-03. Worktree: `snapback-ph-20261102`, branch `sb4/progressive-history`.
Changes are uncommitted for the supervisor. No agents, remote commands, cloning,
other checkouts, git commits, stash, checkout, rebase, push, or wasm build were used.
Changes are confined to `snapback4/`; no LLP was added or changed.

## Result

All six complete reported red client files pass: delivery matrix 447, lifecycle 57,
asset lists 42, HTTP bounds 12, column recovery 1, bounded following 39. The complete
device command passed: **FULL_TOTALS** (sum of its individual harness summaries,
which are reproduced verbatim below). Core/device/simulator progressive suites,
JavaScript typecheck/build, native binary build, and all 139 guide tests passed.

The additional progressive-client run has an infrastructure failure: the ephemeral
file cannot initialize its Darwin identity inspector because sandboxed `ps` gets
`spawn EPERM`. Its product cases did not run. The other three files produced 43
passes and one declared browser skip. The final strengthened recovery file also
passed all six cases separately. This is not a claim that the entire additional
four-file command passed.

## Product changes and evidence

Paths below are relative to `snapback4/`.

- `packages/snapback4/src/local.ts:1210`: awaited opening now drives the existing
  acquisition scheduler through completion, instead of awaiting one network turn.
  Explicit `sync()` already used that scheduler. `waitSeconds` is the change-poll
  setting in the existing implementation, not a startup deadline. No new timer
  or readiness marker was introduced.
- `packages/snapback4/src/local-runtime.ts:293`: an already-required replacement
  can discover restore evidence through `/sync` without first requiring a new
  `/schema` capability fetch. The existing upgrade restore witness can make only
  the sync evidence reachable; capability discovery had prevented the restore
  refusal from being observed, leaving follow/flush without the required fence.
- `packages/snapback4/src/local-runtime.ts:277`, `:309`, `:420`: retain an acquire
  request's cursor/hint/skip while reducing its HTTP page limit. An indivisible
  acquisition `E_BOUND` enters the existing staged replacement path. HTTP response
  overflow first shrinks the same acquire request; at limit one it can also try
  replacement. A replacement that still cannot deliver one row surfaces the typed
  refusal once and does not spin. Identity/adoption changes clear the cached
  request. This is bounded error recovery, not a staged cold progressive walk.
- `crates/snapback4-device/src/device.rs:135`,
  `crates/snapback4-device/src/device/store_identity.rs:80`, and
  `packages/snapback4/src/local-runtime.ts:324`: a transient local capture checks
  the existing acquisition cursor, replacement flag, acquired marker and snapshot
  owner before store observation and again inside apply. Two owners can otherwise
  complete or replace a walk at the same watermark, so watermark comparison alone
  misses the superseded response. The client overwrites the field after decoding
  the wire. It adds no durable fact, owner token, extent, receipt, watermark or cut.
- `crates/snapback4-device/src/device/progressive_tests.rs:252`: both MemoryStore
  and SQLite reject a delayed progressive page after another walk completes,
  another owner stages a replacement, or a replacement publishes at the same cut.
  Both observation and apply return `E_GENERATION`; current state and restore
  status remain intact.
- `packages/snapback4/test/progressive-recovery.test.mjs:1`: first/later scheduler
  rejection, false/stopped rounds, shrinking the same acquire request while the
  foreground conversation changes, eventual acquisition/catch-up and correct
  offline history, and permanent failure only after one-row replacement fails.
  `test/helpers/progressive-acquisition.mjs:124` supports injected HTTP responses.
- `packages/snapback4/test/progressive-budget.test.mjs:27`: the existing compact
  million-cell row exceeds progressive retained-heap accounting but is deliverable
  by legacy staged replacement. The test now requires that recovery, the entire
  million-cell payload, ready state and acquired offline reopen. Its old permanent
  refusal expectation conflicts with this round's explicit fallback requirement;
  the new recovery file retains permanent-refusal/no-spin coverage when replacement
  itself really fails. This is an intentional recovery behavior change, not a
  relaxed readiness or answer assertion.

### Delivery census and required file split

`local.ts` started above the requested 1,500-line ceiling. Fourteen existing
sync/delivery functions moved into `packages/snapback4/src/local-runtime.ts:137`
through live state accessors constructed at `local.ts:231`; forwarding functions
retain the original owning promises. Final sizes are 1,487 and 862 lines.
No second client state, queue or network owner is created.

`test/delivery-fault-instrument.mjs:34` now instruments the physical runtime file
while retaining logical `local.ts` site IDs. `test/delivery-fault-recipes.mjs:33`
uses explicit semantic site-to-fixture mappings, so moving a function cannot
silently reassign fault recipes. The new capability-fetch await has its own
metadata recipe (`:6`) and fault injection (`delivery-fault-matrix.test.mjs:169`):
it is optional to durable write delivery, with FIFO/outcome recovery still checked.
The two `LocalAcquisition.sync` awaits sequence existing network owners; their
first/later rejection and stopped-round behavior is tested explicitly. The await
boundary seals include them and the moved runtime. No new I/O await was blindly
exempted. The regenerated seal is **216 classified delivery sites and recipes**.

`test/delivery-fault-sites.json:1` is compacted to one record per line to meet the
line ceiling. `test/upload-delivery-matrix.mjs:16` follows logical site IDs after the
split. `test/web-admission-review.test.mjs:77` and
`test/web-receipt-upgrade.test.mjs:44` point their source instrumentation at the
moved runtime; the former's unconditional sync-entry hook also includes the
existing acquisition-failure gate. Those browser files were syntax-checked only.

`crates/snapback4-lang/src/guide/sync.rs:173` is the only documentation change:
the forced acquisition card now describes staged fallback and one-row refusal.
No Quarry snippet, new refusal code, public contract shape, mutation admission,
ACQUIRED publication rule, server algorithm or row-version history was changed.

## Disposition of every reported red

| File / case | Product fix or wire-only test adaptation | Preserved behavior |
| --- | --- | --- |
| `delivery-fault-matrix.test.mjs`, await census | Honest classification, seals, metadata fault recipe and relocated instrumentation. Initial post-split run exposed six upload-fixture routing failures; logical-ID routing fixes those. | All 447 cases pass; required/optional recovery assertions remain. |
| `client-lifecycle.test.mjs`, write sending when snapshot starts | The test explicitly intercepts `snapshot` continuations and gates a write on those pages. Withhold only the capability advertisement in that witness (`:868`) to select the legacy path, just as the established acquisition tests do. The wasm regression was its snapshot gate never being reached under acquire, not evidence of broken receipt correlation. | Pending/outcome, acknowledgment/retirement, count and catch-up assertions are unchanged. Progressive in-flight writes remain covered by the existing interactive-send client test and real-server own-write device tests, both run. |
| `asset-lists.test.mjs`, paged upgrade restore (both tiers) | Product fix: bypass unnecessary capability discovery for required replacement. These tests were not changed. | Restore refusal, stopped follow and stopped flush assertions remain. |
| `asset-lists.test.mjs`, four overtaken legacy continuation cases | Withhold advertisement only in their shared fetch (`:649`), because the cases specifically fabricate legacy nonterminal/terminal continuations. Also fix the actual progressive same-watermark owner gap with the device capture fence and its both-store regression. | All original legacy publication/staging/stale-page assertions remain; progressive delayed pages are separately refused. |
| `http-bounds.test.mjs`, wide acquisition and outer admission suite | Product startup/fallback fixes. Wire assertions (`:259`) first require advertised acquire and its real `E_BOUND`, then verify the original exact 10000→39 shrink sequence on the staged replacement cursor. A separate injected HTTP-overflow test verifies shrinking acquire itself, including stable hints despite an observation change. | Acquired on awaited open, continuation, ordinary catch-up, correct count and all HTTP admission/encoding/reader/poll checks remain. |
| `column-stream-recovery.test.mjs` | Product startup fix; test file unchanged. Initial acquisition actually succeeds a unit at a time, but opening used to return after one unit. No server pagination patch was warranted. | Acquired after open, oversized parent-mirror recovery, row/answer correctness and both storage tiers remain. |
| `bounded-following.test.mjs` | Verified red after the supervisor's ephemeral fix: scalar-cut cases failed on both tiers. Product startup fix; test file unchanged. | Offline/local read fencing and scalar answer assertions remain; entire 39-case file passes. |

### Counterfactual regression checks

- Startup: remove only the new opening scheduler wait with `without-fix.mjs`;
  the unchanged column-recovery file fails its acquired assertion (0 pass, 1 fail).
- Required-replacement discovery: remove only the replacement check; both unchanged
  paged-upgrade cases fail their missing `E_STORE_RESTORE` behavior (0 pass, 2 fail).
- Fallback: disable only `acquireBound`; the full HTTP file fails acquisition
  (10 pass, 2 fail, including the failed parent suite).
- Same request during shrinking: remove only cached-request reuse; both process
  and wasm tests fail because the retry hint changes from conversation c to d
  (0 pass, 2 fail). With the fix the full recovery file passes all six cases.
- Progressive owner: temporarily disable only the new device capture guard in
  our edited source; the new test fails because stale observation returns `Ok`.
  Restore our guard; targeted test passes, and the full device suite includes it.
- Census: the previous 215-record seal lacks the new metadata await and new
  acquisition wrapper seals; the updated full matrix checks the complete boundary
  plus all 216 classified recipes. No pre-fix full matrix pass is claimed.

The JavaScript counterfactual loader changes only that test process's loaded code.
It refuses to run if its intended replacement does not match. Native guard
counterfactual restoration used our saved file content, never git checkout/restore.

## Specification and current-code findings

Read revision 1 of LLP 3000.001.001 in full first, then Snapback 4 AGENTS and
NOT-DOING and parent Repair A/B. Applied `llp-orient`, read the parent design and
relevant rules/current sync card, and inspected supervisor commit `b03f265d58` and
`progressive-ephemeral.test.mjs`. The same-watermark owner check and recovery stay
within the existing boundary/whole-table facts, Repair B deferral, one watermark,
global write gate and negotiated capability rules.

Current code resolves three hypotheses differently from the prompt: the HTTP
overflow matcher already recognizes the general HTTP message (no matcher change);
the oversized column seed was stopped by early opening, not indivisible server
pagination; and compact JSON can exceed progressive heap accounting while still
being deliverable by staged replacement. The actual HTTP wide-horizon fixture
does hit an indivisible acquisition bound, so its recovery uses replacement.

## Not run and remaining limitations

- Browser/React: **not run (sandbox)**. This includes `react.test.mjs`,
  `witness/idb.mjs`, and execution of the two adjusted browser instrumentation
  files. Node syntax checks do not claim browser behavior passed. The existing
  browser case in the progressive suite reports its declared skip verbatim.
- `progressive-ephemeral.test.mjs`: attempted but its fixture initialization was
  blocked before any product case by `TEST_SIGNAL_REFUSED: cannot build Darwin
  identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM`. No process
  inspection workaround or sandbox escalation was attempted. Other loopback
  suites ran; no repeated bind failure needed the requested single rerun.
- **No wasm build**, as instructed. Wasm client tests use the existing checked-in
  artifact. JavaScript build copies that artifact and does not compile it. The new
  Rust stale-owner guard is verified on MemoryStore and SQLite; execution of that
  guard in a freshly built wasm artifact remains with the supervisor.
- Did not rerun all 491 files or `affected.mjs`, which would exceed this round's
  requested scoped validation and include prohibited browser/wasm work. Every
  listed red file was run in full. Did not run or change the explicitly excluded
  base-red `dx12-serve` shutdown case.
- No product design question blocks this chunk. Supervisor follow-through is the
  fresh wasm/browser validation and the sandbox-blocked ephemeral fixture. The
  supervisor owns committing these changes. STOP after this report.

## Commands and verbatim summaries

All cargo and bun commands ran from `snapback4/`. Node was
`/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node` (`v24.18.0`), selected by
prepending that directory to PATH. Cargo used `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`. No install was needed.
An initial `volta run --node 24` attempt was refused because Volta could not write
its sandbox-excluded temporary directory; the pinned binary was then used directly.

Final invocations below were executed through
`python3 reports/20261102-progressive-history-reviews/fix-r4/run.py NAME COMMAND...`.
The runner retains exact argv, exit status and summaries in [commands.jsonl](commands.jsonl).
Counterfactual environment variables are shown explicitly below (they are inherited
by the runner). Raw logs retain diagnostics as well as the selected summaries.
An exit-zero command without output is labeled as such, not assigned a made-up
test summary. Full device output has multiple harness summaries; every one appears.

""".replace('FULL_TOTALS', f'{passed} passed, {failed} failed, {ignored} ignored')

parts = [intro]
for record in records:
    command = shlex.join(record['command'])
    if record['name'].endswith('-counterfactual'):
        command = f"SB4_FIX_R4_WITHOUT={record['name'].split('-')[0]} " + command
    parts.append(f"### {record['name']}\n\n`{command}` — exit {record['exit']}. [Raw output]({record['log']}).\n\n")
    if record['summary']:
        parts.append('```text\n' + '\n'.join(record['summary']) + '\n```\n\n')
    else:
        parts.append('No summary or other output emitted.\n\n')

early = {
    'cargo-build': ('cargo build -p snapback4', 0),
    'bounded-before': ('node --test packages/snapback4/test/bounded-following.test.mjs', 1),
    'lifecycle-before': ("node --test --test-name-pattern='already sending' packages/snapback4/test/client-lifecycle.test.mjs", 1),
    'asset-before': ("node --test --test-name-pattern='paged upgrade|overtaken' packages/snapback4/test/asset-lists.test.mjs", 1),
    'column-before': ('node --test packages/snapback4/test/column-stream-recovery.test.mjs', 1),
    'http-before': ('node --test packages/snapback4/test/http-bounds.test.mjs', 1),
    'wide-first': ('node --test packages/snapback4/test/column-stream-recovery.test.mjs packages/snapback4/test/http-bounds.test.mjs', 1),
    'upgrade-first': ("node --test --test-name-pattern='paged upgrade' packages/snapback4/test/asset-lists.test.mjs", 0),
    'bounded-startup': ("node --test --test-name-pattern='scalar cut' packages/snapback4/test/bounded-following.test.mjs", 0),
    'owner-first': ('cargo test -p snapback4-device --lib [filter: superseded_progressive_owner]', 0),
    'owner-counterfactual': ('cargo test -p snapback4-device --lib [filter: superseded_progressive_owner; guard disabled]', 101),
    'budget-first': ('node --test packages/snapback4/test/progressive-budget.test.mjs', 1),
    'reds-first-full': ('node --test packages/snapback4/test/client-lifecycle.test.mjs packages/snapback4/test/asset-lists.test.mjs packages/snapback4/test/http-bounds.test.mjs', 0),
    'split': ('node reports/20261102-progressive-history-reviews/fix-r4/split-runtime.mjs', 0),
    'typecheck-split': ('bun run --cwd packages/snapback4 typecheck', 2),
    'typecheck-split2': ('bun run --cwd packages/snapback4 typecheck', 0),
    'progressive-first': ('node --test packages/snapback4/test/progressive-acquisition.test.mjs packages/snapback4/test/progressive-budget.test.mjs packages/snapback4/test/progressive-recovery.test.mjs', 0),
    'delivery-first': ('node --test packages/snapback4/test/delivery-fault-matrix.test.mjs', 1),
}
for name in ['build-first', 'build-second', 'build-split', 'build-recovery']:
    early[name] = ('bun run --cwd packages/snapback4 build', 0)
parts.append('### Earlier diagnostic invocations\n\nThese logs predate the argv-recording runner. The executable/targets/filters are\nidentified below; shell redirects and the exact early Rust filter spelling were\nnot retained. Summaries are copied from the actual logs, including failed attempts.\nThe first split typecheck failed on missing imported types and refusal narrowing;\nthose were fixed before the successful rerun. The first split script invocation\nhad a TypeScript module path error; its successful rerun output is retained.\nThe first post-split matrix failed six upload fixture routes, subsequently fixed.\nThe first wide run had only the obsolete exact-wire sequence assertions remaining.\n\n')
prefixes = ('test result:', 'ℹ ', '    Finished', '$ ', 'guide api', 'split ')
for name, (command, status) in early.items():
    lines = (root / 'logs' / f'{name}.log').read_text().splitlines()
    summaries = [line for line in lines if line.startswith(prefixes)]
    parts.append(f"**{name}** — `{command}`; exit {status}. [Raw output](logs/{name}.log).\n\n```text\n" + '\n'.join(summaries) + '\n```\n\n')

parts.append("""### Inspection, editing and reporting commands

Read-only inspection used `cat`, `sed -n`, `rg` / `rg --files`, `head`, `tail`,
`wc -l`, `git status --short`, `git diff` (including `--stat`, `--numstat` and
`--check`), `git show b03f265d58`, and the Node/Volta path/version lookups. These
read the specified RFC, AGENTS/NOT-DOING, parent Repair A/B and governing context,
the supervisor's commit/test, scoped product and test sources, and the retained
logs. Repeated log reads are inspections, not additional test executions. They
emit no test summary. The final unwrapped `git diff --check` also exited zero
without output after the strengthened retry test.

The retained one-time editing helpers were invoked with Node:
`split-runtime.mjs`, `classify-awaits.mjs`, `tidy-imports.mjs`, and `seal.mjs` in
this report directory. They perform the extraction, classification mapping,
import cleanup and seal generation described above; they are provenance, not
repeatable migrations. Apply-patch and small Python file edits were used for the
other scoped edits. Python log-summary reads inspected the same retained logs.
No additional test pass is inferred from editing or inspection commands.

`python3 reports/20261102-progressive-history-reviews/fix-r4/write-report.py`
generated this report from the completed command manifest and retained logs.
Its summary is `report written; all recorded summaries included`.
""")
report = ''.join(parts)
assert len(report.splitlines()) < 1500
(root / 'REPORT.md').write_text(report)
print('report written; all recorded summaries included')
