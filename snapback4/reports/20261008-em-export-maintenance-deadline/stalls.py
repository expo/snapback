#!/usr/bin/env python3
"""Exercise the actual, unmodified 90-second maintenanceIdle with a held lease."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,time
report=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser()
p.add_argument('--out', default=str(report/'evidence/negative-current'))
p.add_argument('--binary', default='target/debug/snapback4')
p.add_argument('--cpus', default='80-83')
a=p.parse_args()
source=pathlib.Path('packages/snapback4/test/export-background.test.mjs')
copy=source.with_name(f'.em-maintenance-negative-{os.getpid()}.test.mjs')
extra=r'''
for(const fault of ['held lease','missing observer'])test(`EM injected stall: ${fault}`, {timeout:120000}, async()=>{
  const f=fixture(); let held;
  try {
    skipMode(f,'off'); held=await holdRetention(f);
    const r=f.invoke(); assert.equal(r.status,0,r.stdout+r.stderr);
    if(fault==='missing observer') {
      const root=path.join(f.root,'artifacts/native-smoke');
      const record=read(path.join(root,'maintenance-next.json')).process;
      const pid=record.pid;
      signalFixture(f,record,'SIGKILL');
      await until(()=>!alive(pid),'our stalled observer exited');
      held.child.stdin.end();await held.exited;held=null;
    }
    await maintenanceIdle(f);
  } finally {
    if(held){held.child.stdin.end();await held.exited;}
    if(fault==='missing observer') {
      const resumed=f.invoke('negative control cleanup');
      assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);
    }
    await cleanup(f);
  }
});
'''
out=pathlib.Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
binary=pathlib.Path(a.binary)
digest=hashlib.sha256(binary.read_bytes()).hexdigest()
pinned=pathlib.Path('target/em/binaries',digest,'snapback4').resolve()
pinned.parent.mkdir(parents=True,exist_ok=True)
if not pinned.exists():shutil.copy2(binary,pinned)
(out/'control.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),binarySha256=digest,pinned=str(pinned),cpus=a.cpus,addition=extra),indent=2))
copy.write_text(source.read_text()+extra)
try:
 started=time.monotonic()
 with (out/'controls.log').open('w') as log:
  r=subprocess.run(['taskset','-c',a.cpus,'node','--test','--test-reporter=tap','--test-name-pattern=EM injected stall',str(copy)],env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(pinned),'SNAPBACK4_DEBUG_RETENTION':'1','SNAPBACK4_MAINTENANCE_EVIDENCE':str(out/'snapshots')},stdout=log,stderr=subprocess.STDOUT)
 text=(out/'controls.log').read_text()
 snapshots=list((out/'snapshots').rglob('*-drain-timeout'))
 assert r.returncode==1 and text.count('error: \'coalesced maintenance queue drained\'')==2 and len(snapshots)==2,text
 (out/'result.json').write_text(json.dumps(dict(expectedExit=1,actualExit=r.returncode,elapsed=time.monotonic()-started,snapshots=[str(s) for s in snapshots]),indent=2))
 print('Both stalls failed the original 90-second assertion; owned fixtures subsequently drained and cleaned up.')
finally: copy.unlink()
