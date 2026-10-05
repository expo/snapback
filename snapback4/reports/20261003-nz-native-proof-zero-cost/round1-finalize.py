"""Bind final logs and verify only this lane's recorded measurement devices."""
import hashlib, json, pathlib, subprocess, time
from round1 import ROOT, WORK, OUT, BINARY, write
from measure import retain, ARCHIVE

rows = [json.loads(p.read_text()) for p in OUT.glob('r1-export-*.json') if not p.name.endswith('-cleanup.json')]
cohort = rows + [json.loads(p.read_text()) for p in OUT.glob('r1-interference-*.json') if not p.name.endswith('-cleanup.json')]
owned = {}
for row in cohort:
    folder = pathlib.Path(row.get('artifacts') or row.get('smoke') or '/nonexistent')
    receipt = folder/'smoke-ios-run.json'
    simulator = row.get('simulator')
    if not simulator and receipt.exists(): simulator = json.loads(receipt.read_text()).get('simulator')
    # Earlier retained full runs can be compressed by ordinary pruning. Their
    # receipt already lives in the content-addressed evidence archive.
    if not simulator:
        from measure import ARCHIVE
        source = next((e for e in row['evidence'] if e['path'].endswith('/smoke-ios-run.json')),None)
        if source: simulator = json.loads((ARCHIVE/source['sha256']).read_text()).get('simulator')
    if simulator:
        assert simulator['prefix']=='sb4-nz-' and simulator['selection']=='created'
        owned[simulator['udid']] = simulator
devices = json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))['devices']
present = {d['udid']: d for ds in devices.values() for d in ds}
checks = [dict(simulator=s, absent=udid not in present) for udid,s in sorted(owned.items())]
write(OUT/'device-verification.json',dict(at=time.time(), checks=checks, allAbsent=all(c['absent'] for c in checks)))
assert checks and all(c['absent'] for c in checks), 'an owned recorded device still needs cleanup; never select others'

commands = subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True)
our_jobs = [line for line in commands.splitlines() if str(BINARY) in line and ' witness ' in line]
write(OUT/'process-verification.json',dict(at=time.time(), remainingCandidateWitnessJobs=our_jobs))
assert not our_jobs, 'own witness custody has not drained'

groups = {}
for row in cohort:
    for artifact in row['evidence']:
        if artifact['path'].endswith('-group.json'):
            group = json.loads((ARCHIVE/artifact['sha256']).read_text())
            groups[group['group']] = group
members = []
for line in subprocess.check_output(['ps', '-axo', 'pid,pgid,comm'], text=True).splitlines()[1:]:
    fields = line.split(None, 2)
    if len(fields) == 3 and int(fields[1]) in groups: members.append(line)
write(OUT/'group-verification.json', dict(at=time.time(), recordedGroups=list(groups.values()), remainingMembers=members))
# Read-only audit. If a numeric ID has been reused, inspect birth identity;
# never signal a process merely because it matches a recorded group number.
assert groups and not members, 'recorded group number is occupied; inspect identity before any cleanup'

logs = sorted(pathlib.Path('/tmp').glob('sb4-nz-r1-*.log'))
logs += [WORK/'candidate-r1-production', ROOT/'target/debug/snapback4']
index = [retain(p) for p in logs if p.is_file()]
write(OUT/'verification-evidence.json', index)
bindings = json.loads((OUT/'source-manifest.json').read_text())
amendment = json.loads((OUT/'post-measurement-doc-fix.json').read_text())
amended = {r['path']: r for r in amendment['changes']}
assert set(amended) == {'snapback4/crates/snapback4-lang/src/guide/witness.md', 'snapback4/crates/snapback4-lang/tests/guide/published.rs'}
for row in bindings:
    expected = row['sha256']
    if row['path'] in amended:
        assert amended[row['path']]['beforeSha256'] == expected
        expected = amended[row['path']]['afterSha256']
    assert hashlib.sha256((ROOT.parent/row['path']).read_bytes()).hexdigest()==expected, row['path']+' changed after measurement freeze'
for row in amended.values():
    assert hashlib.sha256((ROOT.parent/row['path']).read_bytes()).hexdigest()==row['afterSha256']
for p in OUT.parent.rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts:
        assert p.stat().st_size <= 256*1024 and p.suffix not in ['.gz','.mp4'], str(p)
print(f'Verified {len(checks)} owned devices absent; {len(groups)} recorded groups empty; candidate witness processes drained; {len(index)} verification artifacts retained.')
