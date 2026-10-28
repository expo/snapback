"""Read-only custody checks and native restart for excluded low-rate clocks.

Never creates/copies a credential, reseeds data, edits PG settings or touches
another campaign. Uses the former lane's private token files in place.
"""
import hashlib,json,os,shutil,subprocess as sp,time
from pathlib import Path
from urllib.parse import quote

def adopt(r,prior,s1):
    prior=prior.resolve();custody=json.loads((prior/'custody.json').read_text())
    cleanup=json.loads((prior/'cleanup.json').read_text())
    root=Path(custody['private_root']).resolve()
    assert root.parent==Path('/tmp') and root.name.startswith('s1c-') and root.stat().st_uid==os.getuid()
    assert cleanup['private_root']==str(root) and cleanup['pidfile_absent'] and not cleanup['still_running']
    assert not (root/'pg/postmaster.pid').exists(),'never reuse a cluster with a postmaster PID file'
    records=[json.loads(line) for line in (prior/'all-pids.jsonl').read_text().splitlines()]
    assert not any(s1.live(v) for v in records),'prior campaign has a live recorded process'
    ownership=json.loads((prior/'ownership.json').read_text())
    binaries=dict(snapback=Path(r.args.snapback_bin),seed=Path(r.args.seed_bin))
    assert ownership['binary_sha256']==hashlib.sha256(Path(r.args.harness).read_bytes()).hexdigest()
    assert ownership['target_binary_sha256']=={k:hashlib.sha256(p.read_bytes()).hexdigest() for k,p in binaries.items()}
    unused=r.runtime
    assert not (unused/'pg').exists()
    r.runtime=root;r.private=root/'tokens.json';r.project=root/'app';r.release=root/'deployment';r.socket=root/'s';r.upstream=root/'u'
    r.env.update(PGHOST=str(r.upstream),SCALE_JWT_TOKENS_FILE=str(r.private))
    shutil.rmtree(unused) # only the fresh empty scratch shell, never PG data
    (r.out/'custody.json').write_text(json.dumps(dict(private_root=str(root),system='snapback',pid=os.getpid(),reuse_of=str(prior)),indent=2)+'\n')

def start(r,prior,s1):
    s1.disk(r.out)
    for port in (58080,58081,58082,58083):
        with s1.socket.socket() as sock:
            sock.setsockopt(s1.socket.SOL_SOCKET,s1.socket.SO_REUSEADDR,1);sock.bind(('127.0.0.1',port))
    assert not (r.runtime/'pg/postmaster.pid').exists()
    r.master=r.spawn(['taskset','-c',s1.PG_CORES,s1.PGBIN/'postgres','-D',r.runtime/'pg'],r.out,'postgres')
    r.record(r.master[0],'postgres-master')
    end=time.monotonic()+60
    while True:
        if r.master[0].poll() is not None:raise RuntimeError('owned reused PG exited')
        probe=sp.run([str(s1.run.PSQL),'-XqAt','-d','postgres','-c','SELECT 1'],env=r.env,capture_output=True,text=True)
        if probe.returncode==0:break
        if time.monotonic()>end:raise RuntimeError('owned reused PG readiness timeout')
        time.sleep(.1)
    ownership=json.loads((prior/'ownership.json').read_text())
    ownership.update(reuse_of=str(prior.resolve()),postgres_pid=r.master[0].pid,command=s1.sys.argv)
    ownership['clock_driver_sha256']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),Path(__file__).with_name('round2.py')]}
    s1.write(r.out/'ownership.json',ownership)
    (r.out/'postgres-settings.txt').write_text(r.sqlpg("SELECT name,setting,unit FROM pg_settings WHERE name IN ('port','fsync','synchronous_commit','full_page_writes','shared_buffers','max_connections','min_wal_size','max_wal_size','jit') ORDER BY name"))

def fixture(r,rows,s1):
    s1.disk(r.out);r.db=f'{r.db_prefix}_{rows}';r.env['SCALE_DATABASE']=r.db
    r.env['SCALE_DB_USER']='s1pg2_app'
    r.env['SNAPBACK4_STORE_URL']='postgres://s1pg2_app@/'+r.db+'?host='+quote(str(r.socket),safe='')+f'&port={s1.PGPORT}&schema=bench&ha=none'
    r.tokens=json.loads(r.private.read_text());r.barrier_token=(r.runtime/'barrier-token').read_text().strip()
    s1.write(r.out/'seed-equality.json',r.verify_seed(rows))
