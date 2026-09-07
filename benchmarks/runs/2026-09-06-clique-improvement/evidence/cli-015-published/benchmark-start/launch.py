#!/usr/bin/env python3
"""Prepared one-shot cold Grok015 launch; requires bound publication/install proof."""
from pathlib import Path
import datetime,hashlib,json,os,socket,subprocess,sys,time,uuid
ROOT=Path('/Users/ccheever/clique-full-grok-015-20260907');LANE=ROOT/'lanes/grok-snapback2';E=Path(__file__).resolve().parent;PREP=E/'host-preparation';LOGS=ROOT/'logs'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,j):p.write_text(json.dumps(j,indent=2)+'\n')
if sys.argv[1:]==['--supervise']:
 m=json.loads((LOGS/'launch-authorized.json').read_text());env=dict(os.environ);env['PATH']='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/opt/homebrew/bin:/Users/ccheever/.volta/bin:/Users/ccheever/.cargo/bin:'+env.get('PATH','');env['DEVELOPER_DIR']='/Applications/Xcode.app/Contents/Developer'
 for k in ['NODE_PATH','NODE_OPTIONS','SNAPBACK_BINARY','SNAPBACK_COMPILER','SNAPBACK_ENGINE','SNAPBACK_MEDIA']:env.pop(k,None)
 with (LOGS/'grok-snapback2.ndjson').open('xb') as o,(LOGS/'grok-snapback2.stderr.log').open('xb') as e:
  t=time.time();p=subprocess.Popen(m['command'],cwd=LANE,env=env,stdin=subprocess.DEVNULL,stdout=o,stderr=e);write(LOGS/'grok-snapback2.start.json',dict(m,pid=p.pid,supervisorPid=os.getpid(),startedEpoch=t,startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()));c=p.wait()
 write(LOGS/'grok-snapback2.terminal.json',{'pid':p.pid,'exitCode':c,'startedEpoch':t,'endedEpoch':time.time(),'elapsedSeconds':time.time()-t});raise SystemExit(c)
if sys.argv[1:]!=['--launch']:
 print('Preparation only. No benchmark launch without exact publication and fresh installed proof.');raise SystemExit(0)
proof=E/'release-verification.json';r=json.loads(proof.read_text());assert r['version']=='0.0.15' and r['qualifiedSource']=='78924a1e7286907d2378221902ec22747e7d188f' and r['registryVerified'] and r['freshInstallVerified'] and r['expoVerified'] and r['guideVerified'] and r['packedRegularLeavesVerified']==156
expected={'snapback2-darwin-arm64':'sha512-O9Zx/4wAPwraH77N2rsCuvorIey49aMRl6tckV3cRkGHuZow1lKelsM0ushU8S3kZC5yD1OnFVUHERNex9jRBw==','snapback2':'sha512-+Ucp3/J4sG7BJwKdeMzPXQpj+dhc3R2Q/pBQoohXxTRV3hiPAWBojHtaQ4ums0SxlQ0wDsss5w2mmmiTj3YRFg=='}
for n,h in expected.items():assert r['packages'][n]['integrity']==h and r['packages'][n]['version']=='0.0.15'
for x in r['sourceReceipts']:assert sha(x['path'])==x['sha256']
prep=json.loads((PREP/'preparation-receipt.json').read_text());assert len(prep['copiedOriginalLeaves'])==169
for x in prep['copiedOriginalLeaves']:assert sha(ROOT/x['path'])==x['sha256']
assert sha(ROOT/'instrument/ENVIRONMENT.md')==prep['environment']['sha256'];assert sha(ROOT/prep['helper']['path'])==prep['helper']['sha256']
for x in prep['links']:assert os.readlink(ROOT/x['path'])==x['target']
assert sorted(x.name for x in LANE.iterdir())==['instrument','metering'],'Cold lane changed'
for k in ['node','bun']:assert sha(prep[k]['path'])==prep[k]['sha256']
assert sha(prep['grok']['resolved'])==prep['grok']['sha256']
ports=[]
for port in range(52700,52720):
 for family,host in [(socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')]:
  with socket.socket(family,socket.SOCK_STREAM) as s:
   if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
   s.bind((host,port));ports.append({'port':port,'family':family,'bindable':True,'reserved':False})
q=PREP/'prompt.version-pending.md';assert sha(q)==prep['pendingPrompt']['sha256'];text=q.read_text();assert text.count('@QUALIFIED_VERSION@')==2;text=text.replace('@QUALIFIED_VERSION@','0.0.15');assert '@QUALIFIED_VERSION@' not in text
prompt=E/'prompt.final.md'
with prompt.open('x') as f:f.write(text)
LOGS.mkdir(exist_ok=False);session=str(uuid.uuid4());command=['/Users/ccheever/.grok/bin/grok','--prompt-file',str(prompt),'--cwd',str(LANE),'-m','grok-4.6','--reasoning-effort','xhigh','--output-format','streaming-json','--permission-mode','bypassPermissions','--no-subagents','--session-id',session,'--max-turns','10000']
m={'command':command,'sessionId':session,'model':'grok-4.6','effort':'xhigh','cwd':str(LANE),'promptSha256':sha(prompt),'releaseVerificationSha256':sha(proof),'preparationReceiptSha256':sha(PREP/'preparation-receipt.json'),'ports':ports,'loadAtLaunch':subprocess.check_output(['uptime'],text=True).strip(),'host':'OfficeM1Max; differs from retained M5 comparator','sourceCommit':prep['sourceCommit'],'qualifiedPackageSource':r['qualifiedSource'],'turnLimit':'10000 native orchestration ceiling, not a benchmark token cap','benchmark':'Original full milestones/populations/deadlines unchanged; M7 separate after grading; Grok token accounting null/advisory'}
with (LOGS/'launch-authorized.json').open('x') as f:json.dump(m,f,indent=2)
with (LOGS/'supervisor.log').open('xb') as o:
 p=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'--supervise'],stdin=subprocess.DEVNULL,stdout=o,stderr=subprocess.STDOUT,start_new_session=True)
print(json.dumps({'status':'supervisor-started','pid':p.pid,'sessionId':session}))
