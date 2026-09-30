from pathlib import Path
import re, json, gzip
root=Path(__file__).resolve().parents[1]
records=[]
for p in sorted([*root.glob('*.log'), *root.glob('*.log.gz')]):
    name=p.name.removesuffix('.gz')
    source=(gzip.decompress(p.read_bytes()).decode(errors='replace') if p.suffix == '.gz' else p.read_text(errors='replace')).split('✖ failing tests:')[0]
    failures=re.findall(r'^✖ (.+?) \([\d.]+ms\)$',source,re.M)
    if not failures: continue
    baseline=name.startswith('round0-controls')
    records.append({'run':name,'classification':'ours — negative-control compatibility error, corrected in final control' if name == 'round0-controls-new-mount.log' else 'baseline — deliberate round 0 negative control' if baseline else 'ours — expected rejection of deliberate stale-reply mutation' if name == 'assertion-round1.log' else 'ours','failures':failures})
(root/'FAILURES.json').write_text(json.dumps(records,indent=2)+'\n')
lines=['# Failure ledger','', 'The final qualification is reported separately in REPORT.md. These are all failed development checks and detecting controls, preserved rather than relabelled. No test failure was attributed to environment.','',
'Build/setup failures:','',
'- **Ours:** the first Rust build returned E0271: the new iterator supplied `&String` where `&str` was required. Corrected before device tests.',
'- **Ours:** the first wasm build exceeded 593,719 B by 1,721 B. The required audience dependency metadata measured 595,440 B; the cap and rationale are updated in this commit.',
'- **Environmental setup:** `python` was absent; the installed `python3` ran the edit script. No test was skipped.',
'- **Ours, setup:** a line-compaction edit script could loop after exhausting blank lines. It was stopped before writing local.ts; the edit was applied correctly with python3. No test ran on partial local.ts bytes.','',
'Development test corrections: invalid `select` syntax in the new fixture (six cases); a mistaken `connection()` spelling (two cases); opt-in inspection needed to seed queue timing at opt-in (one case); two existing online expectations needed the requested queue-inclusive bound; and the new offline-before-commit test initially sampled before its injected asynchronous commit and included legal pre-removal offline publications (two cases). Each was corrected with the withdrawal requirement intact.','']
for item in records:
    lines += [f"## {item['run']} — {item['classification']}", '']
    lines += ['- '+name for name in item['failures']]
    lines += ['']
(root/'FAILURES.md').write_text('\n'.join(lines))
