#!/usr/bin/env python3
"""External same-UUID supervisor. Preparation/default never launches anything."""
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,time
from datetime import datetime
b=Path(__file__).resolve().parent;m=json.loads((b/'resume-metadata.json').read_text())
p=argparse.ArgumentParser();p.add_argument('--launch',action='store_true')
for name in ['release-receipt','repair-receipt','ownership-receipt']:p.add_argument('--'+name,type=Path)
a=p.parse_args()
if not a.launch:
 print(json.dumps({'status':'PREPARED_NOT_LAUNCHED','argv':m['command'],'required':['true original terminal and Root release receipt','applied exact-helper Root repair receipt','Root recorded retained-process ownership receipt'],'clock':m['clock']},indent=2));raise SystemExit(0)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def read(path):return json.loads(Path(path).read_text())
def write(path,value):
 with path.open('x') as f:json.dump(value,f,indent=2);f.write('\n')
def identity(pid):
 return subprocess.run(['ps','-p',str(pid),'-o','pid=,lstart=,comm='],capture_output=True,text=True,timeout=10).stdout.strip()
assert all([a.release_receipt,a.repair_receipt,a.ownership_receipt]),'Root receipts required; no defaults or fabricated live release'
assert read(b.parent/'phase.json')['writerReleased'] is True
for row in m['baselineBindings']:assert sha(row['path'])==row['sha256'],'original launcher input changed'
assert sha(m['stdin'])==m['noticeSha256']
for key in ['nativeCli','node']:assert sha(m[key]['path'])==m[key]['sha256']
old=Path(m['originalRuntime']);assert sha(old/'launch.json')==m['originalLaunchSha256']
terminal=read(old/'terminal.json');release=read(a.release_receipt)
assert terminal['pid']==m['originalPid'] and terminal['nativeSessionId']==m['builderUuid'] and type(terminal['exitCode']) is int
assert terminal['endedEpoch']>=read(old/'launch.json')['startedEpoch'] and terminal['endedEpoch']<=time.time()
assert release['released'] is True and release['builderUuid']==m['builderUuid']
assert release['oldPid']==m['originalPid'] and release['oldSupervisorPid']==m['originalSupervisorPid']
assert release['terminalSha256']==sha(old/'terminal.json')
assert not identity(m['originalPid']) and not identity(m['originalSupervisorPid']),'old process still present or ambiguous; Root owns interruption/release'
assert sha(old/'stdout.ndjson')==terminal['stdoutSha256'] and sha(old/'stderr.log')==terminal['stderrSha256']
first=read(old/'native-evidence.json');firstRollout=Path(first['retained'])
assert first['nativeSessionId']==m['builderUuid'] and firstRollout.resolve()==(old/'native-rollout.jsonl').resolve()
assert sha(firstRollout)==first['sha256']
firstBytes=firstRollout.read_bytes();liveRollout=Path(first['source'])
assert read(old/'native-session.json')['threadId']==m['builderUuid']
assert liveRollout.read_bytes().startswith(firstBytes),'same-UUID history changed; retain and refuse'
assert a.repair_receipt.resolve().is_relative_to(Path(m['repairReceiptDirectory']).resolve()),'repair receipt must be in Root instrument-layout directory'
repair=read(a.repair_receipt);assert repair['applied'] is True and repair['rootApproved'] is True
assert repair['helper']==m['helper'],'Root receipt does not match exact original helper/layout'
helper=Path(m['helper']['path']);assert helper.stat().st_size==m['helper']['bytes'] and sha(helper)==m['helper']['sha256']
ownership=read(a.ownership_receipt)
assert ownership['builderUuid']==m['builderUuid'] and ownership['lane']==m['cwd'] and ownership['rootConfirmed'] is True
owned={}
for record in ownership['processes']:
 pid=record['pid'];assert type(pid) is int and pid>0 and pid not in owned
 assert all(type(port) is int and 52300<=port<=52319 for port in record['ports'])
 current=identity(pid);assert not current or current==record['identity'],'recorded PID identity changed; no restart or signal'
 owned[pid]={**record,'aliveAtPreflight':bool(current)}
# Assigned ports may already host this SAME lane. Never treat them as foreign
# merely because they are occupied, and never inspect an unknown PID's process.
probe=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:52300-52319','-sTCP:LISTEN','-Fpn'],capture_output=True,text=True,timeout=10)
assert probe.returncode in [0,1] and not probe.stderr,'assigned-port observation failed'
listeners=[];pid=None
for line in probe.stdout.splitlines():
 if line.startswith('p'):pid=int(line[1:]);assert pid in owned,'unrecorded listener in assigned range; Root must resolve custody'
 if line.startswith('n'):
  match=re.search(r':(\d+)$',line);assert match,'ambiguous listener address'
  port=int(match.group(1));assert port in owned[pid]['ports'] and owned[pid]['aliveAtPreflight'],'listener ownership mismatch'
  listeners.append({'pid':pid,'port':port})
# Recheck only recorded live identities; retain all existing lane files/servers.
for pid,record in owned.items():
 if record['aliveAtPreflight']:assert identity(pid)==record['identity'],'own process changed during preflight'
lane=Path(m['cwd']);assert lane.is_dir();runtime=b/'runtime';assert not runtime.exists(),'existing resume state; preserve it; no blind retry'
env=dict(os.environ)
for key in list(env):
 if key in m['unsetEnvironment'] or any(key.startswith(prefix) for prefix in m['unsetPrefixes']):env.pop(key,None)
env.update(m['environment'])
assert subprocess.check_output([m['node']['path'],'--version'],env=env,text=True,timeout=10).strip()==m['node']['requiredVersion']
runtime.mkdir();history=runtime/'first-process-history';history.mkdir()
historical=[]
for name in ['launch.json','native-session.json','stdout.ndjson','stderr.log','terminal.json','native-evidence.json','native-rollout.jsonl','native-usage-events.json','native-meter.json','native-meter-terminal.json']:
 source=old/name
 if source.exists():
  dest=history/name
  with dest.open('xb') as f:f.write(source.read_bytes())
  dest.chmod(0o444);historical.append({'source':str(source),'retained':str(dest),'sha256':sha(dest)})
write(runtime/'preflight.json',{'atEpoch':time.time(),'clock':m['clock'],'metadataSha256':sha(b/'resume-metadata.json'),'supervisorSha256':sha(__file__),'receipts':[{'path':str(q),'sha256':sha(q)} for q in [a.release_receipt,a.repair_receipt,a.ownership_receipt]],'historical':historical,'retainedProcesses':list(owned.values()),'listeners':listeners,'environment':m['environment'],'load':os.getloadavg(),'actionsReplayed':False,'serversRestarted':False})
threadEvents=[];usage=[]
with Path(m['stdin']).open('rb') as inp,(runtime/'stdout.ndjson').open('xb') as out,(runtime/'stderr.log').open('xb') as err:
 started=time.time();child=subprocess.Popen(m['command'],cwd=lane,env=env,stdin=inp,stdout=subprocess.PIPE,stderr=err,start_new_session=True)
 write(runtime/'launch.json',{'pid':child.pid,'supervisorPid':os.getpid(),'startedEpoch':started,'actualIdentity':identity(child.pid),'argv':m['command'],'model':m['model'],'effort':m['effort'],'expectedSameUuid':m['builderUuid'],'originalPid':m['originalPid'],'clock':m['clock'],'cwd':str(lane),'noticeSha256':m['noticeSha256']})
 print(json.dumps({'resumePid':child.pid,'supervisorPid':os.getpid(),'sameUuid':m['builderUuid']}),flush=True)
 for line in child.stdout:
  out.write(line);out.flush()
  try:event=json.loads(line)
  except (ValueError,UnicodeDecodeError):continue
  if event.get('type')=='thread.started':threadEvents.append(event)
  if event.get('type')=='turn.completed' and 'usage' in event:usage.append(event)
 code=child.wait()
write(runtime/'terminal.json',{'pid':child.pid,'exitCode':code,'endedEpoch':time.time(),'elapsedSeconds':time.time()-started,'threadEvents':threadEvents,'expectedSameUuid':m['builderUuid'],'stdoutSha256':sha(runtime/'stdout.ndjson'),'stderrSha256':sha(runtime/'stderr.log')})
write(runtime/'native-usage-events.json',{'source':'exact native events from resumed process only','events':usage,'totals':None,'reason':'Do not add process summaries to same-UUID cumulative rollout totals'})
# Preserve the one cumulative stream, including compaction events, unmodified.
raw=liveRollout.read_bytes();retained=runtime/'native-rollout.jsonl'
with retained.open('xb') as f:f.write(raw)
retained.chmod(0o444)
metaRecord=json.loads(raw.splitlines()[0]);same=metaRecord.get('type')=='session_meta' and metaRecord.get('payload',{}).get('id')==m['builderUuid']
resumedUsage=False
if raw.startswith(firstBytes) and len(raw)>len(firstBytes) and usage:
 try:
  appended=[json.loads(line) for line in raw[len(firstBytes):].splitlines() if line.strip()]
  resumedUsage=any(e.get('type')=='event_msg' and e.get('payload',{}).get('type')=='token_count' and isinstance(e.get('payload',{}).get('info',{}),dict) and isinstance(e['payload']['info'].get('total_token_usage'),dict) and datetime.fromisoformat(e['timestamp'].replace('Z','+00:00')).timestamp()>=started for e in appended)
 except (ValueError,KeyError,TypeError):pass
valid=same and raw.startswith(firstBytes) and resumedUsage and bool(threadEvents) and all(e.get('thread_id')==m['builderUuid'] for e in threadEvents)
write(runtime/'native-evidence.json',{'nativeSessionId':m['builderUuid'],'retained':str(retained),'source':str(liveRollout),'sha256':sha(retained),'originalPrefixSha256':first['sha256'],'exactHistoricalPrefixRetained':raw.startswith(firstBytes),'sameNativeIdentity':same,'meteringAdmitted':valid,'resumedNativeUsagePresent':resumedUsage,'countingPolicy':'one complete cumulative same-UUID stream once; NEVER sum first and resumed cumulative snapshots','completeDescendantTreeClaimed':False,'perMilestoneTotals':None})
if valid:
 with (runtime/'native-meter.log').open('xb') as log:
  meter=subprocess.run([m['node']['path'],str(b/'meter-own-session.mjs')],cwd=b,env=env,stdout=log,stderr=subprocess.STDOUT)
 write(runtime/'native-meter-terminal.json',{'exitCode':meter.returncode,'logSha256':sha(runtime/'native-meter.log'),'scope':'complete retained root cumulative stream through resume; not incremental; no phase attribution or whole-tree claim'})
else:write(runtime/'native-meter-unavailable.json',{'totals':None,'reason':'native identity, cumulative prefix or resumed usage ambiguous; fail closed; original and new bytes retained'})
print(json.dumps({'actualResumeExitCode':code,'sameUuid':m['builderUuid'],'terminal':str(runtime/'terminal.json')}),flush=True)
raise SystemExit(code)
