from pathlib import Path
import re, json, gzip

root = Path(__file__).resolve().parent
records = []
for p in sorted([*root.glob('*.log'), *root.glob('*.log.gz')]):
    name = p.name.removesuffix('.gz')
    text = gzip.decompress(p.read_bytes()).decode(errors='replace') if p.suffix == '.gz' else p.read_text(errors='replace')
    names = re.findall(r'^✖ (.+?) \([\d.]+ms\)$', text, re.M)
    names += re.findall(r'^test (.+?) \.\.\. FAILED$', text, re.M)
    for failure in dict.fromkeys(names):
        if name in ['before.log', 'main-remount-final.log'] or name.startswith('round1-negative'):
            classification = 'baseline — deliberate pre-fix detecting control'
        elif name == 'approval-control.log':
            classification = 'ours — deliberate single-fence revert; expected stale-approval rejection'
        elif name == 'server-affected.log':
            classification = 'environmental — wall-clock attribution under concurrent load; isolated rerun passed'
        elif name == 'affected.log' and failure.startswith('wasm: 1,000'):
            classification = 'ours — contaminated development run; SDK rebuild overlapped browser acquisition; isolated final run passed'
        elif name == 'main-remount-corrected.log':
            classification = 'ours — invalid control build parsed .ts as TSX; corrected before main conclusion'
        elif name == 'full-suite.log' and failure.startswith("closed facade follows same identity's revalidation"):
            classification = 'ours — old cross-handle object-alias assertion conflicts with independent closed deadline; replaced by answer identity, equal facts and per-handle stability, 54 affected tests pass'
        elif name == 'full-suite.log' and 'resubscribing a raw local handle' in failure:
            classification = 'ours — existing assertion explicitly expected revoked rows until the episode deadline; updated to immediate pre-resubscription withdrawal and no stale callback'
        elif name == 'corrected-affected.log':
            classification = 'ours — new assertion expected a loading notification before the subscriber was attached; final assertions prove immediate withdrawal and later authorized replacement delivery'
        elif name == 'closed-metadata-before.log':
            classification = 'ours — frozen deadline copy missed same-identity existence metadata; source-object tracking fixes it'
        elif name == 'focused-qualified.log':
            classification = 'ours — introduced recursive close notification; stable refusal-code comparison fixes it'
        elif name.startswith('guide'):
            classification = 'ours — client guide linked an unshipped reference; changed to packaged relative reference'
        elif name in ['affected.log', 'focused-final.log']:
            classification = 'ours — unfinished dormant-refusal fix still reset the refusal to loading in scheduleRead'
        else:
            classification = 'UNCLASSIFIED — inspect before finalizing'
        records.append({'run': name, 'test': failure, 'classification': classification})

(root / 'FAILURES.json').write_text(json.dumps(records, indent=2) + '\n')
lines = ['# Failure ledger', '',
    'Final qualification is in REPORT.md. This ledger includes development failures and intentional detecting controls. Logs are retained as gzip files with the original names below.', '',
    '## Setup and measurement failures', '',
    '- **Ours:** the first main SDK control used a repository-relative path from the Snapback 4 subdirectory and selected no source files. Its four apparent passes in `main-remount.log` used copied current bytes and are invalid. The helper now requires a nonempty source inventory containing local.ts.',
    '- **Ours:** the next main build omitted TypeScript file names and interpreted generics as TSX. `main-remount-corrected.log` is an invalid control, not behavioral evidence. The final main control transpiles every original path correctly and fails all four revocation assertions.',
    '- **Ours:** initial guide text linked a GitHub source file outside the package; the published-reference test rejected it twice. The relative packaged reference passes the whole guide.',
    '- **Ours:** live SDK rebuilds overlapped one LL rerun. `ll-verified-process-0.log` ends with `page.evaluate: Execution context was destroyed, most likely because of a navigation`. The process/3 cell was not run; this partial matrix is excluded from successful-trial claims. Later matrices run without modifying the SDK.',
    '- **Ours:** incidental commands used an extra `snapback4/` prefix while already in that directory, looked for a summary before generating it, used a stale patch context, or initially treated flat pressure samples as nested totals. Corrected paths were used; these inspection/setup errors supplied no test evidence.',
    '- **Ours:** ref-check was once invoked from snapback4 instead of the repository root and reported zero LLP documents / 1,289 missing refs. `ref-check-wrong-cwd.log` preserves that invocation error. The root invocation passes.',
    '- **Environmental:** the affected native `/changes` timing test measured total 1000.269 ms, engine 449.281 ms, wait 13.315 ms, CPU 55.831 ms; it expected at least 600 ms outside engine/wait. This unchanged route/test passed alone in 1.02 s and in the full suite. The failure occurred while wasm compilation and affected tests were also running. This is a timing-contention inference supported by the isolated rerun, not a reproduced baseline product failure.', '',
    '## Failed tests by run', '']
for name in dict.fromkeys(record['run'] for record in records):
    lines += [f'### {name}', '']
    lines += [f"- **{record['classification']}** — {record['test']}" for record in records if record['run'] == name]
    lines += ['']
(root / 'FAILURES.md').write_text('\n'.join(lines))
print(len(records), 'failed test occurrences recorded')
