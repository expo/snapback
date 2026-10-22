#!/usr/bin/env python3
"""After PG2 exits: audit owned processes/cluster and remove only private setup files.

No benchmark, signals, cluster changes or database writes. Never emit credentials.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess as sp
import time

from run import HERE, SSH


def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('out',type=Path)
    args=p.parse_args();root=args.root.resolve();out=args.out.resolve()
    assert (root/'run-writes.exit').read_text().strip()=='0'
    assert read(root/'raw-writes/database-cleanup.json')==dict(database_dropped=True,role_dropped=True)
    local=set();remote=set()
    for f in root.glob('*.pid'):
        if f.read_text().strip().isdigit():local.add(int(f.read_text()))
    for seg in root.glob('raw*'):
        if not seg.is_dir():continue
        for f in seg.glob('pids.jsonl'):
            for line in f.read_text().splitlines():local.add(json.loads(line)['pid'])
        if (seg/'ownership.json').exists():
            a=read(seg/'ownership.json');local.update(a.get(k) for k in ('pid','pgid') if a.get(k))
        for f in seg.glob('*cleanup.json'):
            a=read(f)
            if a.get('pid'):local.add(a['pid'])
            if a.get('child_pid'):local.add(a['child_pid'])
        for n in ('remote-seed.json','remote-barrier.json'):
            if (seg/n).exists():remote.update([read(seg/n)['pid'],read(seg/n)['pid']+1])
        f=seg/'db-cpu-observer.jsonl'
        if f.exists():
            for line in f.open():
                if line.startswith('{'):
                    a=json.loads(line)
                    if a.get('monitor_pid'):remote.add(a['monitor_pid'])
                    break
    for f in root.glob('*observer-cleanup.json'):
        if read(f).get('pid'):local.add(read(f)['pid'])
    rows=[]
    for pid in sorted(local):
        path=Path('/proc')/str(pid)
        try:
            cmd=(path/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
            state=(path/'stat').read_text().rsplit(')',1)[1].split()[0]
            owned=('s1pg2' in cmd or str(HERE) in cmd or 'sb4scale/db-monitor.py' in cmd) and state!='Z'
            rows.append(dict(pid=pid,present=True,state=state,owned_signature=owned))
        except (FileNotFoundError,ProcessLookupError):rows.append(dict(pid=pid,present=False,owned_signature=False))
    assert not any(x['owned_signature'] for x in rows),'owned process still running; inspect privately, do not signal reused PIDs'
    write(out/'process-audit.json',dict(time=time.time(),recorded_local_pids=rows,live_owned=[],
        caveat='historical PID reuse checked by command signature/state; no signals sent'))
    # The known private material stays outside the raw-evidence tree. Scan before
    # removing it, retaining counts and paths only if there is a match.
    secret_values={(Path.home()/'sb4scale/pw').read_text().strip().encode()}
    private=[]
    for d in (HERE/'target/s1sk').glob('s1pg2*'):
        for name in ('tokens.json','barrier-token'):
            f=d/name
            if f.exists():
                private.append(f)
                if name=='tokens.json':secret_values.update(x.encode() for x in read(f))
                else:secret_values.add(f.read_text().strip().encode())
    secret_values.discard(b'');hits=[];files=0
    token_values={s for s in secret_values if len(s)==43}
    other_values=secret_values-token_values
    token_pattern=re.compile(rb'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])')
    for tree in (root,out):
        for f in tree.rglob('*'):
            if not f.is_file() or f.is_symlink():continue
            b=f.read_bytes();files+=1
            if any(s in b for s in other_values) or any(s in token_values for s in token_pattern.findall(b)):
                hits.append(str(f.relative_to(tree)))
    write(out/'secret-audit.json',dict(files_scanned=files,known_private_values=len(secret_values),matches=hits,
        scope='all raw segments and committed result files; known database password and retained member/service tokens; values never emitted'))
    assert not hits,'known private material found; see paths only in secret-audit.json'
    code=r'''
import json,os,subprocess as sp,time
from pathlib import Path
pids=REMOTE_PIDS
records=[]
for pid in sorted(pids):
 p=Path('/proc')/str(pid)
 try:
  cmd=(p/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
  state=(p/'stat').read_text().rsplit(')',1)[1].split()[0]
  owned=('s1pg2-20261022' in cmd or 'sb4scale/db-monitor.py' in cmd) and state!='Z'
  records.append(dict(pid=pid,present=True,state=state,owned_signature=owned))
 except (FileNotFoundError,ProcessLookupError):records.append(dict(pid=pid,present=False,owned_signature=False))
assert not any(x['owned_signature'] for x in records),'owned remote helper remains'
extra=[]
for p in Path('/proc').glob('[0-9]*'):
 try:
  if 's1pg2-20261022' in str((p/'cwd').resolve(strict=True)):
   state=(p/'stat').read_text().rsplit(')',1)[1].split()[0]
   if state!='Z':extra.append(int(p.name))
 except (FileNotFoundError,ProcessLookupError,PermissionError):pass
assert not extra,'unrecorded helper remains in an owned remote directory'
postmaster=int((Path.home()/'sb4scale/pg17/postmaster.pid').read_text().splitlines()[0]);assert postmaster==2735539
os.kill(postmaster,0)
env=dict(os.environ,PGHOST='127.0.0.1',PGPORT='55440',PGUSER='sb4scale',PGPASSWORD=(Path.home()/'sb4scale/pw').read_text().strip(),LD_LIBRARY_PATH=str(Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
sql="SELECT jsonb_build_object('database_absent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='sb4_snapback_s1pg2'),'role_absent',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='s1pg2_app'),'cluster_start',pg_postmaster_start_time(),'settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','port')))"
r=sp.run([str(Path.home()/'tools/pg16/usr/lib/postgresql/16/bin/psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-d','postgres','-c',sql],env=env,capture_output=True,text=True)
assert r.returncode==0,'read-only cluster audit failed'
cluster=json.loads(r.stdout);assert cluster['database_absent'] and cluster['role_absent']
assert cluster['settings']==dict(fsync='on',synchronous_commit='on',full_page_writes='on',port='55440')
removed=[]
for dirname in ('s1pg2-20261022','s1pg2-20261022-p3'):
 for name in ('config.json','tokens.json','barrier-config.json','barrier-token'):
  p=Path.home()/'sb4scale'/dirname/name
  if p.exists():p.unlink();removed.append(str(p.relative_to(Path.home())))
print(json.dumps(dict(time=time.time(),postmaster_pid=postmaster,postmaster_alive=True,cluster=cluster,remote_processes=records,owned_directory_processes=extra,live_owned=[],removed_private_files=removed)))
'''.replace('REMOTE_PIDS',repr(sorted(remote)))
    r=sp.run([*SSH,'expo-build-450a','python3 -'],input=code,capture_output=True,text=True)
    if r.returncode:raise RuntimeError('remote audit failed; captured output withheld to protect private material')
    audit=json.loads(r.stdout);write(out/'cluster-audit.json',audit)
    for f in private:f.unlink()
    write(out/'private-cleanup.json',dict(local_files_removed=len(private),remote_files_removed=len(audit['removed_private_files']),original_password_file_preserved=True))
    print(json.dumps(dict(local_pids_checked=len(rows),remote_pids_checked=len(remote),known_secret_matches=len(hits),live_owned=[],postmaster_pid=2735539)))


if __name__=='__main__':main()
