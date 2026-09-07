"""Finite local-only runner, derived from the existing witness's actual wait receipts."""
from pathlib import Path
import importlib.util
import json
import os
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent


def main():
    assert sys.argv[1:] == ['--execute-root-approved']
    spec = importlib.util.spec_from_file_location('regression', ROOT / 'regression.py')
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    g.admit()
    w = json.loads((ROOT / 'workload.json').read_text())
    assert [x['case'] for x in w['commands']] == list(g.CASES)
    h = g.load('candidate-helper.py')
    out = ROOT / 'execution'
    out.mkdir(mode=0o700)  # One immutable attempt, no occupied-output reuse.
    g.write(out / 'owner.json', {'pid': os.getpid(), 'identity': h.identity(os.getpid()),
                               'manifestSha256': g.digest(ROOT / 'input-manifest.json')})
    start = time.monotonic()
    results = []
    summary = {'ok': False, 'commands': results, 'startedEpoch': time.time(),
               'outerSeconds': 100, 'automaticRetry': False}
    try:
        for command in w['commands']:
            case = command['case']
            assert command['timeoutSeconds'] == 15
            expected = [w['python']['path'], '-I', '-B', str(ROOT / 'regression.py'),
                        '--execute-root-approved', '--case', case]
            assert command['argv'] == expected and command['cwd'] == str(ROOT)
            case_start = time.monotonic()
            record = {'case': case, 'argv': expected, 'cwd': str(ROOT), 'timeoutSeconds': 15,
                      'startedEpoch': time.time(), 'actualReturnCode': None, 'exitCode': None}
            log = out / (case + '.outer.log')
            running = out / (case + '.running.json')
            with log.open('xb') as stream:
                child = subprocess.Popen(expected, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                                         stdin=subprocess.DEVNULL, start_new_session=True,
                                         env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
                record.update(pid=child.pid, processIdentity=h.identity(child.pid), processGroup=child.pid)
                g.write(running, record)
                try:
                    code = child.wait(timeout=max(0, min(15 - (time.monotonic() - case_start),
                                                       100 - (time.monotonic() - start))))
                except subprocess.TimeoutExpired:
                    code = 124
                    record['timedOut'] = True
                    record['cleanup'] = []
                    probe = out / case / 'receipts/probe.running.json'
                    owned = [json.loads(probe.read_text())] if probe.exists() else []
                    if child.poll() is None:
                        owned.append(record.copy())
                    for owner in owned:
                        item = {'pid': owner['pid']}
                        try:
                            h.kill_owned_group(owner)
                            item['signal'] = 'SIGKILL'
                        except Exception as exc:
                            item['refusal'] = {'type': type(exc).__name__, 'message': str(exc)}
                        record['cleanup'].append(item)
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        record['cleanupUnknown'] = True
                record.update(exitCode=code, actualReturnCode=child.returncode,
                              actualProcessWaitCompleted=child.returncode is not None)
            record.update(endedEpoch=time.time(), elapsedSeconds=time.monotonic() - case_start,
                          logSha256=g.digest(log))
            g.write(out / (case + '.terminal.json'), record)
            if record['actualProcessWaitCompleted']:
                running.unlink()
            results.append(record)
            assert code == 0, 'first regression failure; no retry or subsequent case'
            assert json.loads((out / case / 'result.json').read_text())['ok'] is True
        g.admit()  # Original helper/log/failure and immutable input hashes stay exact.
        summary['ok'] = True
    except BaseException as exc:
        summary['failure'] = {'type': type(exc).__name__, 'message': str(exc)}
        raise
    finally:
        summary.update(endedEpoch=time.time(), elapsedSeconds=time.monotonic() - start)
        g.write(out / 'REPORT.json', summary)


if __name__ == '__main__':
    main()
