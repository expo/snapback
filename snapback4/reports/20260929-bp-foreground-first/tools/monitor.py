"""Read-only Linux thread/host/queue sampling; observer has host affinity.

Short-lived request threads can evade /proc samples: BP_REQUEST hooks supply
their exact lifetime CPU. Background kind counters share one maintenance TID.
"""
import json, os, pathlib, sqlite3, subprocess, sys, time

pid, base = int(sys.argv[1]), pathlib.Path(sys.argv[2])
db = base / 'live/.snapback4/store.sqlite'
proc = pathlib.Path('/proc')
with (base / 'host.jsonl').open('w') as out:
    iteration = 0
    while (proc / str(pid)).exists():
        start = time.monotonic()
        row = {'at': time.time(), 'load': os.getloadavg(), 'threads': []}
        for owner in [pid] + ([int((base / 'replay.pid').read_text())] if (base / 'replay.pid').exists() else []):
            try:
                v = (proc / str(owner) / 'stat').read_text().rsplit(')',1)[1].split()
                row.setdefault('processes', []).append({'pid':owner, 'utime':int(v[11]), 'stime':int(v[12])})
            except OSError: pass
            for task in (proc / str(owner) / 'task').glob('*'):
                try:
                    raw = (task / 'stat').read_text()
                    comm, fields = raw.split('(', 1)[1].rsplit(')', 1)
                    v = fields.split()
                    row['threads'].append({'pid': owner, 'tid': int(task.name), 'name': comm,
                        'state': v[0], 'utime': int(v[11]), 'stime': int(v[12]),
                        'nice': int(v[16]), 'cpu': int(v[36]),
                        'schedstat': (task / 'schedstat').read_text().strip(),
                        'allowed': next(x.split(':',1)[1].strip() for x in (task/'status').read_text().splitlines() if x.startswith('Cpus_allowed_list:'))})
                except (OSError, ValueError, StopIteration): pass
        row['sampledRunnable'] = sum(t['state'] == 'R' for t in row['threads'])
        if iteration % 4 == 0:
            row['procStat'] = (proc/'stat').read_text()
            row['cpuPressure'] = (proc/'pressure/cpu').read_text()
            row['memAvailable'] = next(x for x in (proc/'meminfo').read_text().splitlines() if x.startswith('MemAvailable:'))
            tasks = subprocess.check_output(['ps','-eLo','psr=,stat='], text=True)
            # Includes on-CPU tasks: a sampled runnable population, not exact
            # queued tasks. The global procs_running sample is also retained.
            row['hostRunnableOnSet'] = sum(int(v[0]) < 10 and v[1].startswith('R')
                for line in tasks.splitlines() if len(v := line.split()) == 2)
            try:
                with sqlite3.connect(db.as_uri()+'?mode=ro', uri=True, timeout=.1) as c:
                    row['queues'] = {}
                    tables = c.execute("SELECT name,num FROM _catalog WHERE name LIKE '$recount:%' AND name NOT LIKE '%.%' OR name='followingWork'").fetchall()
                    for name, n in tables:
                        query = 'SELECT count(*) FROM r WHERE t=?' + (" AND json_extract(data,'$.Row.status.String')='pending'" if name=='followingWork' else '')
                        row['queues'][name] = c.execute(query,[n]).fetchone()[0]
                    row['queues']['jobs'] = c.execute("SELECT count(*) FROM _jobs WHERE state NOT IN ('done','parked')").fetchone()[0]
                    row['parkedFollowing'] = c.execute("SELECT count(*) FROM r JOIN _catalog c ON r.t=c.num WHERE c.name='followingWork' AND json_extract(data,'$.Row.status.String')='parked'").fetchone()[0]
                    row['lastCommit'] = c.execute('SELECT seq,program,kind,at FROM _commits ORDER BY seq DESC LIMIT 1').fetchone()
            except sqlite3.Error as e: row['queueError'] = str(e)
        row['sampleSeconds'] = time.monotonic() - start
        out.write(json.dumps(row)+'\n'); out.flush()
        iteration += 1
        time.sleep(max(0, .25-(time.monotonic()-start)))
