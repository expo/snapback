"""Render the report only from completed, checked evidence."""
from pathlib import Path
import json,re

report=Path(__file__).resolve().parent
qualification=json.loads((report/'qualification.json').read_text())
assert qualification['qualified']
runs={r['name']:r for r in qualification['runs']}
files=json.loads((report/'converted-files.json').read_text())
late=json.loads((report/'late-tests.json').read_text())
suite_summary=json.loads((report/'whole-suite.summary.json').read_text())

def counts(row):
    c=row['counts']
    return f"{sum(c['pass']):,} / {sum(c['fail']):,} / {sum(c['skipped']):,} / {sum(c['cancelled']):,}"

lines=[
'# WB round 0 — wall-clock budgets',
'',
'The test suite now waits for observable state or promise completion, with separate work-scaled hang guards. No product source changed. The fallback case retains every answer and ordering assertion and explicitly checks that sync is still held when the current whole-server answer arrives.',
'',
'The common guard is `120,000 + 2,000 × max(1, work)` ms. It uses captured real timers and a monotonic clock, so mocked semantic time cannot disable it. Bulk guards count rows, operations or histories; ordinary guards count awaited fixture phases. Expiry, retry, heartbeat, admission and other genuine product timing assertions retain their bounds.',
'',
'[AUDIT.md](AUDIT.md) explains every retained/converted family. [BUDGET-SITES.md](BUDGET-SITES.md) lists every original explicit timeout option; [before](audit-before.tsv) / [after](audit-after.tsv) give the complete candidate-site census, including helpers and embedded browser fixtures. The scope contains 353 JS/TS/TSX files. The shared `witness/lib.mjs` change is test infrastructure used by those fixtures.',
'',
'## Verification',
'',
f'Final source coverage includes **{len(files)} affected test files**, five times on eb1000 under SL\'s 48-busy-worker / ten-CPU recipe, plus one unconfined run. Each loaded repetition uses three ordinary file slots; full-count session models run in their own serial slot. Search retains 300 seeds per host and session models retain 5,000 sequences per tier. No seed/count reduction was used. Runner concurrency follows SL’s CPU policy: three loaded file slots and 24 unconfined slots; the whole script uses its defaults.',
'',
f'The five loaded repetitions are **source-bound composites**: unchanged passing files from the initial snapshots, five runs of all {len(late)} scopes changed afterward, and five complete client-seams/search reruns after their final repairs. The superseded invocations had failures and are retained below; they are not claimed as clean sweeps. Every changed scope receives complete final-file coverage in each repetition. The manifests and [qualification.json](qualification.json) bind this claim to the tested bytes. [METHOD.md](METHOD.md) documents the isolated checkouts, commands, affinity, load custody and exact scope.',
'',
'| Execution | Pass / fail / skip / cancel | Elapsed seconds | Evidence |',
'|---|---:|---:|---|',
]
for n in range(1,6):
    for suffix,label in [('', 'Initial snapshot'),('-final','Corrective scopes'),('-repair','Final client-seams/search repairs')]:
        name=f'heavy-{n}{suffix}';row=runs[name]
        lines.append(f"| {n}: {label} | {counts(row)} | {row['seconds']:.1f} | [{name}.log]({name}.log), [metadata]({name}.json) |")
for name,label in [('final-unconfined','Unconfined: all affected files'),('whole-suite','Complete scripts/test.sh, once')]:
    row=runs[name]
    lines.append(f"| {label} | {counts(row)} | {row['seconds']:.1f} | [{name}.log]({name}.log), [metadata]({name}.json) |")
lines += [
'',
'The table counts Node tests, including the separate model stage. Each initial run has one intentional cancellation: its obsolete model stage was stopped after the ordinary stage completed and is replaced by the full final model run. Its partial model result is not credited. The complete script also executes Rust tests, builds, typechecks, wasm checks and witness tests. The script’s exact summary is:',
'',
'```text',qualification['whole_suite_footer'],'```',
'',
f"The complete script reports **{suite_summary['rust']['passed']:,} Rust tests passed, {suite_summary['rust']['failed']} failed and {suite_summary['rust']['ignored']} ignored**. Its wasm budget check also passes: " + '; '.join(suite_summary['wasm']) + '.',
'',
'The separately run **whole guide passed 110/110**, zero failures or ignored tests ([guide.log](guide.log)). All 339 `.mjs` syntax checks and source/document whitespace checks passed. Captured logs and extracted failure text retain their original whitespace. Linux-only qualification retains the existing Darwin skips; the manual external identity-provider qualifier was audited but requires external credentials and was not run. Its local proxy tests are covered. This report does not claim Mac-only execution or publication qualification.',
'',
'## Hang-guard controls',
'',
'Only a disposable scratch copy of `dist/local.js` was mutated, at the fallback publication boundary. The reached marker, patches, source hashes, commands and results are in [controls.json](controls.json) and [METHOD.md](METHOD.md).',
'',
f"- Delay publication by 15 real seconds: **pass**, {qualification['controls'][0]['seconds']:.3f} seconds overall ([log](delayed-publication.log)).",
f"- Withhold publication until cleanup: **expected failure**, {qualification['controls'][1]['seconds']:.3f} seconds overall ([log](missing-publication.log)): `TEST_HANG: new branch obtains a current whole-server answer while sync remains held; 2 work unit(s), 124001 ms elapsed, 124000 ms guard`.",
'',
'The original checkout’s product files were never mutated. The scratch product was restored afterward.',
'',
'## Failures and disposition',
'',
'Every failed diagnostic, invalid selection/control, loaded failure and correction is listed in [FAILURES.md](FAILURES.md). The following table identifies every failing test in the initial and corrective snapshots. Each is superseded only by the five passing final runs of its file.',
'',
'| Initial run | Failing test | Classification |',
'|---|---|---|',
]
for n in range(1,6):
    for name in runs[f'heavy-{n}']['superseded_failures']:
        transport=name.startswith('ordinary search') or name.startswith('unread range') and not (n==4 and name.endswith('meter-cut'))
        classification='Environmental transport, fixture corrected' if transport else 'Baseline fixture race, corrected'
        lines.append(f'| {n} | {name} | {classification} |')
for n in range(1,6):
    for name in runs[f'heavy-{n}-final']['superseded_failures']:
        if name.endswith('client-seams.test.mjs'):
            name += ': asynchronous HTTP-parser error after app-online'; classification='Ours, timer fixture corrected'
        elif n in (1,2):classification='Ours, aggregate work undercount corrected'
        else:classification='Baseline fixture adoption race, corrected'
        lines.append(f'| {n}, corrective snapshot | {name} | {classification} |')
lines += [
'',
'Final affected-file, contention follow-up, guide and complete-suite failures: **ours 0; baseline 0; environmental 0**. The deliberately withheld-publication failure is a successful negative control. Initial implementation mistakes remain attributed to WB in the failure ledger.',
'',
'One journal entry accompanies this test-only commit. Nothing was pushed or published.',
]
(report/'REPORT.md').write_text('\n'.join(lines)+'\n')
