# Run only after all measurements finish. Touch exact recorded run devices only.
from pathlib import Path
import os,json,gzip,fcntl,subprocess,hashlib,stat
from contextlib import ExitStack
report=Path(__file__).resolve().parent
root=Path.home()/'.local/state/snapback4/witness/simulators'
records={}
for file in report.glob('evidence/*/live.json.gz'):
    value=json.loads(gzip.decompress(file.read_bytes()))
    s=value.get('simulator') or {}
    if s.get('udid') and s.get('name','').startswith(('sb4-nx-r2-','sb4-nx-recovery-r2-')):records[s['udid']]=s
for file in report.glob('*-kill-*-before.json'):
    s=json.loads(file.read_text())['live']['simulator'];records[s['udid']]=s
assert records
commands=[]
def command(args):
    p=subprocess.run(['/usr/bin/xcrun','simctl',*args],capture_output=True,text=True)
    commands.append({'args':args,'status':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
    assert p.returncode==0,commands[-1]
    return p.stdout
listing=json.loads(command(['list','devices','--json']))
devices={d['udid']:d for group in listing['devices'].values() for d in group}
removed=[]
for udid,expected in records.items():
    if udid not in devices:continue
    path=root/(udid+'.json')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    m=os.fstat(fd);assert m.st_uid==os.geteuid() and m.st_mode&0o022==0 and stat.S_ISREG(m.st_mode)
    with os.fdopen(fd,'rb') as f:raw=f.read()
    owned=json.loads(raw)
    assert owned['udid']==udid and owned['name']==expected['name'] and owned['runtime']==expected['runtime']
    assert owned['prefix'] in ['sb4-nx-r2-','sb4-nx-recovery-r2-'] and owned['name']==devices[udid]['name']
    with (root/(udid+'.lease.json')).open('r+b') as lease:
        fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with ExitStack() as held:
            if devices[udid]['state']=='Booted':
                home=Path(command(['getenv',udid,'HOME']).strip())
                homelease=held.enter_context((home/'.snapback4-witness-owner.lock').open('r+b'))
                fcntl.flock(homelease,fcntl.LOCK_EX|fcntl.LOCK_NB)
                command(['shutdown',udid])
            command(['delete',udid]);path.unlink()
    removed.append({'udid':udid,'ownership':owned,'recordSha256':hashlib.sha256(raw).hexdigest()})
listing=json.loads(command(['list','devices','--json']))
remaining={d['udid'] for group in listing['devices'].values() for d in group}
assert not remaining.intersection(records)
(report/'cleanup.json').write_text(json.dumps({'records':removed,'commands':commands,'allRunDevicesAbsent':True},indent=2)+'\n')
print(json.dumps({'deleted':len(removed),'allRunDevicesAbsent':True}))
