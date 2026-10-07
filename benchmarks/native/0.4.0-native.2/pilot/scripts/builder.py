#!/usr/bin/env python3
"""Detached Codex lifecycle, retained native transcript, external pilot ceilings."""
import argparse, shutil, sys
from common import *
from render import main as render
from verify import verify
from processes import ProcessOwner, TAG
from isolation import prepare as prepare_isolation, environment
import derived_data

def launch(b):
    host_check(); render(); verify(ready=True); free_ports(b)
    lane = ROOT / 'lanes' / b
    if sorted(p.name for p in lane.iterdir()) != ['instrument']: raise RuntimeError('builder-lane-not-cold')
    lease = lock('authoring-or-operator.lock')
    logs = ROOT / 'logs' / b; logs.mkdir()  # Reservation refuses every repeat, including failed launches.
    put(logs / 'caps.json', read(ROOT / 'metadata/caps.json'))
    cmd = [sys.executable, str(ROOT / 'scripts/builder.py'), 'run', b, '--lease-fd', str(lease.fileno())]
    with (logs / 'supervisor.log').open('xb') as f:
        process = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT,
                                   start_new_session=True, pass_fds=(lease.fileno(),))
    put(logs / 'supervisor.pid', str(process.pid) + '\n')
    put(logs / 'launch.json', {'at': time.time(), 'pid': process.pid, 'argv': cmd, 'detached': True})
    lease.close()  # Child holds the same locked descriptor; no launch race.
    print('detached builder supervisor:', b, process.pid)

def session_path(thread, codex_home=None):
    home = Path(codex_home) if codex_home else Path.home() / '.codex'
    roots = [home / 'sessions', home / 'archived_sessions']
    found = [p for r in roots if r.exists() for p in r.rglob('*' + thread + '*.jsonl')]
    if len(found) > 1: raise RuntimeError('ambiguous-native-session')
    return found[0] if found else None

def usage(native):
    adapter = WEB / 'tools/social-messenger/metering/adapters/codex-session.mjs'
    p = subprocess.run(['node', str(ROOT / 'scripts/native-tokens.mjs'), str(adapter), str(native)],
                       capture_output=True, text=True, timeout=30)
    if p.returncode: raise RuntimeError('native-meter-refused:' + p.stderr[-1500:])
    return json.loads(p.stdout)

TOKEN_BASIS = 'non-cached-input-plus-output; cache reads/writes uncapped; reasoning included in output'

def phase_usage(metered, windows):
    from datetime import datetime
    keys = ('input', 'output', 'cacheRead', 'cacheWrite', 'reasoning')
    counts = {w['phase']: {k: 0 for k in keys} for w in windows}
    for t in metered['turns']:
        at = datetime.fromisoformat(t['completedAt'].replace('Z', '+00:00')).timestamp()
        found = [w for w in windows if w['at'] <= at]
        if not found: raise RuntimeError('native-usage-before-builder')
        row = counts[found[-1]['phase']]
        for k in keys:
            value = t['usage'][k]
            if value is None: row[k] = None
            elif row[k] is not None: row[k] += value
    # The checksum-validating adapter already subtracts cache reads AND cache
    # writes from raw input. Never subtract cacheRead again, or add reasoning.
    # @ref LLP 0201#d7--phases — pilot interpretation disclosed in REVISION-2.md.
    for row in counts.values(): row['nonCachedTokens'] = row['input'] + row['output']
    return counts

def phase_tokens(metered, windows):
    return {phase: row['nonCachedTokens'] for phase, row in phase_usage(metered, windows).items()}

def supervise(b, lease_fd=None):
    logs = ROOT / 'logs' / b; lane = ROOT / 'lanes' / b
    lease = os.fdopen(lease_fd, 'a') if lease_fd is not None else lock('authoring-or-operator.lock')
    p = None; native = None; metered = None; owner = None; cleanup = None
    derived = None; derived_cleanup = None
    started = time.time(); phase_start = started; phase = 'm1'; boundary_count = 0; replay = None; replay_total = 0
    windows = [{'phase': 'm1', 'at': started}]
    thread = None; outcome = 'setup-failure'; reason = None; code = None
    boundaries = logs / 'boundary-requests.jsonl'; boundaries.touch(exist_ok=False)
    private, codex_home, temp, sandbox = prepare_isolation(b, boundaries)
    env = environment(boundaries, codex_home, temp)
    argv = ['/usr/bin/sandbox-exec', '-f', str(sandbox), str(Path.home() / '.volta/bin/codex'), 'exec', '--dangerously-bypass-approvals-and-sandbox',
            '--skip-git-repo-check', '--json', '--color', 'never', '-m', 'gpt-6-astra',
            '-c', 'model_reasoning_effort=medium', '-c', 'features.multi_agent=false',
            '-C', str(lane), '-o', str(lane / 'FINAL.md'), '-']
    def interrupt(signum, frame): raise KeyboardInterrupt('supervisor-signal:' + str(signum))
    signal.signal(signal.SIGTERM, interrupt)
    try:
        derived = derived_data.begin(private, logs)
        owner = ProcessOwner(logs)
        env[TAG] = owner.state['token']
        with (ROOT / 'prompts' / (b + '.md')).open() as prompt, (logs / 'codex.ndjson').open('xb') as out, (logs / 'codex.stderr.log').open('xb') as err:
            p = subprocess.Popen(argv, stdin=prompt, stdout=out, stderr=err, cwd=lane, env=env, start_new_session=True)
            owner.start(p)
            put(logs / 'pid', str(p.pid) + '\n')
            put(logs / 'start.json', {'at': started, 'pid': p.pid, 'argv': argv, 'model': 'gpt-6-astra',
                                    'effort': 'medium', 'promptSha256': sha(ROOT / 'prompts' / (b + '.md'))})
            record(logs / 'watchdog.jsonl', kind='phase-start', phase=phase, startedAt=started)
            last_meter = 0
            while p.poll() is None:
                now = time.time()
                owner.sample()
                if thread is None:
                    for line in (logs / 'codex.ndjson').read_text().splitlines():
                        try: e = json.loads(line)
                        except ValueError: continue
                        if e.get('type') == 'thread.started': thread = e['thread_id']; break
                if thread and native is None: native = session_path(thread, codex_home)
                if now - started > 120 and native is None: raise RuntimeError('native-transcript-unavailable')
                if (replay is None and now - phase_start >= 14400) or replay_total + (now - replay if replay is not None else 0) >= 14400:
                    outcome, reason = 'capability-failure', 'wall-cap'; break
                requests = [json.loads(x) for x in boundaries.read_text().splitlines()]
                for e in requests[boundary_count:]:
                    requested = e['phase']
                    if requested == 'replay-start':
                        # @ref LLP 0201#dated-amendments — M6 budgets adapter authoring;
                        # execution and the required M8 rerun share one cumulative
                        # wall ceiling. Closing an interval never resets it.
                        if phase not in ('m6', 'm8') or replay is not None: raise RuntimeError('invalid-replay-boundary')
                        replay = now
                    elif requested == 'replay-end':
                        if replay is None: raise RuntimeError('invalid-replay-boundary')
                        replay_total += now - replay
                        record(logs / 'watchdog.jsonl', kind='replay-end', wallSeconds=now-replay,
                               cumulativeWallSeconds=replay_total, remainingWallSeconds=14400-replay_total)
                        phase_start += now - replay; replay = None
                    else:
                        if replay is not None or phase == 'm8' or requested != MILESTONES[MILESTONES.index(phase) + 1]:
                            raise RuntimeError('milestone-order')
                        record(logs / 'watchdog.jsonl', kind='phase-end', phase=phase, wallSeconds=now-phase_start)
                        phase, phase_start = requested, now
                        windows.append({'phase': phase, 'at': now})
                    record(logs / 'watchdog.jsonl', kind='boundary', phase=requested, requestedAt=e['at'], observedAt=now)
                boundary_count = len(requests)
                if native and now - last_meter >= 10:
                    metered = usage(native); last_meter = now
                    if now - started > 120 and not metered['turns']: raise RuntimeError('native-token-events-unavailable')
                    counts = phase_tokens(metered, windows)
                    record(logs / 'watchdog.jsonl', kind='native-tokens', phase=phase, tokensByPhase=counts,
                           usageByPhase=phase_usage(metered, windows), tokenBasis=TOKEN_BASIS,
                           adapter=metered['adapterVersion'], phaseStartedAt=phase_start)
                    if any(v >= 2000000 for v in counts.values()): outcome, reason = 'capability-failure', 'token-cap'; break
                time.sleep(1)
            if reason is None:
                code = p.wait(); outcome = 'builder-ended' if code == 0 else 'setup-failure'
                reason = 'normal-exit' if code == 0 else 'codex-exit:' + str(code)
    except BaseException as e:
        reason = str(e)
    finally:
        termination = {'outcome': outcome, 'reason': reason, 'observedAt': time.time()}
        try:
            if owner is not None: cleanup = owner.cleanup(p)
        except Exception as e:
            outcome, reason = 'setup-failure', 'cleanup-failed:' + str(e)
        try:
            if derived is not None and cleanup is not None and cleanup.get('complete'):
                derived_cleanup = derived_data.finish(derived)
        except Exception as e:
            outcome, reason = 'setup-failure', 'derived-data-cleanup-failed:' + str(e)
        if p is not None: code = p.returncode
        if native:
            shutil.copyfile(native, logs / 'native-rollout.jsonl')
            put(logs / 'native-custody.json', {'source': str(native), 'threadId': thread,
                 'sha256': sha(logs / 'native-rollout.jsonl'), 'bytes': (logs / 'native-rollout.jsonl').stat().st_size})
            try:
                metered = usage(logs / 'native-rollout.jsonl')
                if not metered['turns']: raise RuntimeError('native-token-events-unavailable')
                put(logs / 'native-usage.json', metered)
                counts = phase_tokens(metered, windows)
                put(logs / 'phase-token-sampling.json', {'windows': windows, 'tokens': counts,
                    'usageByPhase': phase_usage(metered, windows), 'tokenBasis': TOKEN_BASIS,
                    'purpose': 'pilot safety; scored first-green settlement attribution not claimed'})
                if any(v >= 2000000 for v in counts.values()): outcome, reason = 'capability-failure', 'token-cap'
            except Exception as e: outcome, reason = 'setup-failure', str(e)
        else: outcome, reason = 'setup-failure', 'native-transcript-unavailable:' + str(reason)
        if cleanup is None or not cleanup.get('complete'):
            outcome, reason = 'setup-failure', 'builder-cleanup-unconfirmed:' + str(reason)
        if derived_cleanup is None or not derived_cleanup.get('complete'):
            outcome, reason = 'setup-failure', 'derived-data-cleanup-unconfirmed:' + str(reason)
        put(logs / 'end.json', {'at': time.time(), 'pid': p.pid if p else None, 'exitCode': code,
            'wallSeconds': time.time() - started, 'outcome': outcome, 'reason': reason,
            'termination': termination, 'lastMilestone': phase, 'cleanup': cleanup,
            'replayWallSeconds': replay_total + (termination['observedAt'] - replay if replay is not None else 0),
            'derivedDataCleanup': derived_cleanup, 'tokenBasis': TOKEN_BASIS, 'tokensSource': 'codex-rollout-token-count' if native else None})
        lease.close()
    if outcome == 'setup-failure': raise RuntimeError(reason)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['launch', 'run']); parser.add_argument('backend', choices=BACKENDS)
    parser.add_argument('--lease-fd', type=int)
    args = parser.parse_args()
    if args.action == 'launch': launch(args.backend)
    else: supervise(args.backend, args.lease_fd)
