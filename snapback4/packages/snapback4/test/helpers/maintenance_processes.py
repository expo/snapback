"""Read-only, bounded process evidence. No raw argv, environment or outside FDs escape."""
# @ref LLP 3000.030#15 — diagnostic admission checks birth, command and fixture group.
import ctypes, json, os, pathlib, re, struct, sys, time

ROLES = {'witness', 'export-maintain', 'export-maintain-scan', 'export-retain-worker',
         '--internal-witness-process', 'anchor', 'supervisor', 'background-worker'}
MAX_PROCESSES, MAX_FDS = 24, 16

def read_at(fd, name, limit):
    child = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=fd)
    try: return os.read(child, limit)
    finally: os.close(child)

def linux_info(pid):
    fd = os.open('/proc/'+str(pid), os.O_RDONLY | os.O_DIRECTORY)
    try:
        raw = read_at(fd, 'stat', 4096)
        fields = raw[raw.rindex(b')')+1:].split()
        return fd, dict(pid=pid, parent=int(fields[1]), group=int(fields[2]), state=fields[0].decode(),
                        start=[pathlib.Path('/proc/sys/kernel/random/boot_id').read_text(), fields[19].decode()])
    except BaseException: os.close(fd); raise

# Same proc_bsdinfo layout/identity as recovery.rs and the pinned libc crate.
class BSDInfo(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint32) for n in ['flags','state','exit','pid','parent','uid','gid','ruid','rgid','svuid','svgid','reserved']] + [
        ('comm',ctypes.c_char*16),('name',ctypes.c_char*32)] + [(n,ctypes.c_uint32) for n in ['files','group','job','dev','tpgid']] + [
        ('nice',ctypes.c_int32),('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]

def darwin_info(pid):
    lib = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    info = BSDInfo()
    if lib.proc_pidinfo(pid,3,0,ctypes.byref(info),ctypes.sizeof(info)) != ctypes.sizeof(info): raise ProcessLookupError()
    return lib, dict(pid=pid,parent=info.parent,group=info.group,state=str(info.state),start=[info.sec,info.usec])

def inspect(pid, expected=None, details=False, root=''):
    """Check birth before argv; Linux descriptors stay relative to the same proc inode."""
    fd = None
    try:
        if sys.platform=='linux':fd, row = linux_info(pid)
        elif sys.platform=='darwin':lib,row = darwin_info(pid)
        else:return None
        if expected and row['start'] != expected.get('start'): return None
        if row['state'] in ('Z','5'):return None
        if sys.platform=='linux':
            raw=read_at(fd,'cmdline',8192)
            if len(raw)==8192:return None
            argv=[a.decode(errors='replace') for a in raw.split(b'\0') if a]
            program=os.path.basename(os.readlink('exe',dir_fd=fd))
        else:
            buf=ctypes.create_string_buffer(8192);size=ctypes.c_size_t(len(buf))
            mib=(ctypes.c_int*3)(1,49,pid) # CTL_KERN, KERN_PROCARGS2
            if lib.sysctl(mib,3,buf,ctypes.byref(size),None,0) or size.value==len(buf):return None
            raw=buf.raw[:size.value];argc=struct.unpack('i',raw[:4])[0]
            executable,rest=raw[4:].split(b'\0',1)
            argv=[a.decode(errors='replace') for a in rest.lstrip(b'\0').split(b'\0')[:argc]]
            program=os.path.basename(executable.decode(errors='replace'))
        if not re.fullmatch(r'[A-Za-z0-9._+-]{1,64}',program):return None
        # Raw command stays in this private process's memory, solely for exact
        # before/after validation. Only fixed verbs and <fixture> are emitted.
        row['_argv']=argv;row['program']=program
        if expected and ('_argv' in expected) and (row['_argv']!=expected['_argv'] or row['program']!=expected['program'] or row['group']!=expected['group']):return None
        if details:
            row['fds']=[]
            if sys.platform=='linux':
                descriptors=os.open('fd',os.O_RDONLY|os.O_DIRECTORY,dir_fd=fd)
                try:
                    with os.scandir(descriptors) as entries:
                        for entry in entries:
                            if len(row['fds'])==MAX_FDS:row['fdsTruncated']=True;break
                            try:
                                target=os.readlink(entry.name,dir_fd=descriptors)
                                if target.startswith(root+'/'):target='<fixture>/'+target[len(root)+1:][:192]
                                elif target not in ('/dev/null',) and not re.fullmatch(r'(pipe|socket):\[\d+\]',target):target='<outside-fixture>'
                                info=read_at(fd,'fdinfo/'+entry.name,2048).decode(errors='replace').splitlines()
                                locks=[line[:192] for line in info if line.startswith('lock:')][:2]
                                flags=next((line[6:38].strip() for line in info if line.startswith('flags:')),None)
                                row['fds'].append(dict(fd=int(entry.name),target=target,flags=flags,locks=locks))
                            except OSError:pass
                finally:os.close(descriptors)
            else:row['fdsUnavailable']='Darwin descriptor collection omitted'
        return row
    except (OSError, ValueError, IndexError):return None
    finally:
        if fd is not None:os.close(fd)

def fixture_command(row, root):
    argv=row['_argv'];p=row['program']
    bound=any(a==root or a.startswith(root+'/') for a in argv)
    if not bound:return False
    if p=='snapback4':return len(argv)>1 and argv[1] in ('witness','--internal-witness-process')
    if p.startswith('python'):return '-c' in argv and any(a==root+'/artifacts/native-smoke/retention.lock' or (a.startswith(root+'/artifacts/native-smoke/') and a.endswith('.lock')) for a in argv)
    if p.startswith('node'):return any(a.endswith('/export-ios.mjs') or a.startswith(root+'/bin/') or a.startswith(root+'/node_modules/expo/') for a in argv)
    return p=='gzip'

def capture(root, records, deadline):
    own_group=os.getpgid(os.getppid())
    candidates={r['pid']:r for r in records[:MAX_PROCESSES]}
    rows={}; rejected=[]; groups={own_group:None};truncated=[]
    if len(records)>=MAX_PROCESSES:truncated.append('identity-budget')
    for pid, record in candidates.items():
        if time.monotonic()>deadline:break
        if not isinstance(record.get('start'),list) or len(record['start'])!=2:
            rejected.append(dict(pid=pid,reason='missing-birth'));continue
        row=inspect(pid,record,root=root)
        if not row or not fixture_command(row,root):
            rejected.append(dict(pid=pid,reason='birth-or-command-mismatch'));continue
        rows[pid]=row
        # A detached group is admitted only through its birth-matched, fixture-
        # bound native leader; a journal's bare group number is never authority.
        if row['group']==pid and row['program']=='snapback4':groups[pid]=row
    # Discover only the test's direct children (e.g. its held-lease fixture).
    # No host-wide argv listing or recursive walk of unrelated process groups.
    if sys.platform=='linux':
        try:
            with open(f'/proc/{os.getppid()}/task/{os.getppid()}/children') as f: children=f.read(4096).split()
            if len(children)>MAX_PROCESSES:truncated.append('children')
            for value in children[:MAX_PROCESSES]:
                pid=int(value)
                if pid in candidates or pid==os.getpid():continue
                row=inspect(pid,root=root)
                if row and row['group']==own_group and fixture_command(row,root):rows[pid]=row
        except OSError:pass
    result=[]
    if len(rows)>MAX_PROCESSES:truncated.append('processes')
    for pid,row in list(rows.items())[:MAX_PROCESSES]:
        if time.monotonic()>deadline:break
        leader=groups.get(row['group'])
        if row['group'] not in groups:
            rejected.append(dict(pid=pid,reason='outside-test-groups'));continue
        if leader and not inspect(leader['pid'],leader,root=root):continue
        checked=inspect(pid,row,details=True,root=root)
        if not checked or not inspect(pid,row,root=root):continue
        if leader and not inspect(leader['pid'],leader,root=root):continue
        checked['arguments']=[arg if arg in ROLES else '<fixture>' for arg in checked.pop('_argv') if arg in ROLES or arg==root or arg.startswith(root+'/')][:8]
        result.append(checked)
    if time.monotonic()>deadline:truncated.append('time')
    return dict(processes=result,rejected=rejected[:MAX_PROCESSES],truncated=truncated,limits=dict(processes=MAX_PROCESSES,descriptorsPerProcess=MAX_FDS))
