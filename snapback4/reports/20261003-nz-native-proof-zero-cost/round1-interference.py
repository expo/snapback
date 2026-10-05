"""Three ABBA blocks: fixed six-file client pool, absent/concurrent native proof."""
import json, pathlib, resource, subprocess, time
from round1 import ROOT, WORK, OUT, BINARY, env, write, latest, arm_wrapper, cleanup_devices, Monitor, snapshot, retain, client_runtime_inputs, drain_background

PROJECT = WORK/'r1-social-B'
FILES = ['client-seams', 'client-lifecycle', 'device-residency', 'keep-device',
         'delivery-clients', 'subscription-pressure-device']
COMMAND = ['node', '--test', '--test-concurrency=6'] + [f'packages/snapback4/test/{f}.test.mjs' for f in FILES]
PLAN = [(block, index, arm) for block in range(3) for index, arm in enumerate('ABBA')]

def read(path): return json.loads(path.read_text()) if path.exists() else None

def run(block, index, arm):
    label = f'r1-interference-{block}-{index}-{arm}'
    if (OUT/(label+'.json')).exists(): return
    monitor = Monitor(label); monitor.start(); smoke = None; exported_at = None
    print('START '+label, flush=True)
    if arm == 'B':
        entry = PROJECT/'src/client.ts'
        entry.write_text(entry.read_text()+'\nObject.defineProperty(globalThis,"__nzInterference",{configurable:true,value:'+json.dumps(label)+'});\n')
        exported_at = time.time()
        with (WORK/(label+'-export.log')).open('w') as f:
            result = subprocess.run(['npm', 'run', 'export:ios'], cwd=PROJECT, env=env(), stdout=f, stderr=f)
        if result.returncode: raise RuntimeError('interference export failed; raw log retained')
        smoke = latest(PROJECT)
        # Boot is outside the workload interval. Both cache hit and build pass
        # through this real preparation supervisor; no tool fixture is used.
        end = time.monotonic()+180
        while not (smoke/'preparation-group.json').exists():
            if (smoke/'result.json').exists() or time.monotonic() >= end:
                raise RuntimeError('proof did not reach preparation; raw logs retained')
            time.sleep(.1)
    before = snapshot(); log = WORK/(label+'.log')
    phase_before = read(smoke/'preparation-phases.json') if smoke else None
    cpu = resource.getrusage(resource.RUSAGE_CHILDREN); started_at = time.time(); start = time.monotonic()
    with log.open('w') as f:
        result = subprocess.run(COMMAND, cwd=ROOT, env=env(), stdout=f, stderr=f)
    seconds = time.monotonic()-start; ended_at = time.time(); after_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
    after = snapshot()
    terminal_at_end = read(smoke/'result.json') if smoke else None
    wait_status = None
    if smoke:
        with (WORK/(label+'-wait.log')).open('w') as f:
            wait_status = subprocess.run([str(BINARY), 'witness', 'status', '--wait', '--json'], cwd=PROJECT, env=env(), stdout=f, stderr=f).returncode
        drain_background(PROJECT)
    monitor.finish()
    terminal = read(smoke/'result.json') if smoke else None
    receipt = read(smoke/'smoke-ios-run.json') if smoke else None
    overlap = max(0, min(ended_at, terminal['finishedAt']/1000)-started_at) if terminal else 0
    evidence = [retain(log), retain(monitor.path)]
    if smoke:
        evidence += [retain(WORK/(label+'-export.log')), retain(WORK/(label+'-wait.log'))]
        evidence += [retain(p) for p in smoke.iterdir() if p.is_file() and p.suffix in ['.json','.jsonl','.log','.png','.mp4']]
    row = dict(label=label, block=block, index=index, arm=arm, startedAt=started_at, endedAt=ended_at,
        seconds=seconds, status=result.returncode, childCpuSeconds=after_cpu.ru_utime+after_cpu.ru_stime-cpu.ru_utime-cpu.ru_stime,
        before=before, after=after, smoke=str(smoke) if smoke else None, exportedAt=exported_at,
        phasesAtWorkloadStart=phase_before, resultAtWorkloadEnd=terminal_at_end, result=terminal,
        nativeCache=receipt.get('nativeCache') if receipt else None,
        backgroundOverlapSeconds=overlap, overlapFraction=overlap/seconds, waitStatus=wait_status, evidence=evidence)
    write(OUT/(label+'.json'), row); cleanup_devices(label)
    print(json.dumps({k:row[k] for k in ['label','seconds','status','overlapFraction','nativeCache','waitStatus']}), flush=True)

def placement():
    source=OUT.parent/'cpu-probe.c'; binary=WORK/'cpu-probe-r1'
    command=['clang','-O2','-pthread',str(source),'-o',str(binary)]
    with (WORK/'r1-placement-build.log').open('w') as f:
        subprocess.run(command,stdout=f,stderr=f,check=True)
    write(OUT/'placement-plan.json',dict(command=command,compiler=subprocess.check_output(['clang','--version'],text=True),
        design='Three ABBA blocks; six threads for three seconds. CPU IDs are work-sample observations using the host-specific XNU register layout, not residency time or simulator-thread traces.',
        inputs=[retain(source),retain(binary),retain(WORK/'r1-placement-build.log')]))
    rows = []
    for block in range(3):
        for index, arm in enumerate('ABBA'):
            label = f'r1-placement-{block}-{index}-{arm}'
            before = snapshot(); monitor = Monitor(label); monitor.start()
            command = ([str(binary)] if arm == 'A' else ['/usr/sbin/taskpolicy','-b','-c','background',str(binary)])
            result = json.loads(subprocess.check_output(command, text=True))
            monitor.finish()
            rows.append(dict(label=label, block=block, index=index, arm=arm, before=before, after=snapshot(), result=result, evidence=retain(monitor.path)))
    write(OUT/'placement.json', rows)

if __name__ == '__main__':
    arm_wrapper('B')
    drain_background(PROJECT)
    client_runtime_inputs()
    write(OUT/'interference-plan.json', dict(plan=PLAN, command=COMMAND, backgroundProject=str(PROJECT),
        start='Start workload after background preparation supervisor appears; report actual overlap, no quiet gate.',
        inputs=[retain(ROOT/f) for f in COMMAND[3:]]+[retain(ROOT/'target/debug/snapback4'),retain(BINARY)],
        analysis='Report raw seconds, per-block B mean/A mean, and each B relative to linearly time-interpolated bracketing A controls; keep failures.'))
    for sample in PLAN: run(*sample)
    placement()
