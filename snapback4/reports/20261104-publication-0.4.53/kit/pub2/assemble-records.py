#!/usr/bin/env python3
"""PUB053 records assembly. Originals remain in the external kit and on Linux."""
import datetime, gzip, hashlib, json, pathlib, shutil, subprocess

root = pathlib.Path('/Users/ccheever/sb4-pub-0453-wt')
kit = pathlib.Path('/Users/ccheever/sb4-pub-0453')
work = kit/'pub2'
report = root/'snapback4/reports/20261104-publication-0.4.53'
blocked = {'node_modules', '.npm', '.npmrc', '.harness-env.json', '.git',
           'dist', 'target', '.snapback4', '.expo', '__pycache__', 'wave21-diagnostic-platform'}
code = {'.sh', '.py', '.mjs'}
allowed = code | {'.md', '.txt', '.json', '.jsonl', '.log', '.exit', '.out', '.diff',
    '.sha256', '.gz', '.bundle', '.q', '.sha', '.patch-id', '.ts', '.tsx', '.js', '.cjs',
    '.mts', '.html', '.css', '.svg', '.lock', '.stderr', '.stdout'}

def safe(p, relative):
    return not p.is_symlink() and not any(x in blocked or x.startswith(('.env', 'npm-cache')) for x in relative.parts)

def copy_file(p, q):
    q.parent.mkdir(parents=True, exist_ok=True)
    if p.suffix == '.log' and p.stat().st_size > 200_000:
        with p.open('rb') as source, gzip.GzipFile(str(q)+'.gz', 'wb', compresslevel=9, mtime=0) as dest:
            shutil.copyfileobj(source, dest)
    else:
        shutil.copy2(p, q)

def copy_tree(src, dest, suffixes=allowed):
    for p in sorted(src.rglob('*')):
        rel = p.relative_to(src)
        if p.is_file() and safe(p, rel) and (p.suffix in suffixes or p.name in {'exits.txt', '.gitignore'}):
            copy_file(p, dest/rel)

# Preserve the lane's broad pre-publication snapshot before selecting durable records.
original = work/'linux-snapshot-before-curation'
assert not original.exists(), original
shutil.move(report/'linux', original)
linux = report/'linux'
for name in ['records', 'archives']:
    copy_tree(original/name, linux/name)
copy_tree(original/'kit', linux/'kit', code)
# The prior publication records retain top-level qualification objects and logs.
for p in sorted((original/'qualification').iterdir()):
    if p.is_file() and p.suffix in {'.json', '.log', '.gz'}:
        copy_file(p, linux/p.name)
copy_tree(work/'registry-linux', linux/'registry')
copy_tree(work/'smoke-registry-linux', linux/'smoke-registry')
copy_tree(work/'smoke-staged-linux', linux/'smoke-staged')
for name in ['verify-registry.py', 'expected-artifacts.json']:
    copy_file(work/name, linux/name)

# Runnable inputs only in kit; execution receipts and output go in release-evidence.
for p in sorted(kit.iterdir()):
    if p.is_file() and p.suffix in code:
        copy_file(p, report/'kit'/p.name)
    elif p.is_file() and p.suffix in allowed:
        copy_file(p, report/'release-evidence'/p.name)
for name in ['helpers-0.4.53', 'linux-kit']:
    copy_tree(kit/name, report/'kit'/name, code)
for p in sorted(work.iterdir()):
    if p.is_file() and p.suffix in code:
        copy_file(p, report/'kit'/'pub2'/p.name)
    elif p.is_file() and p.suffix in allowed:
        copy_file(p, report/'release-evidence'/'pub2'/p.name)
copy_tree(kit/'release-evidence', report/'release-evidence')
copy_tree(kit/'fixtures', report/'release-evidence'/'fixtures')
copy_tree(kit/'archive-before-wave21-recovery', report/'release-evidence'/'archive-before-wave21-recovery')
copy_tree(kit/'preflight-release', report/'release-evidence'/'preflight-release', {'.json', '.log', '.exit', '.diff', '.out'})
for p in sorted((kit/'isolated').iterdir()):
    if p.name.startswith('audit-'):
        copy_tree(p, report/'audits'/p.name)
    else:
        copy_tree(p, report/'release-evidence'/'isolated'/p.name)
for name in ['audit-linux-early', 'audit-linux-early-attempt2']:
    copy_tree(original/'records'/name, report/'audits'/name)
copy_file(kit/'audit-fast.mjs', report/'audits'/'audit-fast.mjs')
copy_tree(work/'registry-mac', report/'release-evidence'/'registry-mac')
copy_tree(work/'smoke-registry-mac', report/'release-evidence'/'smoke-registry-mac')
copy_file(pathlib.Path('/Users/ccheever/projects/snapback-chat-exact-program/lane-pub/REPORT.md'), report/'release-evidence'/'PUB-qualification-REPORT.md')
for p in (kit/'release-evidence').glob('frozen-*'):
    copy_file(p, report/'source'/p.name)
for name in ['prepare.json']:
    copy_file(root/'snapback4/target/publication/client-0.4.53'/name, report/'source'/name)
copy_file(root/'snapback4/target/publication/snapback4-darwin-arm64-0.4.53/resume.json', report/'source'/'resume.json')

# Fill the supervisor's empty artifact list without misdating the later verification.
p = kit/'linux-prefinish-green.json'
before = p.read_bytes()
copy_file(p, report/'release-evidence'/'linux-prefinish-green.original.json')
record = json.loads(before)
verified = json.loads((work/'registry-linux/registry-verified.json').read_text())
record['artifacts'] = verified['artifacts']
record['artifactsCompletedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
record['artifactsEvidence'] = '../linux/registry/registry-verified.json'
record['artifactsNote'] = 'Post-publication completion from fresh Linux registry downloads and qualified hashes; original prefinish receipt retained separately.'
p.write_text(json.dumps(record, indent=2)+'\n')
copy_file(p, report/'release-evidence'/p.name)

# Both metric appends are preserved exactly; witness additions come from the saved diff.
metric = root/'snapback4/metrics/publish.jsonl'
base = subprocess.check_output(['git', 'show', 'HEAD:snapback4/metrics/publish.jsonl'], cwd=root)
now = metric.read_bytes()
assert now.startswith(base)
publish = [json.loads(line) for line in now[len(base):].splitlines()]
assert len(publish) == 2 and [r['dry'] for r in publish] == [True, False]
assert all(r['version'] == '0.4.53' for r in publish)
(work/'publish-0453-rows.jsonl').write_bytes(now[len(base):])
added = [line[1:] for line in (kit/'witness.jsonl.native-0453.diff').read_text().splitlines() if line.startswith('+{')]
assert len(added) == 2
witness = root/'snapback4/metrics/witness.jsonl'
with witness.open('a') as f:
    for line in added:
        assert line not in witness.read_text()
        json.loads(line)
        f.write(line+'\n')
for p in list(report.glob('*.log')):
    if p.stat().st_size > 200_000:
        copy_file(p, work/'original-attempt-logs'/p.name)
        with p.open('rb') as source, gzip.GzipFile(str(p)+'.gz', 'wb', compresslevel=9, mtime=0) as dest:
            shutil.copyfileobj(source, dest)
        p.unlink()
print('ASSEMBLE RECORDS PASS: preserved 2 publication rows; restored 2 native witness rows; curated Linux/Mac evidence')
