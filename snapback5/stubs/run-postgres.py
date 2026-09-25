#!/usr/bin/env python3
"""LLP 4001 step 3: own scratch cluster; always stop its recorded PID only."""
from pathlib import Path
import datetime, json, os, shlex, socket, subprocess, tempfile
ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
SCRATCH = Path('/Users/ccheever/projects/snapback-sb5-pg')
SCRATCH.mkdir(exist_ok=True)
run = Path(tempfile.mkdtemp(prefix='rev4-', dir=SCRATCH))
data = run / 'data'
# Choose an unused high TCP port; no connection is made to an existing cluster.
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
if port <= 55000:
    for candidate in range(55101, 65535):
        with socket.socket() as sock:
            try: sock.bind(('127.0.0.1', candidate))
            except OSError: continue
            port = candidate
            break
log = []
def call(args, **kw):
    log.append('$ ' + shlex.join([str(x) for x in args]))
    r = subprocess.run([str(x) for x in args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, **kw)
    log.append(r.stdout)
    log.append(f'[exit {r.returncode}]')
    return r
pid = None
rc = 1
try:
    r = call([PG/'initdb', '-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    r.check_returncode()
    r = call([PG/'pg_ctl', '-D', data, '-l', run/'server.log', '-o', f'-h 127.0.0.1 -k {run} -p {port} -c wal_level=logical', '-w', 'start'])
    r.check_returncode()
    pid = int((data/'postmaster.pid').read_text().splitlines()[0])
    log.append(f'Started postmaster PID {pid}; data={data}; port={port}')
    r = call([PG/'psql', '-X', '-h', run, '-p', port, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '--echo-all', '-f', ROOT/'snapback5/stubs/snapback.sql', '-f', ROOT/'snapback5/stubs/form-table.sql'])
    rc = r.returncode
finally:
    if pid is not None:
        current = int((data/'postmaster.pid').read_text().splitlines()[0])
        if current != pid: raise RuntimeError('Refusing to stop a PID other than the one started')
        r = call([PG/'pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop'])
        r.check_returncode()
        log.append(f'Stopped only recorded postmaster PID {pid}; pid file absent={not (data/"postmaster.pid").exists()}')
    out = ROOT/'snapback5/reports'
    attempt = 1 + len(list(out.glob('20260925-postgres17-attempt-*.log')))
    (out/f'20260925-postgres17-attempt-{attempt:02}.log').write_text('\n'.join(log))
    (out/'20260925-postgres17-output.log').write_text('\n'.join(log))
    (out/'20260925-postgres17-run.json').write_text(json.dumps(dict(cluster=str(data), port=port, pid=pid, exit=rc, stopped=pid is not None and not (data/'postmaster.pid').exists()), indent=2)+'\n')
print(f'Postgres verification exit={rc}; PID={pid}; transcript=snapback5/reports/20260925-postgres17-output.log')
raise SystemExit(rc)
