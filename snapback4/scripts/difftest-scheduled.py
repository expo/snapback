#!/usr/bin/env python3
"""Rotating Quarry campaigns in a dedicated checkout; state lives outside Git."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('tickets', Path(__file__).with_name('difftest-tickets.py'))
tickets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tickets)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def run(command, *, cwd=None, log=None, env=None, timeout=None, supervise=False):
    """Own each command's process group, including the Rust campaign workers."""
    stream = log.open('w') if log else None
    child = subprocess.Popen([str(v) for v in command], cwd=cwd, env=env,
                             stdout=stream, stderr=subprocess.STDOUT if stream else None,
                             start_new_session=True)
    status = None
    try:
        status = child.wait(timeout=timeout)
        return status
    finally:
        # The group was created by this launch. Never select processes by name.
        # Even a normally exited parent can leave a worker after a crash.
        if supervise or status != 0:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        child.wait()
        if stream:
            stream.close()


def must(command, **kwargs):
    status = run(command, **kwargs)
    if status:
        raise RuntimeError(f'command failed ({status}): {command[0]}; see run logs')


def clean_fast_forward(checkout):
    if not (checkout / '.git').is_dir():
        raise RuntimeError('dedicated checkout must be an existing independent clone (.git directory)')
    if tickets.git(checkout, 'status', '--porcelain', '--untracked-files=all').stdout:
        raise RuntimeError(f'REFUSED: dedicated checkout is dirty: {checkout}')
    tickets.git(checkout, 'symbolic-ref', '--quiet', 'HEAD')
    tickets.git(checkout, 'fetch', 'origin')
    if tickets.git(checkout, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main', check=False).returncode:
        raise RuntimeError('REFUSED: dedicated checkout cannot fast-forward to origin/main')
    tickets.git(checkout, 'merge', '--ff-only', 'origin/main')
    return tickets.git(checkout, 'rev-parse', 'HEAD').stdout.strip()


DEVICE_STORES = ['sqlite', 'memory']


def validate_report(path, cases, stores=False, devices=False):
    report = json.loads(path.read_text())
    if report['cases'] != cases or report['generated'] != cases or report['compiled'] != cases:
        raise RuntimeError(f'incomplete campaign: {path}')
    if report['generator_errors'] or report['binder_refused_unexpected'] or report['runtime_refused_unexpected']:
        raise RuntimeError(f'campaign setup or unexpected refusal: {path}')
    if devices:
        # Every case is one read or one write per device store (LLP 3000.035 §5.1 oracle 4).
        for store in DEVICE_STORES:
            counts = {phase: report['by_oracle'].get(f'device-{store}-{phase}', {}) for phase in ['read', 'write', 'cut']}
            if counts['read'].get('attempted', 0) + counts['write'].get('attempted', 0) < cases:
                raise RuntimeError(f'missing oracle work: device-{store}')
            for phase in ['read', 'cut']:
                if counts[phase].get('passed', 0) + counts[phase].get('disagreeing', 0) == 0:
                    raise RuntimeError(f'no supported work: device-{store}-{phase}')
        return sum(c['disagreeing'] for c in report['by_oracle'].values())
    for name in (['store-postgres-on', 'store-postgres-off'] if stores else ['repeat', 'meter']):
        counts = report['by_oracle'].get(name, {})
        if counts.get('attempted', 0) < cases:
            raise RuntimeError(f'missing oracle work: {name}')
        if counts.get('passed', 0) + counts.get('disagreeing', 0) == 0:
            raise RuntimeError(f'no supported work: {name}')
    return sum(c['disagreeing'] for c in report['by_oracle'].values())


def interrupted(number, _frame):
    raise InterruptedError(f'signal {number}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.snapback-quarry-difftest')
    size = parser.add_mutually_exclusive_group()
    size.add_argument('--cases', type=int, help='explicit case count; otherwise calibrate to --hours')
    size.add_argument('--hours', type=float, default=3.0, help='campaign budget estimated from a 256-case calibration (default: 3)')
    parser.add_argument('--external-postgres', help='dry-run only: supplied connection, never started or stopped')
    parser.add_argument('--workers', type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument('--dry-run', action='store_true', help='allow a short campaign; tickets go to previews, no commit or push')
    parser.add_argument('--prepared-commit', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if (args.cases is not None and args.cases < 1) or args.hours <= 0 or not 1 <= args.workers <= 64:
        parser.error('require positive cases/hours and 1..64 workers')
    if args.external_postgres and not args.dry_run:
        parser.error('--external-postgres is restricted to --dry-run')
    checkout, state = args.checkout.resolve(), args.state_dir.resolve()
    if state == checkout or checkout in state.parents:
        parser.error('state directory must be outside the checkout')
    state.mkdir(parents=True, exist_ok=True)
    # The refreshed runner is exec'd under the same exclusive lock.
    lock = state / 'lock'
    if not args.prepared_commit:
        lock.mkdir()  # Refuse overlap or an uncleared crash; never guess ownership.
        (lock / 'owner.json').write_text(json.dumps({'pid': os.getpid(), 'host': platform.node()}))
    cluster = None
    report = None
    destination = None
    try:
        if not args.prepared_commit:
            commit = clean_fast_forward(checkout)
            script = checkout / 'snapback4/scripts/difftest-scheduled.py'
            if not script.is_file():
                raise RuntimeError('origin/main has no scheduled runner; no work skipped as green')
            os.execv(sys.executable, [sys.executable, str(script), *sys.argv[1:], '--prepared-commit', commit])
        commit = tickets.git(checkout, 'rev-parse', 'HEAD').stdout.strip()
        if commit != args.prepared_commit or tickets.git(checkout, 'status', '--porcelain').stdout:
            raise RuntimeError('checkout changed after fast-forward')
        owner = json.loads((lock / 'owner.json').read_text())
        if owner != {'pid': os.getpid(), 'host': platform.node()}:
            raise RuntimeError('scheduled lock is not owned by this process')
        seed_file = state / ('next-seed.dry-run.json' if args.dry_run else 'next-seed.json')
        saved = json.loads(seed_file.read_text()) if seed_file.exists() else {'version': 1, 'next_seed': 0}
        seed = saved['next_seed']
        if saved.get('version') != 1 or not isinstance(seed, int) or not 0 <= seed < 2**64 or seed + (args.cases or 256) > 2**64:
            raise RuntimeError('invalid seed state or exhausted u64 window')
        run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        destination = state / 'runs' / run_id
        destination.mkdir(parents=True)
        report = {'version': 1, 'run_id': run_id, 'status': 'running', 'commit': commit,
                  'seed': seed, 'cases': args.cases, 'last_seed': seed + args.cases - 1 if args.cases else None,
                  'workers': args.workers, 'dry_run': args.dry_run, 'host': platform.platform(),
                  'started': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        atomic_json(destination / 'run.json', report)
        for tool, command in [('rustc', ['rustc', '-Vv']), ('cargo', ['cargo', '-V']), ('postgres', ['pg_ctl', '--version'])]:
            report[tool] = subprocess.check_output(command, text=True).strip()
        if args.external_postgres:
            env = dict(os.environ, SNAPBACK4_EVAL_POSTGRES=args.external_postgres)
            must(['psql', args.external_postgres, '-Atc', 'select 1'], log=destination / 'pg-connect.log', timeout=15)
            report['cluster'] = 'external (operator owned)'
        else:
            cluster = Path(tempfile.mkdtemp(prefix='sb4-difftest-', dir='/tmp'))
            report['cluster'] = str(cluster)
            must(['initdb', '-D', cluster / 'data', '-U', 'sb4_eval', '--auth-local=trust',
                  '--auth-host=reject', '--encoding=UTF8', '--no-locale'], log=destination / 'initdb.log', timeout=120)
            must(['pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log', '-o',
                  f'-k {cluster} -c listen_addresses= -p 55439 -c fsync=off -c synchronous_commit=off '
                  '-c full_page_writes=off -c shared_buffers=1GB -c max_connections=200', '-w', 'start'],
                  log=destination / 'pg-start.log', timeout=120)
            env = dict(os.environ, SNAPBACK4_EVAL_POSTGRES=f'host={cluster} port=55439 user=sb4_eval dbname=postgres')
        workspace = checkout / 'snapback4'
        must(['cargo', 'build', '--locked', '--release', '-p', 'snapback4-difftest', '--features', 'postgres'],
             cwd=workspace, log=destination / 'build.log', env=env)
        # Cargo may honor a caller's target-dir; ask it instead of guessing.
        metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--no-deps', '--format-version', '1'], cwd=workspace, env=env))
        binary = Path(metadata['target_directory']) / 'release/snapback4-difftest'
        report['binary_sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
        started = time.monotonic()
        if args.cases is None:
            calibration_started = time.monotonic()
            for command, directory in [('run', 'calibration-sqlite'), ('run-stores', 'calibration-stores'), ('run-devices', 'calibration-devices')]:
                output = destination / directory
                status = run([binary, command, '--seed', seed, '--cases', 256, '--workers', args.workers, '--out', output],
                             cwd=workspace, env=env, log=destination / f'{directory}.log', supervise=True)
                if status not in (0, 1):
                    raise RuntimeError(f'{command}: calibration failed with status {status}')
                count = validate_report(output / 'report.json', 256, command == 'run-stores', command == 'run-devices')
                if bool(status) != bool(count):
                    raise RuntimeError('calibration exit status disagrees with report')
            calibration_seconds = time.monotonic() - calibration_started
            rate = 256 / max(calibration_seconds, 0.001)
            # Calibration is an estimate, with 20% headroom for tail cases.
            args.cases = min(1_000_000, max(256, int(max(0, args.hours*3600-calibration_seconds)*rate*0.8)))
            if seed + args.cases > 2**64:
                raise RuntimeError('calibrated window exhausts u64 seeds')
            report.update(cases=args.cases, last_seed=seed+args.cases-1,
                          sizing={'hours':args.hours, 'calibration_cases':256, 'seconds':calibration_seconds,
                                  'cases_per_hour':rate*3600, 'headroom':0.2, 'kind':'estimate, not a hard timeout'})
            atomic_json(destination / 'run.json', report)
        disagreements = 0
        store_unsupported = 0
        device_unsupported = 0
        for command, directory in [('run', 'sqlite'), ('run-stores', 'stores'), ('run-devices', 'devices')]:
            output = destination / directory
            status = run([binary, command, '--seed', seed, '--cases', args.cases, '--workers', args.workers, '--out', output],
                         cwd=workspace, env=env, log=destination / f'{directory}.log', supervise=True)
            if status not in (0, 1):
                raise RuntimeError(f'{command} failed with status {status}; no completed run')
            count = validate_report(output / 'report.json', args.cases, directory == 'stores', directory == 'devices')
            if bool(status) != bool(count):
                raise RuntimeError(f'{command}: exit status disagrees with report')
            disagreements += count
            if directory == 'stores':
                counts=json.loads((output / 'report.json').read_text())['by_oracle']
                store_unsupported=sum(sum(c.get('unsupported',{}).values()) for c in counts.values())
            if directory == 'devices':
                # Online-only reads and unpredictable writes are the device's named
                # reasons, expected in every run: recorded, never a pass, not a failure.
                counts=json.loads((output / 'report.json').read_text())['by_oracle']
                device_unsupported=sum(sum(c.get('unsupported',{}).values()) for c in counts.values())
        report['seconds'] = time.monotonic() - started
        report['cases_per_hour'] = args.cases * 3600 / report['seconds']
        # Stable replay inherits the private cluster only for this scoped call.
        os.environ['SNAPBACK4_EVAL_POSTGRES'] = env['SNAPBACK4_EVAL_POSTGRES']
        paths = tickets.file_tickets(checkout, destination, commit, run_id, binary=binary,
                                     output=destination / 'preview' if args.dry_run else None)
        report['tickets'] = [str(p) for p in paths]
        if not args.dry_run:
            tickets.publish(checkout, paths)
        report['disagreements'] = disagreements
        report['store_unsupported'] = store_unsupported
        report['device_unsupported'] = device_unsupported
        # Stop before advancing the seed: a failed cleanup is a failed run.
        if cluster is not None:
            must(['pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'], log=destination / 'pg-stop.log', timeout=120)
            cluster = None
        atomic_json(seed_file, {'version': 1, 'next_seed': seed + args.cases})
        report['status'] = 'completed-with-findings' if disagreements else 'completed-with-unsupported' if store_unsupported else 'completed'
        atomic_json(destination / 'run.json', report)
        print(json.dumps(report, indent=2))
        return 1 if disagreements or store_unsupported else 0
    except BaseException as error:
        if report is not None:
            report['status'] = 'failed'
            report['error'] = str(error)
            atomic_json(destination / 'run.json', report)
        print(f'Quarry scheduled run FAILED: {error}', file=sys.stderr)
        return 2
    finally:
        if cluster and (cluster / 'data/postmaster.pid').exists():
            # pg_ctl identifies exactly the private data directory created above.
            status = run(['pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'], timeout=120)
            if status:
                print(f'Private cluster cleanup FAILED: {cluster}', file=sys.stderr)
        if (lock / 'owner.json').exists():
            owner = json.loads((lock / 'owner.json').read_text())
            if owner == {'pid': os.getpid(), 'host': platform.node()}:
                (lock / 'owner.json').unlink()
                lock.rmdir()


if __name__ == '__main__':
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    sys.exit(main())
