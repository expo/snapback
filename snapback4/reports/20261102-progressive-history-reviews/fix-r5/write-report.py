import json, pathlib, re, shlex

root = pathlib.Path(__file__).resolve().parent
records = [json.loads(line) for line in (root/'commands.jsonl').read_text().splitlines()]
device = next(record for record in records if record['name'] == 'full-device')
totals = [tuple(map(int, match)) for match in re.findall(r'test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;', (root/device['log']).read_text())]
passed, failed, ignored = map(sum, zip(*totals))
body = f'''# Progressive history — fix round 5

Date: 2026-11-03. Worktree `snapback-ph-20261102`, branch `sb4/progressive-history`.
All changes are uncommitted for the supervisor and confined to `snapback4/` and
`llp/`. No agents, clones, remote commands, other checkouts, commits, stash,
checkout/restore, rebase, push, wasm build, or budget changes were used.

## Result and limits

Both product defects are fixed. The new regressions reproduced unknown owner-key
absence on memory and SQLite, and eight schema attempts instead of four on saved
partial and complete web replicas, before their respective fixes. They pass with
the fixes. The original client `own-keys.test.mjs` and `overload.test.mjs` are
unchanged; both commands fail during harness import on sandbox `ps` EPERM, before
any product case executes. **Their green status still needs supervisor execution.**

The full device command exited {device['exit']}: **{passed} passed, {failed} failed,
{ignored} ignored**, summed from every actual harness summary reproduced below.
The progressive client command has 47 passing cases, one declared browser skip,
and one harness import failure (`progressive-ephemeral.test.mjs`, `ps` EPERM).
Those 47 include the complete progressive acquisition/recovery/budget files and
both new process/wasm offline owner-key cases. It is not a green four-file command.
The strengthened recovery file subsequently passes all 10 cases, including
sign-out before offline reopening and a different caller on each core.
Legacy acquisition passes 47, progressive startup passes 48, and the focused
owner-key device target passes 8. Typecheck and client build pass. No timing or
publication qualification is claimed. See every command's exact status below for
the remaining Rust, guide, reference and whitespace checks.

## Changes (paths relative to snapback4/)

- `crates/snapback4-core/src/partition/acquire.rs:128`: when the tier-1 walk
  exhausts an owner-key projection, enumerate its server-authorized principal
  group and carry it in the existing `joined` field, including zero keys. Packed
  pages already merge these declarations. No declaration is inferred from row
  count or emitted for an unfinished table, and `whole_eligible` is unchanged.
- The existing `crates/snapback4-device/src/device/acquisition.rs:116` already
  turns fresh progressive `joined` declarations into Held membership through the
  ordinary transactional/deferral applicator. No device code or new wire field
  was necessary. Maintained projections still have no early whole-table fact;
  their query gate remains full acquisition. Caller-specific history lookup
  continues to reject another principal's proof on the same store.
- `packages/snapback4/src/local.ts:1209`: if initial schema discovery ended in
  a coded refusal, awaited opening returns the saved usable backend without
  repeating acquisition discovery before returning. The existing background
  owner continues retries; successful online startup still completes its walk.
- `packages/snapback4/src/local-runtime.ts:293`: a fully acquired saved replica
  needs no acquisition-capability lookup for ordinary streaming. At `:328`, a
  typed metadata overload preserves its refusal and connected link instead of
  being translated to a transport outage. An unfinished walk still negotiates
  before sending `acquire`; no old-server capability is assumed.
- `crates/snapback4-device/tests/own_keys.rs:115`: new progressive tests on
  memory and SQLite cover populated/empty key partitions, limit-one pagination,
  reopening after each page, no early maintained-table admission, complete true
  and false proofs, and an aliased-store different-caller miss staying unknown.
- `packages/snapback4/test/progressive-recovery.test.mjs:11`: partial and complete
  saved web replicas open after exactly four refused schema attempts, retain
  readable inbox data, keep background overload connected and resume acquisition
  when it clears. At `:57`, process and existing wasm adapters prove own-key
  presence/absence offline after progressive sync, sign-out and reopen, and
  reject another caller's miss on the same core. The helper's
  `interceptSchema` hook is at `packages/snapback4/test/helpers/progressive-acquisition.mjs:112`.
- `../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md:781` records
  both corrections and updates Revised metadata; `JOURNAL.md:111201` appends a
  dated record. No LLP number or acceptance status changed.

## Governing context and code corrections

Scoped llp-orient context: LLP 3000 (root, one interpreter/partition), LLP
3000.001 Repairs A/B (server-named coverage, current-image publication and
own-write deferral), LLP 3000.001.001 §§6/8/9/10.1 (unit publication, readiness,
compatibility and witnesses), and LLP 3000.028 §3.4 (principal-scoped owner-key
proof). Snapback 4 AGENTS/NOT-DOING, adopted rules, the sync/client guide text and
journal tail were read. No new design or corpus hand-off is required.

The tree already implements increment 1, despite the RFC's retained proposal-era
description. More specifically, `StreamPage` has `joined`, while the legacy
`SnapshotPage` carries `held`; the existing progressive device classifier can
publish `joined` as Held without introducing a second declaration. The regression
was the missing server declaration, not an absent device classification mechanism.
Owner-key read preflight still uses the global full-acquisition gate for maintained
projections. This change preserves that narrower behavior rather than promising
early owner-key queries. One watermark, Repair B, staged replacement, mutation
and prediction gates, and `contract.ts` are unchanged.

The saved-backend regression was reproduced in a runnable harness: initial
`/schema` made four bounded overload attempts, then `startCore` awaited a sync
turn whose new compatibility discovery made four more. Its generic catch changed
the link to offline. The fixes remove the repeated awaited dependency and correct
background classification; they do not suppress explicit sync errors or invent
acquisition completion.

## Verification method

Every execution below ran through `python3 reports/20261102-progressive-history-reviews/fix-r5/run.py NAME COMMAND...`
from `snapback4/`, except `./ref-check --verbose` and `git diff --check`, whose
working directory was the repository root and whose runner path was prefixed
with `snapback4/`. The runner prepends Volta Node **24.18.0** to PATH and sets
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
Existing locked dependencies were available; no install was needed. The client
build copies the existing supervisor-built wasm; it does not rebuild it. Raw
outputs and argv/status records are retained in `logs/` and `commands.jsonl`.

The first device regression attempt was a test-fixture error (missing required
`snapshot:false`) and is retained as a failure, not product evidence. After that
  fixture correction, both cases failed on the actual unknown/incomplete absence
before the server fix. Both saved-web regressions also failed before the client
fix. No failing harness import is counted as a product case or pass. The initial
HTTP command named a nonexistent integration target; no cases ran. Its error was:

```text
error: no test target named `serve_sync` in `snapback4` package
```

The corrected binary-test filter passed all three HTTP cases. No loopback-binding
failure required a retry.

All summary lines below are copied verbatim from captured output. A silent
successful command is explicitly labeled; no synthetic test summary replaces it.

'''
for record in records:
    body += f"### {record['name']}\n\n`{shlex.join(record['command'])}` — exit {record['exit']}. [Raw output]({record['log']}).\n\n"
    if record['summary']:
        body += '```text\n' + '\n'.join(record['summary']) + '\n```\n\n'
    else:
        body += 'No output (silent successful check).\n\n'
body += '''## Not run, blocked checks and open questions

- `react.test.mjs`, `witness/idb.mjs`: **not run (sandbox)**, as instructed;
  these SIGABRT here. The declared browser placeholder remains a skip.
- Original own-keys and overload files, answers-stay-review, ordinary-history,
  retained-history and progressive-ephemeral: attempted, but no product cases
  ran because the Darwin process-identity inspector fails at import with
  `TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM`.
  No harness guards were bypassed, and the original two test files were not edited.
- No wasm build, full browser battery, release/publication qualification or
  broad affected/battery command: outside this narrow fix round; the requested
  scoped commands were used. No new dependency or install command.
- Remaining supervisor action: run the blocked unchanged client files and
  browser witnesses outside this sandbox. The existing wasm passed the runnable
  owner-key client witness; no device Rust change requires a new wasm for this fix.
- No unresolved product/design question was identified. An already completed
  store created by the buggy walk has no retroactive repair in this narrow fix;
  its existing unknown owner-key proof remains unknown until normal replacement
  acquisition. This work repairs new progressive walks, without inventing a
  persisted-data migration or clearing stores.

## Inspection, editing and reporting commands

[inspection-commands.json](inspection-commands.json) retains the initial read-only
command inventory: RFC/AGENTS/NOT-DOING/skill and parent/owner-key context reads,
`rg`/`sed`/`cat` source searches, toolchain path listing, prior reports and Git
status/diff. These print source text, not test summaries; a few missing guessed
filenames printed their normal not-found diagnostics and were then located with
`rg`. Subsequent inspection used `tail -n`/`rg -n` on retained logs, `git diff`
(`--stat`, `--numstat` and scoped paths), `git status --short`, and `wc -l` on all
changed source files. They did not execute additional tests. Source lengths are
250 / 281 / 1487 / 863 / 127 / 162 lines (server acquisition, device own-keys,
local, local-runtime, recovery tests, helper); all remain below 1,500.

Edits used apply_patch. Two inline `python3 -` file edits appended the dated
journal entry and updated RFC Revised metadata; their verbatim output was:

```text
JOURNAL.md: appended dated fix round 5 entry
LLP 3000.001.001: Revised metadata records fix round 5
```

`python3 reports/20261102-progressive-history-reviews/fix-r5/write-report.py`
generates this report from the completed command manifest and retained logs.
Its summary is `report written; all recorded summary lines included`.
Tool waits only collected the named running commands; they are not reruns.
The delivery-await check observed all 216 unchanged site IDs and await hashes;
no seal or classification artifact was regenerated. Stop after this report.
'''
(root/'REPORT.md').write_text(body)
print('report written; all recorded summary lines included')
