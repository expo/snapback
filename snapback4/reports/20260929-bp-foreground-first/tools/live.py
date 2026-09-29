"""SQ live protocol plus CPU confinement, thread monitoring, and final drain.

Usage: live.py BINARY OUTPUT [--cpus 0-9]. Builds nothing; needs prepare.py.
On macOS omit --cpus. All servers/PIDs are owned by this invocation.
"""
import argparse, json, os, pathlib, signal, socket, subprocess, sys, time

parser = argparse.ArgumentParser()
parser.add_argument('binary', type=pathlib.Path)
parser.add_argument('output', type=pathlib.Path)
parser.add_argument('--cpus')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[4]
tool = pathlib.Path(__file__).resolve().parent
sq = root / 'snapback4/reports/20260929-sq-storage-read-path/tools'
base, binary = args.output.resolve(), args.binary.resolve()
live = base / 'live'
port = os.environ.get('BP_PORT', '49671')
prefix = ['taskset','-c',args.cpus] if args.cpus else []
env = dict(os.environ, SQ_DIAGNOSTIC='1', SQ_QUEUES=str(sq/'queues.py'), SQ_REPO=str(root),
           SQ_CURVE=str(sq/'curve.mjs'), SQ_SNAPSHOT=str(root/'snapback4/reports/20260928-pf-scale-curves/tools/snapshot.py'),
           REPLAY_BACKEND_DIR=str(live), SNAPBACK_URL=f'http://127.0.0.1:{port}')
link = base / 'server'
if link.is_symlink(): link.unlink()
link.symlink_to(binary)
with (base/'server.log').open('wb') as f:
    server = subprocess.Popen(prefix+[str(binary),'dev','--port',port,'--replay','--no-watch'], cwd=live, env=env, stdout=f, stderr=f, start_new_session=True)
(base/'server.pid').write_text(str(server.pid))
monitor = None
try:
    for _ in range(300):
        if server.poll() is not None: raise RuntimeError('server exited; see server.log')
        try:
            with socket.create_connection(('127.0.0.1',int(port)),.1): break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('server readiness timeout')
    if sys.platform.startswith('linux'):
        monitor = subprocess.Popen([sys.executable,str(tool/'monitor.py'),str(server.pid),str(base)])
    for name in ['starter-m1','starter-m2','starter-m3','scale']:
        with (base/f'{name}.log').open('wb') as f:
            replay = subprocess.Popen(prefix+['node','scripts/replay.mjs','instrument/fixtures/'+name+'.log'], cwd=live, env=dict(env,REPLAY_STATE=str(live/'evidence/replay')), stdout=f, stderr=f)
            (base/'replay.pid').write_text(str(replay.pid))
            if replay.wait() != 0: raise RuntimeError(f'{name} failed; see log')
        print(name, 'complete', flush=True)
    rows = []; clean = 0; began = time.time()
    while time.time()-began < 900:
        row = json.loads(subprocess.check_output([sys.executable,str(sq/'queues.py'),str(live/'.snapback4/store.sqlite')],text=True))
        rows.append(row)
        clean = clean+1 if all(v == 0 for v in row['queues'].values()) else 0
        if clean == 3: break
        time.sleep(1)
    (base/'drain.json').write_text(json.dumps({'start':began,'end':time.time(),'clean':clean==3,'samples':rows},indent=2))
    if clean != 3: raise RuntimeError('backlog did not drain in 900 seconds')
finally:
    if server.poll() is None: os.killpg(server.pid,signal.SIGTERM)
    server.wait(timeout=30)
    if monitor: monitor.wait(timeout=10)
