"""Read-only integration evidence binding and owned-device/process audit."""
import hashlib, json, pathlib, subprocess, time
from measure import ROOT, WORK, REPORT, ARCHIVE, retain
from round1 import write

OUT = REPORT/'round2'
BINARY = WORK/'candidate-r2-debug'
rows = [json.loads(p.read_text()) for p in sorted(OUT.glob('r2-*.json')) if not p.name.endswith('-cleanup.json')]
assert len(rows)==5 and sum(r['phase']=='warm' and r['waitStatus']==0 and r['cache']['hit'] for r in rows)==2
owned = {}
groups = {}
for row in rows:
    s=row['simulator']; assert s['prefix']=='sb4-nz-' and s['selection']=='created'
    owned[s['udid']]=s
    for artifact in row['evidence']:
        if artifact['path'].endswith('-group.json'):
            group=json.loads((ARCHIVE/artifact['sha256']).read_text()); groups[group['group']]=group
all_devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))['devices']
present={d['udid'] for ds in all_devices.values() for d in ds}
checks=[dict(simulator=s,absent=udid not in present) for udid,s in sorted(owned.items())]
write(OUT/'device-verification.json',dict(at=time.time(),checks=checks,allAbsent=all(c['absent'] for c in checks)))
assert all(c['absent'] for c in checks), 'recorded device remains; inspect exact custody before cleanup'
commands=subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True)
jobs=[]
for line in commands.splitlines()[1:]:
    fields=line.split(None,2)
    if len(fields)==3 and any(fields[2].startswith(str(binary)+' ') for binary in [BINARY,ROOT/'target/debug/snapback4']):
        jobs.append(line)
write(OUT/'process-verification.json',dict(at=time.time(),remainingLaneCliJobs=jobs)); assert not jobs
members=[]
for line in subprocess.check_output(['ps','-axo','pid,pgid,comm'],text=True).splitlines()[1:]:
    fields=line.split(None,2)
    if len(fields)==3 and int(fields[1]) in groups: members.append(line)
write(OUT/'group-verification.json',dict(at=time.time(),recordedGroups=list(groups.values()),remainingMembers=members))
assert groups and not members, 'numeric group occupied; inspect birth identity, never signal merely by ID'
for row in json.loads((OUT/'source-manifest-final.json').read_text()):
    assert hashlib.sha256((ROOT.parent/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']+' changed after freeze'
for filename in ['post-measurement-release-fix.json','post-measurement-fixture-fix.json','post-measurement-capability-fix.json','post-measurement-retained-cleanup-fix.json','post-measurement-interface-fix.json']:
    for row in json.loads((OUT/filename).read_text())['changes']:
        assert hashlib.sha256((ROOT.parent/row['path']).read_bytes()).hexdigest()==row['afterSha256'],row['path']+' changed after amendment'
logs=sorted(pathlib.Path('/tmp').glob('sb4-nz-r2-*.log'))
write(OUT/'verification-evidence.json',[retain(p) for p in logs+[BINARY,ROOT/'target/debug/snapback4'] if p.is_file()])
for p in REPORT.rglob('*'):
    if p.is_file() and '__pycache__' not in p.parts:
        assert p.stat().st_size<=256*1024 and p.suffix not in ['.gz','.mp4'],str(p)
print(f'{len(checks)} owned devices absent; {len(groups)} recorded groups empty; candidate jobs drained; source bindings unchanged.')
