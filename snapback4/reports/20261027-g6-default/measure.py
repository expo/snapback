#!/usr/bin/env python3
"""Paired product HTTP write diagnostic. Caller supplies/owns a private PG16/17.

No credentials, rows or request logs are retained. Only aggregates go to --out.
Startup stdout/stderr stay in the caller's private scratch directory. This is
an unrestricted shared-host diagnostic, not the S1 qualification harness.
"""
import argparse
import concurrent.futures
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.parse


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bin', type=Path, required=True)
    ap.add_argument('--psql', type=Path, required=True)
    ap.add_argument('--socket', type=Path, required=True)
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--user', default='g6d')
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--seconds', type=int, default=8)
    ap.add_argument('--rates', default='100,400,800')
    ap.add_argument('--arms', default='g5,g6,g6,g5,g5,g6')
    args = ap.parse_args()
    assert args.port >= 55600 and args.port != 55440
    work = Path(tempfile.mkdtemp(prefix='sb4-g6d-measure-'))
    (work / 'snapback').mkdir()
    (work / 'snapback/schema.q').write_text('''use identity
table counters:
  owner: principal
  n: int default 0
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation seed(counter: counters):
  upsert counters[counter] { owner: viewer, n: 0 }
mutation increment(counter: counters):
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] { n: c.n + 1 }
query readCounter(counter: counters):
  return counters[counter] ! else NOT_FOUND
''')
    connection = f'host={args.socket} port={args.port} user={args.user} dbname=postgres'
    children = []
    records = []

    def sql(statement):
        r = subprocess.run([str(args.psql), connection, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', statement],
                           check=True, capture_output=True, text=True, timeout=20)
        return r.stdout.strip()

    # Read only the caller-supplied cluster's own postmaster identity.
    data = Path(sql('SHOW data_directory'))
    master = int((data / 'postmaster.pid').read_text().splitlines()[0])

    def cpu():
        pending = [master]
        total = 0
        identities = []
        while pending:
            pid = pending.pop()
            try:
                fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                identities.append((pid, fields[19]))
                total += sum(int(fields[k]) for k in (11, 12, 13, 14))
                pending.extend(int(p) for p in Path(f'/proc/{pid}/task/{pid}/children').read_text().split())
            except FileNotFoundError:
                raise RuntimeError('PG CPU snapshot incomplete')
        return total / os.sysconf('SC_CLK_TCK'), identities

    def snapshot(ns):
        # Administrative observer statements are excluded from statement counts.
        return json.loads(sql(f'''SELECT json_build_object(
          'lsn',pg_current_wal_insert_lsn()::text,
          'counter',(SELECT sum((data::jsonb->'Row'->'n'->>'Int')::bigint) FROM {ns}.r WHERE t='counters'),
          'head',(SELECT seq FROM {ns}._head WHERE singleton),
          'calls',(SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE '%json_build_object%' AND query NOT LIKE 'SHOW %'),
          'grant_updates',(SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE query LIKE 'UPDATE _read_grant SET valid_until%'),
          'publication_queries',(SELECT coalesce(sum(calls),0) FROM pg_stat_statements WHERE query LIKE 'SELECT h.revision,h.seq,b.generation%'),
          'statement_wal',(SELECT coalesce(sum(wal_bytes),0) FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE '%json_build_object%'))'''))

    def request(conn, path, payload, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        conn.request('POST', path, json.dumps(payload), headers)
        reply = conn.getresponse()
        body = json.loads(reply.read())
        return reply.status, body

    def stop(child):
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()

    report = {'binary_sha256': hashlib.sha256(args.bin.read_bytes()).hexdigest(),
              'pg_version': sql('SHOW server_version'), 'scratch': str(work),
              'rates': [], 'pids': [], 'method': '32 disjoint counters; unkeyed HTTP; 2s warm; ABBAAB; synchronous durable PG; no affinity'}
    try:
        for rate in [int(x) for x in args.rates.split(',')]:
            for arm in args.arms.split(','):
                assert arm in ('g5', 'g6')
                if os.statvfs('/home').f_bavail * os.statvfs('/home').f_frsize < 60_000_000_000:
                    raise RuntimeError('/home free below 60GB')
                ns = f'g6d_cost_{os.getpid()}_{len(records)}'
                env = {k: v for k, v in os.environ.items() if not k.startswith('SNAPBACK4_')}
                env['SNAPBACK4_STORE_URL'] = f'postgres://{args.user}@/postgres?host={urllib.parse.quote(str(args.socket),safe="")}&port={args.port}&schema={ns}&ha=none'
                if arm == 'g6':
                    env['SNAPBACK4_READ_GRANT_CLOCK_BOUNDS'] = '1000,250'
                with (work / f'{ns}.deploy').open('w') as log:
                    subprocess.run([str(args.bin.resolve()), 'deploy', str(work / ns)], cwd=work,
                                   env=env, stdout=log, stderr=log, check=True, timeout=60)
                with (work / f'{ns}.out').open('w') as out, (work / f'{ns}.err').open('w') as err:
                    child = subprocess.Popen([str(args.bin.resolve()), 'serve', str(work / ns),
                                              '--worker-state-dir', str(work / (ns + '-workers')), '--port', '0'],
                                             cwd=work, env=env, stdout=out, stderr=err)
                children.append(child)
                report['pids'].append(child.pid)
                (work / 'pids.json').write_text(json.dumps(report['pids']))
                try:
                    limit = time.monotonic() + 30
                    while 'SNAPBACK4_READY' not in (work / f'{ns}.err').read_text():
                        assert child.poll() is None, f'startup failed; inspect {work}'
                        assert time.monotonic() < limit, 'readiness timeout'
                        time.sleep(.02)
                    base = urllib.parse.urlparse((work / f'{ns}.out').read_text().splitlines()[0])
                    admin = http.client.HTTPConnection(base.hostname, base.port, timeout=10)
                    status, guest = request(admin, '/auth/guest', {})
                    assert status == 200, status
                    token = guest['session']['token']
                    for i in range(32):
                        status, body = request(admin, '/m/seed', {'args': {'counter': f'c{i}'}}, token)
                        assert status == 200, body
                    admin.close()

                    def window(seconds):
                        start = time.monotonic() + .15
                        def worker(i):
                            conn = http.client.HTTPConnection(base.hostname, base.port, timeout=10)
                            lat, service, errors = [], [], {}
                            for index in range(i, rate * seconds, 32):
                                due = start + index / rate
                                time.sleep(max(0, due - time.monotonic()))
                                sent = time.monotonic()
                                status, body = request(conn, '/m/increment', {'args': {'counter': f'c{i}'}}, token)
                                finished = time.monotonic()
                                if status == 200:
                                    lat.append((finished - due) * 1000)
                                    service.append((finished - sent) * 1000)
                                else:
                                    key = str(status) + ':' + str(body.get('code', 'unknown'))
                                    errors[key] = errors.get(key, 0) + 1
                            conn.close()
                            return lat, service, errors
                        with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
                            results = list(pool.map(worker, range(32)))
                        lat = sorted(v for row in results for v in row[0])
                        svc = sorted(v for row in results for v in row[1])
                        errors = {}
                        for row in results:
                            for k, v in row[2].items():
                                errors[k] = errors.get(k, 0) + v
                        def quantile(values, p):
                            return values[min(len(values) - 1, math.ceil(len(values) * p) - 1)] if values else None
                        return {'acks': len(lat), 'errors': errors, 'duration_s': time.monotonic() - start,
                                'latency_ms': {str(p): quantile(lat, p) for p in (.5, .99)},
                                'service_ms': {str(p): quantile(svc, p) for p in (.5, .99)}}

                    window(2)
                    sql('SELECT pg_stat_statements_reset()')
                    before = snapshot(ns)
                    cpu0, ids0 = cpu()
                    load0 = os.getloadavg()
                    row = window(args.seconds)
                    cpu1, ids1 = cpu()
                    after = snapshot(ns)
                    acks = row['acks']
                    wal = int(sql(f"SELECT pg_wal_lsn_diff('{after['lsn']}', '{before['lsn']}')"))
                    assert after['counter'] - before['counter'] == acks, (before, after, row)
                    assert after['head'] - before['head'] == acks, (before, after, row)
                    first, last = dict(ids0), dict(ids1)
                    assert first[master] == last[master]
                    assert all(first[p] == last[p] for p in first.keys() & last.keys()), 'PG PID reused in CPU interval'
                    # Exited children (including the boundary psql observer)
                    # remain charged through their parent's cutime/cstime.
                    row.update(arm=arm, rate=rate, pg_cpu_us_per_ack=(cpu1 - cpu0) * 1e6 / acks,
                               wal_bytes_per_ack=wal / acks,
                               statement_wal_bytes_per_ack=(after['statement_wal'] - before['statement_wal']) / acks,
                               statements_per_ack=(after['calls'] - before['calls']) / acks,
                               grant_updates=after['grant_updates'] - before['grant_updates'],
                               publication_queries=after['publication_queries'] - before['publication_queries'],
                               load_before=load0, load_after=os.getloadavg(), accounting_equal=True)
                    records.append(row)
                    report['rates'] = records
                    args.out.write_text(json.dumps(report, indent=2) + '\n')
                    print(json.dumps(row), flush=True)
                finally:
                    stop(child)
                # Normal serve exit can leave its lease unexpired. Each arm uses
                # a different namespace, so no takeover/expiry wait enters timing.
    finally:
        for child in children:
            stop(child)
        report.update(pids_left=[p.pid for p in children if p.poll() is None])
        args.out.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
