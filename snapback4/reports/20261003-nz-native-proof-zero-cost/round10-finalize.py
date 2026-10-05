"""Bind Round 10 verification and inspect only previously recorded NZ resources."""
import hashlib, json, pathlib, subprocess, time
from measure import ROOT, REPORT, ARCHIVE, retain

OUT=REPORT/'round10'
def write(name, value): (OUT/name).write_text(json.dumps(value,indent=2)+'\n')
record=json.loads((OUT/'full-suite.json').read_text())
assert record['state']=='finished' and record['status']==0 and record['inputsUnchanged']
inputs=json.loads((OUT/'full-suite-inputs.json').read_text())
for entry in inputs:
    assert hashlib.sha256((ROOT.parent/entry['path']).read_bytes()).hexdigest()==entry['sha256'],entry['path']
for name in ['cleanup.rs','process_group.rs','preparation_deadline.rs']:
    path=pathlib.Path('snapback4/crates/snapback4/src/verbs/witness')/name
    assert (ROOT.parent/path).read_bytes()==subprocess.check_output(['git','show','HEAD:'+str(path)],cwd=ROOT.parent)
prior=json.loads((REPORT/'round2/device-verification.json').read_text())
devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))['devices']
present={d['udid'] for values in devices.values() for d in values}
checks=[]
for row in prior['checks']:
    owned=row['simulator']; assert owned['prefix']=='sb4-nz-' and owned['selection']=='created'
    checks.append(dict(udid=owned['udid'],prefix=owned['prefix'],absent=owned['udid'] not in present))
assert all(row['absent'] for row in checks)
# Read-only command inventory; only this worktree's CLI path is selected.
commands=subprocess.check_output(['ps','-axo','pid,ppid,pgid,command'],text=True)
jobs=[]
fixture_jobs=[]
for line in commands.splitlines()[1:]:
    fields=line.split(None,3)
    if len(fields)==4 and fields[3].startswith(str(ROOT/'target/debug/snapback4')+' '): jobs.append(line)
    if len(fields)==4 and fields[3].split()[0].endswith('/snapback4-interposed') and '/sb4-background-' in fields[3].split()[0]: fixture_jobs.append(line)
assert not jobs,jobs
assert not fixture_jobs,fixture_jobs
write('custody-verification.json',dict(at=time.time(),newRealDevicesCreated=0,priorOwnedDeviceChecks=checks,remainingLaneCliJobs=jobs,remainingInterposedFixtureCliJobs=fixture_jobs,
    note='Real devices were not created this round. Mac integration controls used per-project fake tools and recorded fake UUIDs. No other session device or process was signalled.'))
logs=sorted(pathlib.Path('/tmp').glob('sb4-nz-r10-*.log'))
artifacts=[retain(p) for p in logs+[ROOT/'target/debug/snapback4']]
for row in artifacts:
    data=(ARCHIVE/row['sha256']).read_bytes()
    assert hashlib.sha256(data).hexdigest()==row['sha256']
write('verification-evidence.json',artifacts)
for p in OUT.rglob('*'):
    if p.is_file(): assert p.stat().st_size<=256*1024 and p.suffix not in ['.gz','.mp4'],str(p)
print(f'{len(artifacts)} verification artifacts archived; full-suite inputs unchanged; no new real devices, prior owned devices absent, lane CLI processes drained.')
