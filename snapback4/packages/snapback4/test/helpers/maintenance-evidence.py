#!/usr/bin/env python3
# @ref LLP 3000.030#15 — bounded snapshots survive cleanup without granting custody.
"""Bounded, private snapshots. This disposable process owns no maintenance leases."""
import fcntl, itertools, json, os, pathlib, re, shutil, stat, sys, time, uuid
from maintenance_processes import capture

LIMITS=dict(bytes=1024*1024, fileBytes=16*1024, files=64, inventory=256, depth=4,
            failures=4, cleanups=4, seconds=1.25)
PRIORITY=['maintenance-request.json','maintenance-claimed.json','maintenance-parked.json',
          'maintenance-next.json','maintenance-wakeup.json','maintenance-wakeup-reading.json','maintenance-active.json','maintenance-result.json',
          'maintenance-done.json','maintenance.log','retention-trace.jsonl',
          'maintenance-next.lock','maintenance.lock','retention.lock','latest.json']
CUSTODY=['retention-group.json','retention-status.json','retention-stderr.log','retention-stdout.log',
         'worker.json','driver.json','launch.json','live.json','background.log']

def private_dir(p):
    p.mkdir(mode=0o700,parents=True,exist_ok=True)
    s=p.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid():raise ValueError('invalid evidence directory')
    p.chmod(0o700)

def snapshot(args):
    os.umask(0o077)
    root=pathlib.Path(args['root'])/'artifacts/native-smoke'
    scope=pathlib.Path(args['base'])/('maintenance-'+args['scope'])
    private_dir(scope)
    lease=os.open(scope/'capture.lock',os.O_CREAT|os.O_WRONLY|os.O_NONBLOCK|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(lease)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=os.getuid():raise ValueError('invalid capture lock')
        os.fchmod(lease,0o600)
        try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return dict(skipped='capture-busy')
        # One scope per helper checkout: retention never deletes another lane's
        # evidence. Separate failure/cleanup rings preserve the latest failures.
        kind='cleanup' if args['reason']=='cleanup' else 'failure'
        old=[]
        with os.scandir(scope) as entries:
            for entry in entries:
                if re.fullmatch(r'snapshot-\d+-[0-9a-f]{8}-(cleanup|failure)-[a-z-]+',entry.name) and entry.is_dir(follow_symlinks=False):
                    if '-'+kind+'-' in entry.name:old.append(entry.name)
        for name in sorted(old)[:max(0,len(old)-3)]:shutil.rmtree(scope/name)
        reason=args['reason'] if re.fullmatch(r'[a-z-]{1,32}',args['reason']) else 'capture'
        out=scope/f'snapshot-{time.time_ns()}-{uuid.uuid4().hex[:8]}-{kind}-{reason}'
        private_dir(out)
        started=time.monotonic(); deadline=started+LIMITS['seconds']
        inventory=[];records=[];truncated=set();copied=0;attempted=0;visited=0;written=0
        def write(relative,data,reserve=0):
            nonlocal written
            if written+len(data)>LIMITS['bytes']-reserve:
                truncated.add('total-bytes');return False
            # Charge before I/O: a partial write followed by an error must not
            # recover budget and allow subsequent files to exceed the cap.
            written+=len(data)
            target=out/relative;private_dir(target.parent)
            fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as f:f.write(data)
            return True
        def identities(value,depth=0):
            if depth>8 or len(records)>=24:return
            if isinstance(value,dict):
                if isinstance(value.get('pid'),int) and value['pid']>0:
                    records.append(dict(pid=value['pid'],start=value.get('start')))
                for v in value.values():identities(v,depth+1)
            elif isinstance(value,list):
                for v in value[:24]:identities(v,depth+1)
        seen=set();current=None
        def visit(file,depth):
            nonlocal copied,attempted,visited,current
            if time.monotonic()>deadline:truncated.add('time');return False
            if visited>=LIMITS['inventory'] or len(inventory)>=LIMITS['inventory']:truncated.add('inventory');return False
            visited+=1
            relative=file.relative_to(root).as_posix()
            if len(relative.encode())>256:truncated.add('path');return True
            if relative in seen:return True
            seen.add(relative)
            try:
                s=file.lstat();row=dict(path=relative,size=s.st_size,inode=s.st_ino,mtimeNs=s.st_mtime_ns,mode=s.st_mode);inventory.append(row)
                if stat.S_ISDIR(s.st_mode):
                    if depth>=LIMITS['depth']:row['omitted']='depth'
                    return True
                if not stat.S_ISREG(s.st_mode):row['omitted']='nonregular';return True
                if not re.search(r'\.(json|jsonl|log|lock|tmp)$',file.name):return True
                if attempted>=LIMITS['files']:row['omitted']='file-count';truncated.add('file-count');return True
                fd=os.open(file,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
                try:
                    actual=os.fstat(fd)
                    if not stat.S_ISREG(actual.st_mode):row['omitted']='changed-type';return True
                    keep=LIMITS['fileBytes']-128;offset=max(0,actual.st_size-keep)
                    os.lseek(fd,offset,os.SEEK_SET);data=os.read(fd,keep)
                finally:os.close(fd)
                if offset:
                    row['omittedPrefixBytes']=offset
                    data=f'[truncated: omitted {offset} prefix bytes]\n'.encode()+data
                elif file.name.endswith('.json'):
                    try:
                        value=json.loads(data);identities(value)
                        if relative=='latest.json' and isinstance(value,dict) and isinstance(value.get('artifacts'),str):
                            candidate=pathlib.Path(value['artifacts'])
                            if candidate.parent==root and re.fullmatch(r'\d+-\d+',candidate.name):current=candidate.name
                    except (ValueError,UnicodeDecodeError):pass
                attempted+=1
                if write('files/'+relative,data,reserve=512*1024):copied+=1;row['capturedBytes']=len(data)
                else:row['omitted']='total-bytes'
            except OSError as e:
                if len(inventory)<LIMITS['inventory']:inventory.append(dict(path=relative,error=e.errno))
            return True
        for name in PRIORITY:
            if (root/name).exists():visit(root/name,0)
        # Retention custody and the current proof precede historical receipts.
        # The Mac timeout exhausted 64 copies on history before either live
        # retention group's journal/stderr. Sorting only a bounded discovery
        # batch preserves every original byte, file, inventory and time cap.
        def order(entry):
            work=re.fullmatch(r'\.retention-\d+-(\d+)',entry.name)
            if work:return (0,-int(work[1]),entry.name)
            if entry.name==current:return (1,0,entry.name)
            if entry.name in CUSTODY:return (2,CUSTODY.index(entry.name),entry.name)
            return (3,0,entry.name)
        def walk(directory,depth):
            remaining=min(LIMITS['inventory']-visited,LIMITS['inventory']-len(inventory))
            if time.monotonic()>deadline or remaining<=0:truncated.add('inventory-or-time');return
            try:
                with os.scandir(directory) as entries:
                    batch=list(itertools.islice(entries,remaining))
                    if next(entries,None) is not None:truncated.add('inventory-or-time')
                for entry in sorted(batch,key=order):
                    if not visit(pathlib.Path(entry.path),depth):break
                    if depth<LIMITS['depth'] and entry.is_dir(follow_symlinks=False):walk(pathlib.Path(entry.path),depth+1)
            except OSError:pass
        walk(root,0)
        if visited>=LIMITS['inventory'] or len(inventory)>=LIMITS['inventory']:truncated.add('inventory-or-time')
        process=capture(args['root'],records,deadline)
        write('processes.json',json.dumps(process,separators=(',',':')).encode())
        # Test timing stays in bounded memory until capture; no fixture-side I/O.
        write('test-drain.jsonl',b''.join(json.dumps(v).encode()+b'\n' for v in args.get('drains',[])[:64]))
        metadata=dict(at=time.time(),reason=reason,root=str(root),platform=sys.platform,limits=LIMITS,
                      files=inventory,truncated=sorted(truncated),capturedFiles=copied,copyAttempts=attempted,entriesVisited=visited,reservedBytesBeforeManifest=written,
                      elapsedMs=round((time.monotonic()-started)*1000,3))
        if not write('snapshot.json',json.dumps(metadata,separators=(',',':')).encode()):
            write('snapshot.json',json.dumps(dict(reason=reason,truncated=['manifest-byte-budget'],limits=LIMITS)).encode())
        return dict(out=str(out))
    finally:os.close(lease)

if __name__=='__main__':
    try:
        data=sys.stdin.buffer.read(65537)
        if len(data)>65536:raise ValueError('oversize request')
        args=json.loads(data)
        if args.get('owner')!=os.getppid():raise ValueError('not the requesting test')
        print(json.dumps(snapshot(args)))
    except Exception:
        print(json.dumps(dict(skipped='capture-refused')))
