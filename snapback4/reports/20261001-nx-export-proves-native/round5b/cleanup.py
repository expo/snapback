# Run only after all measurements finish. Touch exact recorded run devices only.
from pathlib import Path
import os,json,gzip,fcntl,subprocess,hashlib,stat
from contextlib import ExitStack
report=Path('/Users/ccheever/sb4-np/lane-nx/snapback4/reports/20261001-nx-export-proves-native/round5b')
root=Path.home()/'.local/state/snapback4/witness/simulators'
records={}
archive=Path.home()/'sb4-np/evidence-archive/20261001-nx-export-proves-native/blobs'
for summary in report.glob('*.json'):
    value=json.loads(summary.read_text())
    if not isinstance(value,dict):continue
    for item in value.get('evidence',[]):
        if not item['path'].endswith('/live.json.gz'):continue
        raw=(archive/item['sha256']).read_bytes();assert hashlib.sha256(raw).hexdigest()==item['sha256']
        s=json.loads(gzip.decompress(raw)).get('simulator') or {}
        if s.get('udid') and s.get('name','').startswith('sb4-nx-r5b-'):records[s['udid']]=s
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
    assert expected['name']!='mini-verify-iphone' and devices[udid]['name']!='mini-verify-iphone'
    path=root/(udid+'.json')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    m=os.fstat(fd);assert m.st_uid==os.geteuid() and m.st_mode&0o022==0 and stat.S_ISREG(m.st_mode)
    with os.fdopen(fd,'rb') as f:raw=f.read()
    owned=json.loads(raw)
    assert owned['udid']==udid and owned['name']==expected['name'] and owned['runtime']==expected['runtime']
    assert owned['prefix'].startswith('sb4-nx-r5b-') and owned['name']==devices[udid]['name']
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
