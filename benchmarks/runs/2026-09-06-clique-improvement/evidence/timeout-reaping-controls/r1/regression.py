"""Six finite measurement-only controls. Execution requires separate Root approval."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import select
import signal
import subprocess
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
CASES = ('parent-exit-during-identity', 'candidate-exit-during-identity',
         'candidate-live-matching-group', 'candidate-changed-identity',
         'candidate-disappears-before-group-query', 'candidate-before-deadline')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    with Path(path).open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def admit():
    approval = json.loads((ROOT / 'root-approval.json').read_text())
    assert approval['approved'] is True and approval['regressionAuthorized'] is True
    assert approval['manifestSha256'] == digest(ROOT / 'input-manifest.json')
    manifest = json.loads((ROOT / 'input-manifest.json').read_text())
    for row in manifest['files']:
        path = ROOT / row['path']
        assert path.is_file() and not path.is_symlink()
        assert digest(path) == row['sha256'] and path.stat().st_size == row['bytes']
        assert path.stat().st_mode & 0o777 == row['mode']
    assert sys.platform == 'darwin', 'NOTE_EXIT instrumentation is Office Darwin only'
    tools = json.loads((ROOT / 'workload.json').read_text())['python']
    assert Path(sys.executable).resolve() == Path(tools['path']).resolve()
    assert digest(Path(tools['path'])) == tools['sha256']
    original = json.loads((ROOT / 'original-evidence.json').read_text())
    assert not Path(original['originalMissingTerminalReceipt']).exists()
    for row in [original['originalHelper'], original['originalRunner'], *original['files']]:
        assert digest(row['path']) == row['sha256'], row['path']
        if 'snapshot' in row:
            assert digest(ROOT / row['snapshot']) == row['sha256']
    return original


def load(name):
    spec = importlib.util.spec_from_file_location('controlled_helper', ROOT / name)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)  # Only after approval; main/preflight never called.
    return helper


def run_case(case):
    original = admit()
    assert case in CASES
    out = ROOT / 'execution' / case
    out.mkdir()
    (out / 'receipts').mkdir()
    for name in ('ready', 'gate'):
        os.mkfifo(out / name, 0o600)
    ready = os.open(out / 'ready', os.O_RDWR | os.O_NONBLOCK)
    gate = os.open(out / 'gate', os.O_RDWR | os.O_NONBLOCK)
    helper = load('parent-helper.py' if case.startswith('parent-') else 'candidate-helper.py')
    real_identity = helper.identity
    state = {'identityCalls': 0, 'signals': [], 'exitEventsWithoutReaping': 0,
             'syntheticDeadline': case != 'candidate-before-deadline'}
    owned = []
    clock_start = time.monotonic()
    clock_calls = [0]
    checks = []
    result = {'case': case, 'ok': False, 'startedEpoch': time.time(),
              'helper': 'parent-helper.py' if case.startswith('parent-') else 'candidate-helper.py',
              'scope': 'controlled measurement regression; never an install or017 qualification'}

    def clock():
        clock_calls[0] += 1
        if not state['syntheticDeadline']:
            return time.monotonic()
        return clock_start + (0 if clock_calls[0] == 1 else 31)

    def popen(*args, **kwargs):
        assert len(owned) == 0, 'one actual controlled child per case'
        child = subprocess.Popen(*args, **kwargs)
        owned.append(child)
        return child

    def exit_during_inspection():
        child = owned[0]
        # Observe actual kernel exit without poll/wait, leaving reaping to execute().
        with select.kqueue() as queue:
            event = select.kevent(child.pid, filter=select.KQ_FILTER_PROC,
                                 flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_ONESHOT,
                                 fflags=select.KQ_NOTE_EXIT)
            queue.control([event], 0, 0)
            os.write(gate, b'0')
            observed = queue.control(None, 1, 3)
        assert len(observed) == 1 and observed[0].fflags & select.KQ_NOTE_EXIT
        assert child.returncode is None, 'instrumentation must not reap the child'
        state['exitEventsWithoutReaping'] += 1

    def identity(pid):
        state['identityCalls'] += 1
        assert pid == owned[0].pid
        if state['identityCalls'] == 1:
            readable, _, _ = select.select([ready], [], [], 3)
            assert readable and os.read(ready, 1) == b'R'
            actual = real_identity(pid)
            assert actual and os.getpgid(pid) == pid
            state['originalIdentity'] = actual
            if case == 'candidate-before-deadline':
                os.write(gate, b'0')
            return actual
        assert state['identityCalls'] == 2
        if case.endswith('exit-during-identity'):
            exit_during_inspection()
            return ''
        if case == 'candidate-changed-identity':
            return str(pid) + ' deliberately changed start identity'
        return real_identity(pid)

    def getpgid(pid):
        assert pid == owned[0].pid
        if case == 'candidate-disappears-before-group-query':
            exit_during_inspection()
            raise ProcessLookupError('controlled disappearance after matching identity')
        return os.getpgid(pid)

    def killpg(pgid, sig):
        state['signals'].append({'pgid': pgid, 'signal': sig})
        assert case == 'candidate-live-matching-group', 'no signal permitted for refused/disappeared identity'
        assert pgid == owned[0].pid and sig == signal.SIGKILL
        assert owned[0].poll() is None and os.getpgid(pgid) == pgid
        os.killpg(pgid, sig)

    # Module-local instrumentation; real Popen and real wait() are never replaced.
    helper.subprocess = SimpleNamespace(Popen=popen, STDOUT=subprocess.STDOUT,
                                        TimeoutExpired=subprocess.TimeoutExpired, run=subprocess.run)
    helper.time = SimpleNamespace(monotonic=clock, time=time.time)
    helper.identity = identity
    helper.os = SimpleNamespace(getpgid=getpgid, killpg=killpg)
    python = json.loads((ROOT / 'workload.json').read_text())['python']['path']
    argv = [python, '-I', '-B', str(ROOT / 'controlled-child.py'), str(out / 'ready'), str(out / 'gate')]
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
    try:
        error = None
        try:
            helper.execute(out, 'probe', argv, out, env, checks)
        except RuntimeError as exc:
            error = {'type': type(exc).__name__, 'message': str(exc)}
        child = owned[0]
        receipt = out / 'receipts/probe.json'
        running = out / 'receipts/probe.running.json'
        log = out / 'receipts/probe.log'
        if case.startswith('parent-'):
            assert error and 'identity unavailable/changed' in error['message']
            assert not receipt.exists() and running.exists() and checks == []
            assert state['exitEventsWithoutReaping'] == 1 and child.returncode is None
            assert child.wait(timeout=3) == 0
            result['parentOmittedReceiptReproduced'] = True
        else:
            row = json.loads(receipt.read_text())
            assert checks == [row] and row['argv'] == argv and row['timeoutSeconds'] == 30
            assert row['logSha256'] == digest(log)
            if case == 'candidate-before-deadline':
                assert error is None and row['exitCode'] == row['actualReturnCode'] == 0
                assert row['actualProcessWaitCompleted'] and not row.get('timedOut', False)
            else:
                assert error and row['exitCode'] == 124 and row['timedOut'] is True
                if case == 'candidate-changed-identity':
                    assert row['actualReturnCode'] is None and not row['actualProcessWaitCompleted']
                    assert row['logComplete'] is False
                    assert row['cleanupUnknown'] is True and running.exists()
                    assert row['cleanupFailure']['message'] == 'process identity unavailable/changed'
                    assert child.poll() is None and state['signals'] == []
                    recorded = receipt.read_bytes()
                    os.write(gate, b'0')
                    assert child.wait(timeout=3) == 0
                    assert receipt.read_bytes() == recorded, 'later control exit cannot rewrite unknown receipt'
                    result['controllerLaterExitCode'] = 0
                else:
                    expected = -signal.SIGKILL if case == 'candidate-live-matching-group' else 0
                    assert row['actualReturnCode'] == expected and row['actualProcessWaitCompleted']
                    assert child.returncode == expected
                    if expected == 0:
                        assert state['exitEventsWithoutReaping'] == 1 and row['cleanupFailure']
            if case != 'candidate-changed-identity':
                assert not running.exists() and row['logComplete'] is True
            result['helperReceipt'] = row
        if case == 'candidate-live-matching-group':
            assert state['signals'] == [{'pgid': child.pid, 'signal': signal.SIGKILL}]
        else:
            assert state['signals'] == []
        try:
            os.waitpid(child.pid, os.WNOHANG)
        except ChildProcessError:
            result['ownedChildActuallyReaped'] = True
        else:
            raise AssertionError('child not already reaped')
        try:
            os.killpg(child.pid, 0)
        except ProcessLookupError:
            result['ownedGroupAbsent'] = True
        else:
            raise AssertionError('owned group still present/unknown; no cleanup signal inferred')
        result.update(executeError=error, instrumentation=state,
                      childPid=child.pid, actualReturnCode=child.returncode,
                      retainedLogSha256=digest(log), runningReceiptRetained=running.exists())
        assert 'controlled child ready' in log.read_text()
        for row in original['files']:
            assert digest(row['path']) == row['sha256'] == digest(ROOT / row['snapshot'])
        result['ok'] = True
    except BaseException as exc:
        result['failure'] = {'type': type(exc).__name__, 'message': str(exc)}
        raise
    finally:
        # Independent test custody: release only this actual Popen child's FIFO.
        if owned:
            child = owned[0]
            if child.poll() is None:
                os.write(gate, b'0')
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()  # Direct unreaped own Popen child, never an identity substitution.
                    child.wait(timeout=2)
                    result['controllerEmergencyKill'] = True
            result['controllerFinalActualReturnCode'] = child.returncode
        os.close(ready)
        os.close(gate)
        result.update(endedEpoch=time.time(), wallSeconds=time.monotonic() - clock_start)
        write(out / 'result.json', result)


if __name__ == '__main__':
    assert sys.argv[1:2] == ['--execute-root-approved'] and len(sys.argv) == 4 and sys.argv[2] == '--case'
    run_case(sys.argv[3])
