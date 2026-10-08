#!/usr/bin/env python3
"""Reconstruct the supplied snapshot and compare code, without accessing its host."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

os.umask(0o077)
here = Path(__file__).resolve().parent
repo = here.parents[2]
out = here / 'evidence'
archive = out / 'em-r7-mac-run2.tar.gz'
prefix = 'sb4-em-evidence/maintenance-cfef6bd701aa7c2f/snapshot-1791419664460053000-4757c24f-failure-test-guard/'
with tarfile.open(archive) as tar:
    def data(name):
        return tar.extractfile(prefix + name).read()
    meta = json.loads(data('snapshot.json'))
    trace = []
    for line in data('files/retention-trace.jsonl').splitlines():
        try:
            trace.append(json.loads(line))
        except ValueError:
            pass  # The bounded tail starts inside a line, after its marker.
    selected = [e for e in trace if e['at'] >= 1791419579959 and e['step'] not in ('observer-wakeup', 'wait-run')]
    summary = dict(archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
                   snapshot=prefix, at=meta['at'], limits=meta['limits'],
                   capturedFiles=meta['capturedFiles'], entriesVisited=meta['entriesVisited'],
                   processes=json.loads(data('processes.json')),
                   testDrain=[json.loads(v) for v in data('test-drain.jsonl').splitlines()],
                   timeline=selected, traceSilenceSeconds=meta['at'] - trace[-1]['at'] / 1000,
                   queue={n:json.loads(data('files/'+n)) for n in ['maintenance-next.json','maintenance-active.json','maintenance-claimed.json']},
                   omittedCustody=[f for f in meta['files'] if f.get('omitted') and
                     (f['path'].startswith('.retention-') or f['path'].startswith('1791419554794-5500/'))])
    (out / 'snapshot-analysis.json').write_text(json.dumps(summary, indent=2)+'\n')

source = 'snapback4/crates/snapback4/src/verbs/witness/'
revisions = ['2797247960', '9337691bee', 'affcd4919b']
def git_file(rev, file):
    return subprocess.check_output(['git','show',f'{rev}:{file}'],cwd=repo)
def fragment(data, start, end):
    return data.split(start.encode(),1)[1].split(end.encode(),1)[0]
checks = {}
for file in ['recovery.rs', 'preparation.rs', 'process_group.rs']:
    checks[file] = {r:hashlib.sha256(git_file(r,source+file)).hexdigest() for r in revisions}
for label, file, start, end in [
    ('run_with_budget','retention.rs','fn run_with_budget(', '// Internal entry'),
    ('real_darwin_sleep_clock','background.rs','    #[cfg(target_os = "macos")]\n    unsafe {\n        unsafe extern "C" { fn mach_continuous_time()', '\npub(super) fn driver('),
    ('post_driver_retention','background.rs','fn defer_retention(', '// Unlike wall time'),
]:
    checks[label] = {r:hashlib.sha256(fragment(git_file(r,source+file),start,end)).hexdigest() for r in revisions}
checks['export-background.test.mjs'] = {r:hashlib.sha256(git_file(r,'snapback4/packages/snapback4/test/export-background.test.mjs')).hexdigest() for r in revisions}
(out / 'source-provenance.json').write_text(json.dumps(checks, indent=2)+'\n')
print(json.dumps(dict(snapshot=prefix, capturedFiles=meta['capturedFiles'], traceSilenceSeconds=summary['traceSilenceSeconds'],
                     equalAcrossAllRevisions={k:len(set(v.values()))==1 for k,v in checks.items()})))
