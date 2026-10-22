#!/usr/bin/env python3
"""S1-SK: shipped serve, local SQLite; reuse the S1 rate search and scheduler.

Launch with setsid nohup; all subprocess PIDs are recorded, only owned children stopped.
No database SQL writes: fixture rows go through Snapback's /seed, then deploy.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess as sp
import time
import urllib.error
import urllib.request

from run import Run, HERE, BIN, APP_CORES, LOAD_CORES, write, cpu_sample, counter_result

def interrupted(signum, frame):
    raise KeyboardInterrupt(f'signal {signum}')

signal.signal(signal.SIGTERM, interrupted)

SB = HERE.parents[1] / 'target/s1sk/release/snapback4'
APP = HERE / 'snapback-app'
URL = 'http://127.0.0.1:58080'


def http(path, body=None, token=None, **headers):
    headers['Content-Type'] = 'application/json'
    if token is not None:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(URL + path, None if body is None else json.dumps(body).encode(), headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


def principal(i): return f'bench:{i}'
def room(i): return f'r{i:04}'
def user(i): return f'u{i:04}'
def member(r, u, last=0):
    return dict(table='memberships', row=dict(id=f'a{r:04}-{u:04}', room=room(r), principal=principal(u), last_read=last))


def wait_channels(pid):
    channels={}
    for thread in Path(f'/proc/{pid}/task').iterdir():
        try:
            channels[thread.name]=(thread/'wchan').read_text().strip()
        except FileNotFoundError:
            pass  # A completed thread is not a failed resource observation.
    return channels


class Snapback(Run):
    def __init__(self, args):
        self.args = args
        self.out = Path(args.out).resolve()
        self.out.mkdir(parents=True, exist_ok=False)
        self.runtime = HERE / 'target/s1sk' / self.out.name
        self.runtime.mkdir(parents=True, exist_ok=False, mode=0o700)
        self.project = self.runtime / 'app'
        shutil.copytree(APP, self.project, ignore=shutil.ignore_patterns('generated', '.snapback4'))
        self.release = self.runtime / 'deployment'
        self.service = None
        self.children = []
        self.tunnels = []
        self.env = dict(os.environ)
        self.private = self.runtime / 'tokens.json'
        self.env['SCALE_JWT_TOKENS_FILE'] = str(self.private)
        self.args.target = 'snapback'

    def spawn(self, command, directory, kind, cwd=None):
        stdout = (directory / f'{kind}.stdout').open('x')
        stderr = (directory / f'{kind}.stderr').open('x')
        p = sp.Popen(['setsid', 'nohup', *map(str, command)], cwd=cwd, env=self.env,
                     stdin=sp.DEVNULL, stdout=stdout, stderr=stderr)
        self.children.append((p, stdout, stderr))
        with (self.out / 'pids.jsonl').open('a') as f:
            f.write(json.dumps(dict(pid=p.pid, kind=kind, time=time.time(), command=list(map(str, command)))) + '\n')
        return p, stdout, stderr

    def stop_service(self):
        if self.service:
            p, out, err = self.service
            if p.poll() is None: p.terminate()
            p.wait(timeout=30)
            out.close(); err.close()
            self.service = None

    def wait_ready(self):
        p, out, err = self.service
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if p.poll() is not None: raise RuntimeError(f'serve startup failed: {err.name}')
            if 'http://127.0.0.1:58080' in Path(out.name).read_text():
                status, _ = http('/auth/config')
                if status == 200: return
            time.sleep(.1)
        raise RuntimeError('Snapback readiness timeout')

    def cli(self, *args):
        return sp.check_output([str(SB), *map(str, args)], cwd=self.project, env=self.env, text=True)

    def sql(self, sql, release=None):
        return json.loads(self.cli('sql', sql, '--release', release or self.release, '--json-objects', '--limit', '10000'))

    def start(self):
        sources = [HERE/'Cargo.toml', HERE/'Cargo.lock', *sorted((HERE/'src').glob('*.rs')),
                   *sorted((HERE/'scripts').glob('*.py')), *sorted(APP.rglob('*.q'))]
        write(self.out/'ownership.json', dict(pid=os.getpid(), pgid=os.getpgid(0),
            source_commit=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),
            source_sha256={str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
            binary_sha256=hashlib.sha256(BIN.read_bytes()).hexdigest(),
            snapback_binary_sha256=hashlib.sha256(SB.read_bytes()).hexdigest(),
            command=os.sys.argv, app_cores=APP_CORES, load_cores=LOAD_CORES,
            method=dict(warmup_ms=self.args.warmup_ms,duration_ms=self.args.duration_ms,repeats=self.args.repeats),
            sqlite=dict(durability='shipped WAL, synchronous=FULL', database=str(self.release/'store.sqlite'))))
        for cmd, name in [(['hostname'],'hostname'), (['uname','-a'],'uname'), (['lscpu'],'lscpu'),
                          (['lsblk','-o','NAME,MODEL,ROTA,SIZE,MOUNTPOINTS'],'disks'),
                          (['df','-h',str(self.runtime)],'filesystem')]:
            (self.out/f'{name}.txt').write_text(sp.check_output(cmd,text=True))
        (self.out/'check.txt').write_text(self.cli('check','--cost'))

    def fixture(self, rows):
        directory=self.out/'seed'; directory.mkdir()
        self.service=self.spawn(['taskset','-c',APP_CORES,SB,'dev','--port','58080','--no-watch'], directory, 'dev', self.project)
        self.wait_ready()
        def seed(batch):
            status, value = http('/seed', batch)
            if status != 200 or value.get('seeded') != len(batch):
                raise RuntimeError(f'seed refused: {status} {value}')
        seed([dict(table='users',row=dict(id=user(i),principal=principal(i))) for i in range(256)] +
             [dict(table='rooms',row=dict(id=room(i))) for i in range(1025)])
        memberships=[member((u*4+j)%1024,u) for u in range(256) for j in range(32)]
        memberships += [member(1024,u) for u in range(256)]
        for offset in range(0,len(memberships),2000): seed(memberships[offset:offset+2000])
        seed([dict(table='counters',row=dict(id=f'c{i:04}',owner=principal(i) if i<256 else None,room=room(1024))) for i in range(257)])
        start=time.time()
        for offset in range(0,rows,4000):
            seed([dict(table='messages',row=dict(id=f'm{g:010}',room=room((g-1)%1024),
                  sender=user(((g-1)%1024)//4),at=1700000000000+g,body=f'message-{g} '+'chat '*30))
                  for g in range(offset+1,min(rows,offset+4000)+1)])
            if offset%40000==0: print(f'seeded {min(rows,offset+4000)}/{rows}',flush=True)
        # Same last-read offsets; never assign the engine-owned maintained columns.
        for m in memberships:
            r=int(m['row']['room'][1:])
            total=0 if r==1024 else (rows+1023-r)//1024
            m['row']['last_read']=max(0,total-10)
        for offset in range(0,len(memberships),2000): seed(memberships[offset:offset+2000])
        self.stop_service()
        # A stopped-store SQLite backup is restoration, not SQL mutation of managed rows.
        self.release.mkdir(mode=0o700)
        with sqlite3.connect(f'file:{self.project}/.snapback4/store.sqlite?mode=ro',uri=True) as src:
            with sqlite3.connect(self.release/'store.sqlite') as dst: src.backup(dst)
        (directory/'deploy.txt').write_text(self.cli('deploy',self.release,'--json'))
        write(directory/'seed.json',dict(messages=rows,elapsed_s=time.time()-start,
            path='dev /seed (4000-message transactions), stopped-store backup, deploy, serve',
            assigned_maintained_columns=False))
        write(self.out/'seed-equality.json',self.verify_seed(rows))

    def verify_seed(self, rows):
        def query(s): return self.sql(s)['rows']
        assert query('SELECT count(*) AS n FROM messages')[0]['n']==rows
        rooms=query('SELECT id,total FROM rooms ORDER BY id')
        assert len(rooms)==1025
        assert all(r['total']==(0 if r['id']=='r1024' else (rows+1023-int(r['id'][1:]))//1024) for r in rooms)
        users=query('SELECT id,sent FROM users ORDER BY id')
        assert len(users)==256 and sum(u['sent'] for u in users)==rows
        expected=[sum((rows+1023-r)//1024 for r in range(u*4,u*4+4)) for u in range(256)]
        assert [u['sent'] for u in users]==expected
        # Full deterministic image validation, through Snapback's administrative SQL views.
        mismatch=query("SELECT count(*) AS n FROM messages WHERE room != printf('r%04d', (at-1700000000001)%1024) OR sender != printf('u%04d', ((at-1700000000001)%1024)/4) OR id != printf('m%010d', at-1700000000000) OR body != 'message-' || (at-1700000000000) || ' ' || replace(hex(zeroblob(30)), '00', 'chat ')")[0]['n']
        assert mismatch==0
        memberships=query('SELECT id,room,principal,last_read FROM memberships ORDER BY id')
        expected_members=[]
        for u in range(256):
            for r in [(u*4+j)%1024 for j in range(32)]+[1024]:
                total=0 if r==1024 else (rows+1023-r)//1024
                expected_members.append(member(r,u,max(0,total-10))['row'])
        assert memberships==sorted(expected_members,key=lambda m:m['id'])
        counters=query('SELECT id,owner,room,n FROM counters ORDER BY id')
        assert counters==[dict(id=f'c{i:04}',owner=principal(i) if i<256 else None,
            room=room(1024),n=0) for i in range(257)]
        return dict(messages=rows,rooms=1025,users=256,memberships=8448,counters=257,
                    every_message_image_matches=True,room_totals_exact=True,sender_totals_exact=True,
                    every_membership_and_last_read_matches=True,every_counter_image_matches=True)

    def mint(self):
        service=self.cli('token','--service','fixture','--release',self.release,'--quiet').strip()
        tokens=[]
        for i in range(256):
            status, value=http('/auth/session',dict(principal=principal(i),kind='member',days=7),service)
            if status!=200 or 'session' not in value: raise RuntimeError('application session mint failed')
            tokens.append(value['session']['token'])
        fd=os.open(self.private,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f: json.dump(tokens,f)
        self.tokens=tokens

    def start_service(self,pool,delay,directory):
        assert delay==0
        self.stop_service()
        self.service=self.spawn(['taskset','-c',APP_CORES,SB,'serve',self.release,'--port','58080'],directory,'serve')
        self.wait_ready()
        if not self.private.exists(): self.mint()

    def ping(self,delay,path):
        write(path,dict(app_database_rtt='not applicable: SQLite in process',added_delay_us=0))

    def snapshot(self):
        rows=self.sql('SELECT sum(n) AS n FROM counters')['rows']
        pid=self.service[0].pid
        io={k:int(v) for k,v in (line.split(':') for line in Path(f'/proc/{pid}/io').read_text().splitlines())}
        sizes={p.name:p.stat().st_size for p in self.release.glob('store.sqlite*') if p.is_file()}
        return dict(counters=dict(sum=rows[0]['n']),process_io=io,files_bytes=sizes,time=time.time())

    def trial(self,directory,workload,writers,keys,rows,rate,repeat):
        prefix=f'rate-{rate}-r{repeat}'
        before=self.snapshot();write(directory/f'{prefix}.before.json',before)
        command=['taskset','-c',LOAD_CORES,BIN,'load','--target','snapback','--url',URL,
                 '--workload',workload,'--workers',str(writers),'--keys',keys,'--rows',str(rows),
                 '--rate',str(rate),'--warmup-ms',str(self.args.warmup_ms),'--duration-ms',str(self.args.duration_ms)]
        p,out,err=self.spawn(command,directory,prefix)
        start=time.time();samples=[]
        try:
            while p.poll() is None:
                sample=cpu_sample([self.service[0].pid,p.pid])
                sample['diskstats']=Path('/proc/diskstats').read_text()
                sample['server_wchan']=wait_channels(self.service[0].pid)
                samples.append(sample);time.sleep(.25)
            if p.returncode: raise RuntimeError(f'load failed: {err.name}')
        finally:
            if p.poll() is None: p.terminate();p.wait(timeout=15)
            out.close();err.close()
        # Native token minting enters serve's FIFO writer, outside measurement.
        # Two passes also allow requests authenticated before the first barrier
        # to enqueue their operation. Keep the final stable-sum witnesses too.
        for _ in range(2):
            self.cli('token','--service','drain','--release',self.release,'--quiet')
        last=None;stable=0;deadline=time.monotonic()+30
        while stable<2:
            after=self.snapshot();current=after['counters']['sum']
            stable=stable+1 if current==last else 0;last=current
            if time.monotonic()>deadline: raise RuntimeError('writes did not drain')
            time.sleep(.1)
        write(directory/f'{prefix}.after.json',after)
        write(directory/f'{prefix}.resources.json',dict(start=start,end=time.time(),clock_ticks=os.sysconf('SC_CLK_TCK'),samples=samples))
        result=json.loads(Path(out.name).read_text())
        if workload in ('W4','W5'): counter_result(result,after['counters']['sum']-before['counters']['sum'])
        result['command']=list(map(str,command))
        write(directory/f'{prefix}.json',result)
        print(f'{directory.name} rate={rate} r={repeat} ok={result["slo_pass"]} p99={result["latency"]["p99_ms"]:.3f} errors={result["error_count"]}',flush=True)
        return result

    def cell(self,*args):
        super().cell(*args)
        workload,rows,delay,writers,keys=args
        path=self.out/f'{workload.lower()}-n{rows}-d{delay}-c{writers}-{keys}'/'cell.json'
        cell=json.loads(path.read_text())
        cell['rerun']=['python3','scripts/snapback.py','cell','--out',f'target/replay-{path.parent.name}',
            '--fixture',str(self.release),'--workload',workload,'--rows',str(rows),
            '--writers',str(writers),'--keys',keys,'--warmup-ms',str(self.args.warmup_ms),
            '--duration-ms',str(self.args.duration_ms),'--repeats',str(self.args.repeats)]
        path.write_text(json.dumps(cell,indent=2)+'\n')

    def close(self):
        self.stop_service()
        for p,out,err in self.children:
            if p.poll() is None: p.terminate();p.wait(timeout=30)
            out.close();err.close()
        write(self.out/'cleanup.json',dict(processes=[dict(pid=p.pid,status=p.returncode) for p,_,_ in self.children],
            still_running=[p.pid for p,_,_ in self.children if p.poll() is None]))


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=['matrix','cell','prepare'])
    p.add_argument('--out',required=True)
    p.add_argument('--fixture',help='an already prepared deployment (copy, never modify it)')
    p.add_argument('--rows',type=int,default=1000000)
    p.add_argument('--warmup-ms',type=int,default=10000)
    p.add_argument('--duration-ms',type=int,default=20000)
    p.add_argument('--repeats',type=int,default=3)
    p.add_argument('--max-rate',type=int,default=128000)
    p.add_argument('--rates',type=int,nargs='+')
    p.add_argument('--workload',choices=['W1','W2','W3','W4','W5'])
    p.add_argument('--keys',choices=['disjoint','same','hot1'],default='disjoint')
    p.add_argument('--writers',type=int,default=32)
    p.add_argument('--start-at',choices=['W1','W2','W3','W4','W5'],default='W1',help='first workload in a new matrix campaign')
    args=p.parse_args();args.load_cores=LOAD_CORES
    run=Snapback(args)
    try:
        run.start()
        if args.fixture:
            shutil.copytree(args.fixture,run.release,symlinks=True)
        else: run.fixture(args.rows)
        if args.mode=='prepare': return
        matrix=[(w,args.rows,0,128,'disjoint') for w in ('W1','W2','W3')]
        matrix += [(w,args.rows,0,32,k) for w,k in [('W4','disjoint'),('W5','same'),('W5','hot1')]]
        matrix=matrix[next(i for i,c in enumerate(matrix) if c[0]==args.start_at):]
        if args.mode=='cell': matrix=[(args.workload,args.rows,0,args.writers,args.keys)]
        for cell in matrix: run.cell(*cell)
    finally: run.close()


if __name__=='__main__': main()
