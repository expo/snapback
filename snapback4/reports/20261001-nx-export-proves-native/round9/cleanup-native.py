# Run only after every native export and evidence archive has completed.
from pathlib import Path
from contextlib import ExitStack
import fcntl,hashlib,json,os,stat,subprocess
root=Path(__file__).resolve().parents[3]; report=Path(__file__).resolve().parent
records={}; commands=[]
for p in report.glob('*.json'):
    d=json.loads(p.read_text())
    if not isinstance(d,dict) or not d.get('receiptPath'):continue
    s=d.get('simulator') or {}
    if s.get('udid'):records[s['udid']]=s
assert records and (report/'native-evidence.json').exists()
state=root/'target/nx/round9/sim-state/snapback4/witness/simulators'
def run(args):
    out=subprocess.run(['/usr/bin/xcrun','simctl',*args],capture_output=True,text=True)
    commands.append({'args':args,'status':out.returncode,'stdout':out.stdout,'stderr':out.stderr})
    assert out.returncode==0,commands[-1]
    return out.stdout
removed=[]
for udid,expected in records.items():
    assert expected['name'].startswith('sb4-nx-r9-') and expected['name']!='mini-verify-iphone'
    record=state/(udid+'.json'); fd=os.open(record,os.O_RDONLY|os.O_NOFOLLOW)
    metadata=os.fstat(fd);assert metadata.st_uid==os.geteuid() and metadata.st_mode&0o022==0 and stat.S_ISREG(metadata.st_mode)
    with os.fdopen(fd,'rb') as f: raw=f.read()
    owned=json.loads(raw);assert owned['udid']==udid and owned['name']==expected['name'] and owned['prefix']=='sb4-nx-r9-'
    with ExitStack() as held:
        lease=held.enter_context((state/(udid+'.lease.json')).open('r+b'));fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        home=Path(run(['getenv',udid,'HOME']).strip())
        shared=held.enter_context((home/'.snapback4-witness-owner.lock').open('r+b'));fcntl.flock(shared,fcntl.LOCK_EX|fcntl.LOCK_NB)
        run(['shutdown',udid]);run(['delete',udid]);record.unlink()
    removed.append({'udid':udid,'ownership':owned,'recordSha256':hashlib.sha256(raw).hexdigest()})
(report/'simulator-cleanup.json').write_text(json.dumps({'removed':removed,'commands':commands,'onlyRecordedRound9DevicesTouched':True},indent=2)+'\n')
print(json.dumps({'deleted':len(removed)}))
