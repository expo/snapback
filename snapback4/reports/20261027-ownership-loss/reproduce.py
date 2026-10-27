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
import select
import shutil
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
    fault = parser.add_mutually_exclusive_group()
    fault.add_argument('--stalled-stderr', action='store_true', help='fill the serving owner stderr pipe and stop reading it before COMMIT')
    fault.add_argument('--deploy-unknown', action='store_true', help='unknown durable activation must reconcile before short-lived deploy returns')
    args = parser.parse_args()
    assert not (args.deploy_unknown and (args.early or args.abort_before_commit))
    assert not (args.stalled_stderr and (args.early or args.abort_before_commit))
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
    pipes = []
    result = {'namespace': namespace, 'mode': 'E' if args.early else 'S', 'pids': [], 'pass': False}

    def sql(statement):
        reply = subprocess.run([str(args.psql), connection, '-v', 'ON_ERROR_STOP=1', '-Atc', statement],
                               capture_output=True, text=True, check=True, timeout=15)
        return reply.stdout.strip()

    def start(label):
        out, err = args.out / (label + '.out'), args.out / (label + '.err')
        stalled = args.stalled_stderr and label == 'first'
        if stalled:
            reader, writer = os.pipe()
            pipes.extend([reader, writer])
        with out.open('w') as stdout, err.open('w') as stderr:
            child = subprocess.Popen([str(args.bin.resolve()), 'serve', str(work / 'deployment'),
                                      '--worker-state-dir', str(work / 'workers'), '--port', '0'],
                                     cwd=work, env=env, stdout=stdout, stderr=writer if stalled else stderr)
        children.append(child)
        result['pids'].append(child.pid)
        (args.out / 'pids.json').write_text(json.dumps(result['pids']))
        deadline = time.monotonic() + 30
        startup = b''
        while 'SNAPBACK4_READY' not in err.read_text():
            assert child.poll() is None, 'owner exited before readiness'
            assert time.monotonic() < deadline, 'owner readiness timed out'
            if stalled and select.select([reader], [], [], .02)[0]:
                startup += os.read(reader, 65536)
                err.write_bytes(startup)
            else:
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
        if args.deploy_unknown:
            # The sequence is visible before COMMIT. Queue a metadata reader
            # blocker behind activation, then hold the reconciliation probe for
            # 300 ms. This makes the old 10 ms watchdog race deterministic.
            sql(f'''CREATE SEQUENCE {namespace}.activation_ready MINVALUE 0 START 0;
                CREATE TABLE {namespace}.activation_fault (id int PRIMARY KEY);
                CREATE FUNCTION {namespace}.uncertain_activation() RETURNS trigger LANGUAGE plpgsql AS $$
                DECLARE until_at timestamptz := clock_timestamp()+interval '10 seconds';
                BEGIN
                  PERFORM setval('{namespace}.activation_ready',1);
                  LOOP
                    PERFORM pg_stat_clear_snapshot();
                    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
                      WHERE l.relation='{namespace}._meta'::regclass AND NOT l.granted
                      AND a.application_name='{namespace}_probe');
                    IF clock_timestamp()>until_at THEN RAISE EXCEPTION 'probe blocker not queued'; END IF;
                    PERFORM pg_sleep(0.01);
                  END LOOP;
                  RAISE WARNING 'injected uncertain activation acknowledgement' USING ERRCODE='57014';
                  RETURN NEW;
                END $$;
                CREATE CONSTRAINT TRIGGER uncertain_activation AFTER INSERT ON {namespace}.activation_fault
                DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION {namespace}.uncertain_activation();
                CREATE FUNCTION {namespace}.queue_activation_fault() RETURNS event_trigger LANGUAGE plpgsql AS $$
                BEGIN
                  IF current_schema()='{namespace}' AND current_query() NOT LIKE '%_read_grant%' THEN
                    INSERT INTO {namespace}.activation_fault VALUES(1) ON CONFLICT DO NOTHING;
                  END IF;
                END $$;
                CREATE EVENT TRIGGER {namespace}_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE')
                EXECUTE FUNCTION {namespace}.queue_activation_fault()''')
            # A changed program, with the same admitted schema, creates release 2.
            source = work / 'snapback/schema.q'
            source.write_text(source.read_text() + 'query version():\n  return 2\n')
            with (args.out / 'unknown-deploy.out').open('w') as stdout, (args.out / 'unknown-deploy.err').open('w') as stderr:
                deploy = subprocess.Popen([str(args.bin.resolve()), 'deploy', str(work / 'deployment'), '--json'],
                                          cwd=work, env=env, stdout=stdout, stderr=stderr)
            children.append(deploy)
            result['pids'].append(deploy.pid)
            deadline = time.monotonic() + 45
            while sql(f'SELECT last_value FROM {namespace}.activation_ready') != '1':
                assert deploy.poll() is None, 'deploy exited before activation'
                assert time.monotonic() < deadline, 'activation did not reach COMMIT'
                time.sleep(.01)
            with (args.out / 'probe-blocker.out').open('w') as stdout, (args.out / 'probe-blocker.err').open('w') as stderr:
                blocker = subprocess.Popen([str(args.psql), connection + f' application_name={namespace}_probe',
                    '-v', 'ON_ERROR_STOP=1', '-Atc', f"BEGIN; SET LOCAL lock_timeout='5s'; LOCK TABLE {namespace}._meta IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(0.3); COMMIT"],
                    stdout=stdout, stderr=stderr)
            children.append(blocker)
            result['pids'].append(blocker.pid)
            (args.out / 'pids.json').write_text(json.dumps(result['pids']))
            result['deploy_exit'] = deploy.wait(timeout=20)
            assert blocker.wait(timeout=10) == 0
            result['pointer'] = (work / 'deployment/current').read_text().strip()
            events = [json.loads(line) for line in (work / 'deployment/releases.jsonl').read_text().splitlines()]
            result['release_log'] = events[-1]
            result['selection'] = sql(f"SELECT value FROM {namespace}._meta WHERE key='release'")
            result['lease_released'] = sql(f"SELECT lease_until='-infinity'::timestamptz FROM {namespace}._owner") == 't'
            assert result['deploy_exit'] == 0, 'short-lived deploy was killed before unknown activation reconciliation'
            output = json.loads((args.out / 'unknown-deploy.out').read_text())
            assert output['resolvedUnknownCommit'] is True and output['release'] == 2
            assert result['pointer'] == result['selection'] == '2'
            assert events[-1]['release'] == 2 and events[-1]['state'] == 'activated'
            assert result['lease_released'], 'short-lived deploy must release its lease on drop'
            assert not list((work / 'deployment').glob('.current-*')), 'no staged pointer remains'
            result['pass'] = True
            return
        child, base, err = start('first')
        token = http(base, '/auth/guest', {})[1]['session']['token']
        for _ in range(6):
            status, body = http(base, '/m/change', {'args': {}}, token)
            assert status == 200 and body['state'] == 'sent'
        acquired_token = sql(f'SELECT token FROM {namespace}._owner')
        if args.stalled_stderr:
            # Fill exactly the child's real pipe, then restore blocking mode.
            # Keep both ends open and never read again until the owner exits.
            writer = pipes[1]
            os.set_blocking(writer, False)
            filled = 0
            try:
                while True:
                    filled += os.write(writer, b'x' * 4096)
            except BlockingIOError:
                pass
            finally:
                os.set_blocking(writer, True)
            assert filled > 0
            result['stalled_stderr_bytes'] = filled
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
        fault_started = time.monotonic()
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
        result['exit_seconds'] = round(time.monotonic() - fault_started, 3)
        result['ownership_lines'] = err.read_text().count('E_STORE_OWNERSHIP:')
        result['audit'] = sql(f'''SELECT (SELECT seq FROM {namespace}._head),
            (SELECT max(seq) FROM {namespace}._commits),(SELECT count(*) FROM {namespace}._commits),
            token,lease_until>clock_timestamp() FROM {namespace}._owner''')
        assert result['audit'].split('|')[3:] == [acquired_token, 't'], 'loss must neither replace the claim nor release/shorten its live lease'
        if args.abort_before_commit:
            result['terminated_data_backend'] = int(sql(f'SELECT last_value FROM {namespace}.terminated_backend'))
        if not result['owner_exited'] and not args.early and not args.stalled_stderr:
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
        if args.stalled_stderr:
            assert result['exit_seconds'] < 2, 'stalled diagnostics must not delay fail-stop'
        else:
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
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                # A baseline wedged on stderr may also wedge graceful shutdown.
                child.kill()
                child.wait(timeout=10)
        result['pids_left'] = [c.pid for c in children if c.poll() is None]
        for fd in pipes:
            os.close(fd)
        (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        if args.deploy_unknown:
            sql(f'DROP EVENT TRIGGER IF EXISTS {namespace}_fault')
        sql(f'DROP SCHEMA IF EXISTS {namespace} CASCADE')
        shutil.rmtree(work)
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
