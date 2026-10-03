from pathlib import Path
import json,re
r=Path(__file__).resolve().parent
read=lambda n:json.loads((r/n).read_text())
rows=[]
for starter in ['plain','social']:
    cold=read(f'{starter}-cold.json');warm=read(f'{starter}-warm-summary.json')
    rows.append(f"| {starter} | {cold['durationMs']/1000:.3f} s | "+', '.join(f'{t/1000:.3f}' for t in warm['times'])+f" s | **{warm['medianMs']/1000:.3f} s** |")
summary=next(line for line in reversed((r/'full-suite.log').read_text().splitlines()) if line.startswith('== ') and ('failure' in line or 'passed' in line))
text='''

## Round 3 — honest-project correctness and verified crash cleanup (2026-10-02)

Input commit is `5d29493e1b`. Both round-2 reviews were **NOT READY**. The operator
keeps per-export evaluation and defines this cache as a correctness optimization
for **honest projects**, not a sandbox: a config plugin already runs arbitrary
code during prebuild. Deliberately hidden registration stacks and forged result
lines are outside this threat model. Evaluation now returns through a dedicated
parent-provided descriptor, independently of stdout or `beforeExit` logging.
This revision is not labeled reviewer-approved. Nothing is pushed or published.

### Findings and detecting controls

| Finding | Round-3 change and evidence |
|---|---|
| Different config/prebuild filesystem state | Every resolved project-local plugin retains application JS, even if its evaluated result omits a native value because `ios/` does not yet exist. Both starters' real builds with `plugins/x.js` read `src/native-mode.js` only after the template exists; source edits miss and change the installed `NXNativeMode` from first to second. |
| Every local path spelling | Expo's real resolver records the resolved plugin file independently of registration stacks. `./x.js`, `plugins/x.js`, bare project shadows and auto plugins are conservative; only audited files within `node_modules` can drop JS. Existing full-build refusals for unsupported dot-relative shapes remain. |
| Remote native resources | Static and evaluated URI resources refuse with `E_WITNESS_NATIVE_COMPAT`; HTTP, mixed-case HTTP, data and FTP controls detect this. Both installed starter wrappers refuse the remote-icon control before native build/proof. The bounded adapter conservatively refuses other URI-valued config too. |
| Image toolchain | Fingerprint and preparation both pin `EXPO_IMAGE_UTILS_NO_SHARP=1`; real config evaluation and preparation command-boundary controls detect removal of either pin. A global sharp-cli cannot select a different image implementation. |
| Late config.mods assignment | Check tracked identities again after `compileModsAsync`; both starters' real Expo introspection marks a mod assigned by an Info.plist callback as unobserved. |
| Preparation descendants | A persistent group leader gates worker start on a durable group/start-time journal, then remains alive after worker exit. Recovery verifies that anchor, repeatedly inspects/signals matching members and waits for full drain before removing output or allowing reuse. Missing/reused anchors with live members refuse. Units and both real wrapper controls drain TERM-resistant preparation children and verify heartbeat cessation. |
| Driver-only death | A wrapper hint no longer writes completion. Both genuine wrappers survive SIGKILL of only their driver; recovery stops the recorded backend/app, removes bulk output and writes completion only after cleanup. The next export succeeds. |
| Concurrent wrappers | Each run exports privately; Darwin's atomic directory exchange publishes complete `dist/` only after the result. On both starters A and B export distinct bundles; B refuses custody while A is paused, and A's loaded hash and visible dist hash equal A's private export. |
| Buffered simulator create | Reconcile the exact journaled creation name/runtime plus tool prefix against simctl's listing; prefix alone is insufficient. Both starters create a real tool-owned device through a boundary shim that buffers its UUID, then lose the driver to SIGKILL. The surviving wrapper stops the recorded create process, discovers and deletes that exact device despite empty stdout. A same-prefix unrecorded fake device is preserved by the separate driver control. |

`round3/config-controls.json`, `*-lifecycle-controls.json`, raw command logs,
compressed evidence and `final-source.json` bind these observations. The group
control substitutes only the preparation command with a resistant child; it does
not fabricate a native proof. The buffered-create shim calls real simctl create,
then withholds stdout. Stock config evaluation still runs in a fresh child on
every fingerprint (twice per warm export), using the actual Expo resolver and
deferred mod compilation. Stock writers and dependency snapshots remain audited;
[the dependency delta audit](round3/dependency-audit.md) records every changed
installed path and the two additional no-op/static stock plugin audits.

### Final measurements on this mini

| Starter | Cold command | Five warm commands, in order | Warm median |
|---|---:|---|---:|
'''+ '\n'.join(rows)+'''

All measurements are complete `npm run export:ios` wall times through proof,
atomic output publication and wrapper cleanup. Every warm run is a cache
hit with a distinct exact loaded export and all three smoke segments passing.
The declared cohort runs after controls and the complete suite drain; no sample
is discarded or substituted. Cold removes the native cache, snapshot, Pods and
DerivedData. Npm dependencies and Metro/system caches are already installed;
the cohort reuses an already booted, tool-owned simulator.
Only the six existing checksum-verified React Native/Hermes download archives
are seeded into the new private home before timing (download-seeds.json).
This avoids repeating the separately retained network failure; it does not reuse
a native build. A temporary command-scoped caffeinate assertion prevents idle
sleep during long batches; it changes no system setting and ends with the batch.

EVALUATION_DETAILS

### Verification and failures

The canonical `scripts/test.sh` ran **once** on the final implementation with
Node 24.18.0 and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Exact summary:

```
'''+summary+'''
```

FINAL_VERIFICATION_DETAILS

[Every development failure](round3/development-failures.md) is preserved and
classified: the old completion-hint fixture, a wrong-cwd command, the baseline
concurrent-namespace fixture's invalid UUID (fixed), an empty-PID-file timing
race under a noncanonical parallel test invocation, the Maven connection reset
and the harness's assumption that failed first export creates dist, and two
Xcode timeouts overlapping recorded host sleep. Corrected controls keep their
original failures and separate retry names. Expected crash/remote-icon/lease
refusals are negative controls, not successful native proofs. Runtime limits,
engine/contract sources, model counts and the wasm budget remain unchanged.

| Earlier failure or harness error | Classification and disposition |
|---|---|
| Retention fixture: 12 passed / 1 failed | **Ours.** Old fixture treated the wrapper hint as completion; changed it to a finalized receipt. Final affected checks pass 50/50. |
| First Rust unit command used the wrong redirection directory | **Ours.** Shell refused before Cargo started; corrected invocation passes 18/18. |
| Concurrent namespace fixture used `another-simulator` without ownership | **Baseline, fixed.** Reproduced under parallel and canonical serial threads; removed the invalid override and retained the contention assertions. Final integration passes 53/53. |
| Startup-timeout fixture read a newly created empty PID file | **Baseline race, exposed by our noncanonical parallel invocation.** Serial and final canonical runs pass; no assertion or guard changed. |
| Initial plain dependency download failed with curl 56 after 351.517 s in pods | **Environmental.** Maven reset the connection. Later runs preseed only verified download archives; final cold native caches remain empty. |
| Harness then tried to read missing dist after that failed first export | **Ours.** Failed exports correctly do not publish dist; runner now allows its absence and preserves the failure. |
| Plain ios-context-second and retry1 failed at 1,200.097 s and 974.101 s | **Environmental.** Recorded host sleep overlaps Xcode deadlines. Both attempts remain; a separately named retry passes. No deadline or persistent system setting changed. |
| Initial lifecycle harness changed PATH and caused rebuilds | **Ours.** Reuse the recorded PATH for final controls; keep the initial timings/logs. |
| Initial live-child shim had malformed nested Python quotes | **Ours.** Driver never started; retain the syntax error and empty unstarted directory. Corrected `-final` controls pass on both starters. |

FINAL_CUSTODY_DETAILS

LLP 3000.030 §15 and the witness guide carry the honest-project boundary and
new custody rules. One append-only journal entry records this round. The local
commit carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`; no push,
publication, physical-device or application-scenario claim is made.
'''
cost=[read(f'{s}-effective-cost.json')['medianMs'] for s in ['plain','social']]
text=text.replace('EVALUATION_DETAILS',f"Fresh-process effective-config evaluation medians are **{cost[0]:.3f} ms plain / {cost[1]:.3f} ms social per call**, after one warmup and five recorded samples each. Two calls per warm export cost approximately {cost[0]*2/1000:.3f} / {cost[1]*2/1000:.3f} s. Evaluation remains mandatory on every export.")
assert read('full-suite-status.json')['exitStatus']==0
text=text.replace('FINAL_VERIFICATION_DETAILS','''No failures in that final canonical run. Its client pool reports **5,761 passed,
zero failed/cancelled and five fixture skips**; final serial models pass **79/79**.
The round-2 mixed-evidence timeout does not recur: process 300/300 takes 184.562 s
and wasm 300/300 takes 165.045 s, with unchanged counts and guard. This pass does
not resolve the earlier intermittent failure's cause or close its existing ticket.
Canonical witness integration is **53/53**, guide **110/110**. Affected JavaScript
checks pass **50/50**, witness Rust units **18/18**, and the four-mode creation
integration and corrected namespace control each pass. Documentation budget and
reference checks pass. `full-suite-status.json` records one invocation.
Source, documentation and harness whitespace checks pass. A check including
verbatim command logs flags only their original trailing whitespace/blank EOF
lines; those raw bytes are intentionally preserved (`round3/diff-check.json`).

Wasm remains **2,014,420 B raw / 604,666 B gzip**, **559 B below** the unchanged
605,225 B cap; `wasm.json` records the actual artifact digest. No core/contract or
budget source changed.''')
retained=read('retained-evidence/summary.json');deleted=read('cleanup.json')['records']
text=text.replace('FINAL_CUSTODY_DETAILS',f"Archived and SHA-256-verified every retained file and {sum(s['receiptFiles'] for s in retained)} receipt files across {retained[0]['completedRuns']} plain / {retained[1]['completedRuns']} social completed runs. Each starter retains five full runs and at most twenty compressed runs, with zero temporary apps or preparation directories. The malformed development shim never started a driver; its directory contains only an empty run.lock and is recorded separately in retained-evidence/unstarted-runs.json, without inventing completion. Cleanup deleted {len(deleted)} exact journaled, ownership-verified devices under both leases; the two buffered-create devices had already been rolled back. All recorded round-3 devices are absent afterward. No unowned simulator (including mini-verify-iphone), system setting or unrelated process was touched. Generated candidates and ordinary native/dependency caches remain locally for review; per-run bulk artifacts are cleaned.")
p=r.parent/'REPORT.md';old=p.read_text();assert '\n## Round 3 ' not in old;p.write_text(old+text)
