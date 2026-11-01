from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess

R = Path('/home/ccheever/sb4-pub-0452-records')
W = Path('/home/ccheever/sb4-records-0452')
PUB = Path('/home/ccheever/sb4-pub-0441')
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
commit = (R / 'records-commit.sha').read_text().strip()
base = (R / 'records-affected-base.sha').read_text().strip()
source = (Path('/home/ccheever/sb4-pub-0452-kit') / 'source.sha').read_text().strip()
assert (R / 'records-affected.exit').read_text().strip() == '0'
paths = sorted((W / 'target/affected').glob(commit[:12] + '-*.json'), key=lambda p: p.stat().st_mtime)
assert paths
p = paths[-1]
raw = p.read_bytes()
d = json.loads(raw)
assert d['head'] == commit and d['base'] == base
assert d['complete'] is True and d['unchanged'] is True and d['ok'] is True
assert len(d['steps']) == len(d['results']) == 31
assert [s['id'] for s in d['steps']] == [s['id'] for s in d['results']]
assert all(s['status'] == 0 and s.get('signal') is None for s in d['results'])
log = (R / 'records-affected.log').read_text()
client_log = log.split('\n== client-tests\n', 1)[1].split('\n== chat-check\n', 1)[0]
summaries = re.findall(r'^-- client files: (\d+)/(\d+); failed (\d+); tests (\{[^\n]+\})$', client_log, re.M)
assert len(summaries) == 2
client_summary, model_summary = [json.loads(s[3]) for s in summaries]
assert summaries[0][:3] == ('487', '487', '0')
assert summaries[1][:3] == ('2', '2', '0')
assert client_summary['pass'] == 8633 and client_summary['skipped'] == 57
assert model_summary['tests'] == model_summary['pass'] == 89
assert all(s['fail'] == s['cancelled'] == 0 for s in [client_summary, model_summary])
campaigns = []
for step in [s for s in d['results'] if s['id'].startswith('difftest:')]:
    label = step['id'].split(':', 1)[1]
    report_path = W / 'snapback4/target/affected' / ('difftest-' + label) / 'report.json'
    report_raw = report_path.read_bytes()
    digest = hashlib.sha256(report_raw).hexdigest()
    if step.get('executedStatus', 0):
        classification = step['leanClassification']
        assert step['executedStatus'] == 1 and classification['ok'] is True
        assert classification['unclassified'] == []
        assert classification['reportSha256'] == digest
    dest = R / ('records-final-difftest-' + label + '.json')
    if dest.exists():
        assert dest.read_bytes() == report_raw
    else:
        dest.write_bytes(report_raw)
    campaigns.append(dict(id=step['id'], report=str(dest), sha256=digest,
                          status=step['status'], executedStatus=step.get('executedStatus', step['status']),
                          classification=step.get('leanClassification')))
for name in ['records-inventories.exit', 'records-ref-check.exit']:
    assert (R / name).read_text().strip() == '0'
assert subprocess.check_output(['git', '-C', str(W), 'rev-parse', 'HEAD'], text=True).strip() == commit
assert subprocess.check_output(['git', '-C', str(W), 'status', '--porcelain'], text=True).strip() == ''
saved = R / 'records-final-affected-receipt.json'
if saved.exists():
    assert saved.read_bytes() == raw
else:
    saved.write_bytes(raw)

env = dict(os.environ)
env['npm_config_cache'] = str(R / 'final-registry-recheck-cache')
views = []
for package in ['snapback4', 'snapback4-darwin-arm64', 'snapback4-linux-x64', 'snapback4-expo']:
    values = {}
    for key, spec, field in [('version', package + '@0.4.52', 'version'), ('latest', package, 'dist-tags.latest')]:
        run = subprocess.run(['npm', 'view', spec, field, '--json'], cwd=W, env=env, capture_output=True, text=True, timeout=120)
        (R / ('final-registry-recheck-' + package + '-' + key + '.stderr')).write_text(run.stderr)
        assert run.returncode == 0, 'npm view failed for ' + package + '/' + key
        values[key] = json.loads(run.stdout)
    assert values['version'] == '0.4.52'
    assert values['latest'] == '0.4.52', 'Latest moved; preserve evidence and inspect before finalizing'
    views.append(dict(package=package, **values))
registry = dict(verifiedAt=now(), source=source, recordsCommit=commit, npmViews=views)
(R / 'final-registry-recheck.json').write_text(json.dumps(registry, indent=2) + '\n')

fetch = subprocess.run(['git', '-C', str(W), 'fetch', 'origin', 'main'], capture_output=True, text=True, timeout=180)
(R / 'final-records-fetch.log').write_text(fetch.stdout + fetch.stderr)
assert fetch.returncode == 0
assert subprocess.run(['git', '-C', str(W), 'merge-base', '--is-ancestor', commit, 'origin/main']).returncode == 0
origin = subprocess.check_output(['git', '-C', str(W), 'rev-parse', 'origin/main'], text=True).strip()
assert subprocess.check_output(['git', '-C', str(W), 'rev-parse', 'HEAD'], text=True).strip() == commit
assert subprocess.check_output(['git', '-C', str(W), 'status', '--porcelain'], text=True).strip() == ''
proof = dict(verifiedAt=now(), source=source, recordsCommit=commit, recordsParent=base, originMain=origin,
             receipt=str(saved), receiptSha256=hashlib.sha256(raw).hexdigest(),
             started=d['started'], finished=d['finished'], complete=True, unchanged=True, ok=True,
             checks=len(d['results']), rawExit=0, clientSummary=client_summary,
             modelSummary=model_summary, campaigns=campaigns, results=d['results'])
(R / 'records-final-check-validation.json').write_text(json.dumps(proof, indent=2) + '\n')

report = PUB / 'WORKSTREAM-REPORT.md'
text = report.read_text()
marker = '## Final records check\n'
assert marker in text
text = text.split(marker, 1)[0] + marker + '\n'
text += ('The exact pushed records commit passed all31/31 affected checks with raw overall exit0, '
         'complete=true, unchanged=true and ok=true, against its immutable parent. All seven Rust '
         'crates,487 ordinary client files,89 model nodes, documentation/generated/inventory/ref checks '
         'and both2k differential campaigns passed. The selector retains any classified Lean raw '
         'findings under its existing strict policy. Standalone inventory and ref checks also passed. '
         'Receipt: ' + str(saved) + '; SHA256 ' + proof['receiptSha256'] + '.\n\n')
text += ('Final fresh npm views at ' + registry['verifiedAt'] + ': all four packages have version '
         'and latest0.4.52. Records commit `' + commit + '` is confirmed on origin/main. '
         'No final check is pending. Final evidence is external to the frozen records commit to '
         'avoid a self-referential receipt/commit cycle.\n')
report.write_text(text)
shutil.copyfile(report, R / 'WORKSTREAM-REPORT.md')
state_path = R / 'controller-state.json'
state = json.loads(state_path.read_text())
state.update(updatedAt=now(), phase='complete', pending=[], activeUnit=None, activeLog=None,
             next='Complete: PUBLISHED 0.4.52; no remaining publication work.',
             finalRecordsAffected=proof, finalRegistryRecheck=registry,
             finish='PASS all8 steps; all4 published and registry verified')
state.setdefault('completed', []).append('Exact pushed records final affected31/31 raw0; final views and on-main ancestry verified')
state_path.write_text(json.dumps(state, indent=2) + '\n')
entry = ('PUBLISHED 0.4.52 — npm view: ' + '; '.join(v['package'] + ' version=' + v['version'] + ' latest=' + v['latest'] for v in views)
         + '. Publication source ' + source + '; records commit ' + commit
         + ' is on origin/main. Final exact-records affected31/31 raw0 complete/unchanged/ok, standalone inventory/ref0; '
         'both-host audit/staged smoke/registry smoke and exact registry byte verification PASS. '
         'WORKSTREAM-REPORT.md finalized. Sole deferral: issues/20261101-social-quote-jump-async-browser-polling.md.')
with (R / 'STATUS.md').open('a') as f:
    f.write('- ' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + ' ' + entry + '\n')
print(json.dumps(dict(status='PUBLISHED 0.4.52', recordsCommit=commit, source=source, checks=31, npmViews=views), indent=2))
