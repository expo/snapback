
import hashlib,json,os,sys
from pathlib import Path
base=Path('/Users/ccheever/clique-improvement/revisions/cli-018-publication-preparation-r1/bundle')
sys.path.insert(0,str(base))
from control import safe_event,identity
b=json.loads((base/'bindings.json').read_text())
source=Path(b['source']);run=Path(b['remoteRun'])
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
events=[safe_event(json.loads(x)) for x in (run/'events.jsonl').read_text().splitlines()]
working=source/'snapback2/dist/npm/publish-snapback2-darwin-arm64-0.0.18/resume.json'
metric=source/'snapback2/metrics/loop.jsonl'
result={'remoteEvents':events,'privateStorageAbsent':{n:not os.path.lexists(run/n) for n in ['cache','logs','tmp']},'ownedRunLeaves':sorted(p.name for p in run.iterdir()),'workingResumeSha256':digest(working),'workingResumeMode':oct(working.stat().st_mode&0o777),'metricSha256':digest(metric),'metricRows':len(metric.read_bytes().splitlines()),'priorWorkingResumeSha256':digest(run/'prior-working-resume.json'),'metricBaselineSha256':digest(run/'metric-baseline.jsonl'),'bundleSha256':digest(base/'bundle.json'),'ownedIdentityObservations':{str(pid):identity(pid) for pid in sorted({e['pid'] for e in events if 'pid' in e})},'configContentsRead':False,'activationInvoked':False}
metric_all=(run/'metric-all-original-bytes.jsonl').read_bytes()
metric_append=(run/'metric-own-append.jsonl').read_bytes()
baseline=(run/'metric-baseline.jsonl').read_bytes()
assert metric_all==baseline+metric_append and len(baseline.splitlines())==226 and len(metric_append.splitlines())==1
row=json.loads(metric_append)
assert set(row)=={'at','publish_s','production_binary_bytes','production_binary_without_engine_bytes','production_binary_with_engine_bytes','production_media_binary_bytes','engine','dry'}
assert row['engine']=='ibex2 + vanilla hermes' and row['dry'] is False
assert row['production_binary_bytes']==b['resume']['withEngineBytes'] and row['production_binary_with_engine_bytes']==b['resume']['withEngineBytes'] and row['production_binary_without_engine_bytes']==b['resume']['withoutEngineBytes'] and row['production_media_binary_bytes']==b['resume']['mediaBytes']
assert type(row['publish_s']) in (int,float) and 0<=row['publish_s']<=1800
import datetime
assert isinstance(row['at'],str) and len(row['at'])==24
datetime.datetime.strptime(row['at'],'%Y-%m-%dT%H:%M:%S.%fZ')
assert hashlib.sha256(baseline).hexdigest()==b['metricSha256']
result['metricAllSha256']=hashlib.sha256(metric_all).hexdigest()
result['metricAppendText']=metric_append.decode('ascii')
result['metricAppendSha256']=hashlib.sha256(metric_append).hexdigest()
print(json.dumps(result))
