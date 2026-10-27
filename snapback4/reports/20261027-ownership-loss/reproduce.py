#!/usr/bin/env python3
"""Deterministic public-owner lifecycle regression on an explicitly private PG.

The caller owns the cluster. This script creates one namespace, records/reaps
only its own CLI children, and never signals PostgreSQL. No credentials are
accepted or written. Requires a trust-authenticated private Unix socket.
"""
import argparse
from http.client import HTTPException
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bin', type=Path, required=True)
    parser.add_argument('--psql', type=Path, required=True)
    parser.add_argument('--socket', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--user', default='sb4_own')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--early', action='store_true', help='control: E must retain its fenced recovery')
    parser.add_argument('--abort-before-commit', action='store_true', help='lose the owned data backend; durable delta stays at six')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    namespace = f'own_loss_{os.getpid()}'
    connection = f'host={args.socket} port={args.port} user={args.user} dbname=postgres'
    url = f'postgres://{args.user}@/postgres?host={urllib.parse.quote(str(args.socket), safe="")}&port={args.port}&schema={namespace}&ha=none'
    if args.early:
        url += '&commit=early'
    env = {k: v for k, v in os.environ.items() if k not in (
        'SNAPBACK4_STORE_URL', 'SNAPBACK4_READ_GRANT_CLOCK_BOUNDS', 'SNAPBACK4_WORKER_STATE_DIR')}
    env.update(SNAPBACK4_STORE_URL=url, SNAPBACK4_READ_GRANT_CLOCK_BOUNDS='1000,250')
    work = Path(tempfile.mkdtemp(prefix='sb4-own-repro-'))
    (work / 'snapback').mkdir()
    (work / 'snapback/schema.q').write_text('''use identity
table counters:
  n: int
  public
  insert <- allow
  update <- allow
  online only
mutation change():
  upsert counters['c'] { n: (counters['c'].n ?? 0) + 1 }
  return counters['c'].n
''')
    children = []
    result = {'namespace': namespace, 'mode': 'E' if args.early else 'S', 'pids': [], 'pass': False}

    def sql(statement):
        reply = subprocess.run([str(args.psql), connection, '-v', 'ON_ERROR_STOP=1', '-Atc', statement],
                               capture_output=True, text=True, check=True, timeout=15)
        return reply.stdout.strip()

    def start(label):
        out, err = args.out / (label + '.out'), args.out / (label + '.err')
        with out.open('w') as stdout, err.open('w') as stderr:
            child = subprocess.Popen([str(args.bin.resolve()), 'serve', str(work / 'deployment'),
                                      '--worker-state-dir', str(work / 'workers'), '--port', '0'],
                                     cwd=work, env=env, stdout=stdout, stderr=stderr)
        children.append(child)
        result['pids'].append(child.pid)
        (args.out / 'pids.json').write_text(json.dumps(result['pids']))
        deadline = time.monotonic() + 30
        while 'SNAPBACK4_READY' not in err.read_text():
            assert child.poll() is None, 'owner exited before readiness'
            assert time.monotonic() < deadline, 'owner readiness timed out'
            time.sleep(.02)
        return child, out.read_text().splitlines()[0], err

    def http(base, path, payload, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(base + path, headers=headers, data=json.dumps(payload).encode())
        try:
            response = urllib.request.urlopen(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    try:
        with (args.out / 'deploy.out').open('w') as stdout, (args.out / 'deploy.err').open('w') as stderr:
            subprocess.run([str(args.bin.resolve()), 'deploy', str(work / 'deployment')],
                           cwd=work, env=env, stdout=stdout, stderr=stderr, check=True, timeout=45)
        child, base, err = start('first')
        token = http(base, '/auth/guest', {})[1]['session']['token']
        for _ in range(6):
            status, body = http(base, '/m/change', {'args': {}}, token)
            assert status == 200 and body['state'] == 'sent'
        # Only a data COMMIT warns. Lease maintenance never inserts _commits.
        # A cancellation warning makes a *durable* COMMIT acknowledgement
        # uncertain, exercising the genuine no-automatic-replay boundary.
        expected_count = 6 if args.abort_before_commit else 7
        if args.abort_before_commit:
            # A sequence records this owned backend's PID *before* it signals
            # itself. Unlike a table insert it survives that transaction's abort.
            sql(f'''CREATE SEQUENCE {namespace}.terminated_backend;
                CREATE FUNCTION {namespace}.uncertain_ack() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN PERFORM setval('{namespace}.terminated_backend',pg_backend_pid());
                  PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$;
                CREATE TRIGGER uncertain_ack BEFORE INSERT ON {namespace}._commits
                FOR EACH ROW EXECUTE FUNCTION {namespace}.uncertain_ack()''')
        else:
            sql(f'''CREATE FUNCTION {namespace}.uncertain_ack() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE WARNING 'injected uncertain acknowledgement' USING ERRCODE='57014'; RETURN NEW; END $$;
                CREATE CONSTRAINT TRIGGER uncertain_ack AFTER INSERT ON {namespace}._commits
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION {namespace}.uncertain_ack()''')
        try:
            status, body = http(base, '/m/change', {'args': {}}, token)
        except (OSError, HTTPException, urllib.error.URLError):
            # The watchdog may exit before the uncertain response is delivered.
            # A dropped acknowledgement also requires receipt reconciliation.
            result['first_error'] = 'transport_unconfirmed'
        else:
            why = body.get('why', body.get('denied', {}))
            assert why.get('code') == 'E_COMMIT_OUTCOME_UNKNOWN', (status, why.get('code'))
            result['first_error'] = why['code']
        deadline = time.monotonic() + 2
        while child.poll() is None and time.monotonic() < deadline:
            time.sleep(.02)
        result['owner_exited'] = child.poll() is not None
        result['ownership_lines'] = err.read_text().count('E_STORE_OWNERSHIP:')
        result['audit'] = sql(f'''SELECT (SELECT seq FROM {namespace}._head),
            (SELECT max(seq) FROM {namespace}._commits),(SELECT count(*) FROM {namespace}._commits),
            token,lease_until>clock_timestamp() FROM {namespace}._owner''')
        if args.abort_before_commit:
            result['terminated_data_backend'] = int(sql(f'SELECT last_value FROM {namespace}.terminated_backend'))
        if not result['owner_exited'] and not args.early:
            status, body = http(base, '/m/change', {'args': {}}, token)
            result['later_error'] = body.get('why', body.get('denied', {})).get('code')
        if args.early:
            assert not result['owner_exited'], 'E must retain its recoverable pause'
            assert result['audit'].split('|')[:3] == [str(expected_count)] * 3
            sql(f'DROP TRIGGER uncertain_ack ON {namespace}._commits; DROP FUNCTION {namespace}.uncertain_ack()')
            status, body = http(base, '/m/change', {'args': {}}, token)
            assert status == 200 and body['state'] == 'sent' and body['result'] == expected_count + 1
            result['recovered_in_process'] = True
            result['pass'] = True
            return
        assert result['owner_exited'], 'owner silently keeps its lease alive after terminal admission loss'
        child.wait()
        assert child.returncode != 0
        assert result['ownership_lines'] == 1, 'one reason line per terminal loss'
        assert result['audit'].split('|')[:3] == [str(expected_count)] * 3, 'audit must retain the original durable outcome'
        sql(f'DROP TRIGGER uncertain_ack ON {namespace}._commits; DROP FUNCTION {namespace}.uncertain_ack()')
        deadline = time.monotonic() + 6
        while sql(f'SELECT lease_until<clock_timestamp() FROM {namespace}._owner') != 't':
            assert time.monotonic() < deadline, 'dead owner lease did not expire'
            time.sleep(.05)
        successor, base, _ = start('successor')
        status, body = http(base, '/m/change', {'args': {}}, token)
        assert status == 200 and body['state'] == 'sent' and body['result'] == expected_count + 1
        result['pass'] = True
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=15)
        result['pids_left'] = [c.pid for c in children if c.poll() is None]
        (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        sql(f'DROP SCHEMA IF EXISTS {namespace} CASCADE')
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
