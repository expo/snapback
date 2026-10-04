"""Three additional ABBA blocks during cold compilation; two B windows per proof."""
import json, pathlib, resource, subprocess, time
from round1 import ROOT, WORK, OUT, BINARY, env, write, latest, arm_wrapper, clean_native, cleanup_devices, Monitor, snapshot, retain, drain_background

PROJECT = WORK/'r1-social-B'
FILES = ['client-seams','client-lifecycle','device-residency','keep-device','delivery-clients','subscription-pressure-device']
COMMAND = ['node','--test','--test-concurrency=6']+[f'packages/snapback4/test/{f}.test.mjs' for f in FILES]
def read(p): return json.loads(p.read_text()) if p.exists() else None

def foreground(block,index,arm,smoke=None):
    label=f'r1-interference-cold-{block}-{index}-{arm}'
    before=snapshot(); monitor=Monitor(label); monitor.start()
    phase=read(smoke/'preparation-phases.json') if smoke else None
    cpu=resource.getrusage(resource.RUSAGE_CHILDREN); started=time.time(); start=time.monotonic()
    log=WORK/(label+'.log')
    print('START '+label,flush=True)
    with log.open('w') as f: result=subprocess.run(COMMAND,cwd=ROOT,env=env(),stdout=f,stderr=f)
    seconds=time.monotonic()-start; ended=time.time(); endcpu=resource.getrusage(resource.RUSAGE_CHILDREN)
    monitor.finish()
    row=dict(label=label,condition='cold-build',block=block,index=index,arm=arm,startedAt=started,endedAt=ended,
        seconds=seconds,status=result.returncode,childCpuSeconds=endcpu.ru_utime+endcpu.ru_stime-cpu.ru_utime-cpu.ru_stime,
        before=before,after=snapshot(),smoke=str(smoke) if smoke else None,
        phasesAtWorkloadStart=phase,resultAtWorkloadEnd=read(smoke/'result.json') if smoke else None,
        result=None,waitStatus=None,nativeCache=None,backgroundOverlapSeconds=0,overlapFraction=0,
        evidence=[retain(log),retain(monitor.path)])
    write(OUT/(label+'.json'),row)
    print(json.dumps({k:row[k] for k in ['label','seconds','status']}),flush=True)
    return row

def block(number):
    label=f'r1-cold-proof-{number}'
    if (OUT/(label+'.json')).exists(): return
    assert not list(OUT.glob(f'r1-interference-cold-{number}-*.json')), 'partial block retained; inspect before retry'
    foreground(number,0,'A')
    clean_native(PROJECT)
    entry=PROJECT/'src/client.ts'
    entry.write_text(entry.read_text()+'\nObject.defineProperty(globalThis,"__nzColdInterference",{configurable:true,value:'+json.dumps(label)+'});\n')
    before=snapshot(); monitor=Monitor(label); monitor.start(); started=time.time(); start=time.monotonic()
    log=WORK/(label+'.log')
    with log.open('w') as f: result=subprocess.run(['npm','run','export:ios'],cwd=PROJECT,env=env(),stdout=f,stderr=f)
    critical=time.monotonic()-start
    if result.returncode: raise RuntimeError('cold interference export failed; raw log retained')
    smoke=latest(PROJECT)
    # Observe a real compiler phase, not just an open Xcode log or native setup.
    end=time.monotonic()+3600
    while True:
        output=smoke/'xcode-build.log'
        if output.exists():
            text=output.read_text(errors='replace')
            if 'CompileC ' in text or 'SwiftCompile ' in text: break
        if (smoke/'result.json').exists() or time.monotonic()>=end:
            raise RuntimeError('cold proof ended before compilation; raw logs retained')
        time.sleep(.5)
    samples=[foreground(number,1,'B',smoke),foreground(number,2,'B',smoke)]
    with (WORK/(label+'-wait.log')).open('w') as f:
        waited=subprocess.run([str(BINARY),'witness','status','--wait','--json'],cwd=PROJECT,env=env(),stdout=f,stderr=f).returncode
    drain_background(PROJECT)
    total=time.monotonic()-start; monitor.finish()
    terminal=read(smoke/'result.json'); receipt=read(smoke/'smoke-ios-run.json') or {}
    evidence=[retain(log),retain(WORK/(label+'-wait.log')),retain(monitor.path)]
    evidence += [retain(p) for p in smoke.iterdir() if p.is_file() and p.suffix in ['.json','.jsonl','.log','.png','.mp4']]
    proof=dict(label=label,startedAt=started,criticalSeconds=critical,totalSeconds=total,status=result.returncode,
        waitStatus=waited,before=before,after=snapshot(),artifacts=str(smoke),result=terminal,
        cache=receipt.get('nativeCache'),deadline=read(smoke/'preparation-deadline.json'),
        phases=read(smoke/'preparation-phases.json'),segments={k:v.get('status') for k,v in receipt.get('segments',{}).items()},evidence=evidence)
    write(OUT/(label+'.json'),proof)
    for row in samples:
        row.update(result=terminal,waitStatus=waited,nativeCache=receipt.get('nativeCache'))
        row['backgroundOverlapSeconds']=min(row['seconds'],max(0,min(row['endedAt'],terminal['finishedAt']/1000)-row['startedAt']))
        row['overlapFraction']=row['backgroundOverlapSeconds']/row['seconds']
        row['evidence']+=evidence
        write(OUT/(row['label']+'.json'),row)
    cleanup_devices(label)
    print(json.dumps({k:proof[k] for k in ['label','criticalSeconds','totalSeconds','waitStatus','segments','deadline']}),flush=True)
    foreground(number,3,'A')

if __name__=='__main__':
    arm_wrapper('B')
    drain_background(PROJECT)
    write(OUT/'cold-interference-plan.json',dict(blocks=[3,4,5],order='ABBA',command=COMMAND,
        design='A without proof; two consecutive B workload windows share one cold background social proof per block, starting at actual Xcode compilation. Three independent cold builds, six B workload observations; analyze clustering by block.',
        inputs=[retain(ROOT/f) for f in COMMAND[3:]]+[retain(BINARY)]))
    for number in [3,4,5]: block(number)
