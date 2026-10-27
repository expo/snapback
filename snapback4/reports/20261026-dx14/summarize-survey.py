#!/usr/bin/env python3
"""Compare the pinned DX14 CLI against Integration27; no qualification claim."""
import argparse,gzip,json,math,statistics
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--checks',default='/tmp/dx14-survey-final');p.add_argument('--wave30',default='/tmp/dx14-survey-wave30');a=p.parse_args()
out=Path(__file__).resolve().parent
base=json.loads(gzip.decompress((out.parent/'integration27/survey-all800.json.gz').read_bytes()))
# Integration27 README: final117 and incoming-main117 supersede the early800 rows.
combined={(r['wave'],r['lane']):r for r in base}
for overlay in ['survey-final.json.gz','survey-merged-main.json.gz']:
 for r in json.loads(gzip.decompress((out.parent/'integration27'/overlay).read_bytes())):combined[(r['wave'],r['lane'])]=r
base=list(combined.values())
checks=json.loads((Path(a.checks)/'results.json').read_text());wave=json.loads((Path(a.wave30)/'results.json').read_text())
key=lambda r:(r['wave'],r['lane'])
old={key(r):r for r in base};new={key(r):r for r in checks}
assert len(new)==len(checks)==800 and new.keys()==old.keys()
assert all(r['sha256']==old[key(r)]['sha256']for r in checks)
def stats(xs):
 xs=sorted(xs);return {'median':statistics.median(xs),'p90':xs[math.ceil(.9*len(xs))-1],'max':max(xs)}
def gates(row,field='gates'):
 return sorted(json.dumps({'id':g['id'],'code':g['code'],'site':g['site'],'witnessId':(g.get('witness')or{}).get('id')},sort_keys=True)for g in row.get(field,[]))
changes=lambda field:[{'wave':r['wave'],'lane':r['lane'],'before':old[key(r)][field],'after':r[field]}for r in checks if old[key(r)][field]!=r[field]]
gate_changes=[{'wave':r['wave'],'lane':r['lane'],'before':gates(old[key(r)]),'after':gates(r)}for r in checks if gates(old[key(r)])!=gates(r)]
assert len(wave)==50 and all(r['sha256']==old[key(r)]['sha256']for r in wave)
production_changes=[{'lane':r['lane'],'before':old[key(r)]['fresh']['exit'],'after':r['fresh']['exit']}for r in wave if old[key(r)]['fresh']['exit']!=r['fresh']['exit']]
production_gates=[{'lane':r['lane'],'before':gates(old[key(r)]['fresh']),'after':gates(r['fresh'])}for r in wave if gates(old[key(r)]['fresh'])!=gates(r['fresh'])]
summary={'baselineComposition':'Integration27 early800 overlaid by final117 then merged-main117, per its README','schemas':800,'wave30FreshDeploys':50,'sourceHashesMatch':True,'checkExitChanges':changes('checkExit'),'blockingGateChanges':gate_changes,'wave30ProductionExitChanges':production_changes,'wave30ProductionGateChanges':production_gates,'beforeAll800CheckLines':stats([r['defaultCheck']['lines']for r in base]),'afterAll800CheckLines':stats([r['defaultCheck']['lines']for r in checks]),'beforeWave30CheckLines':stats([old[key(r)]['defaultCheck']['lines']for r in wave]),'afterWave30CheckLines':stats([r['defaultCheck']['lines']for r in wave]),'beforeWave30DeployLines':stats([old[key(r)]['defaultDeploy']['lines']for r in wave]),'afterWave30DeployLines':stats([r['defaultDeploy']['lines']for r in wave]),'wave30Refused': [{'lane':r['lane'],'check':r['checkExit'],'freshDeploy':r['fresh']['exit']}for r in wave if r['checkExit']or r['fresh']['exit']],'measurement':{'checks':json.loads((Path(a.checks)/'measurement.json').read_text()),'wave30':json.loads((Path(a.wave30)/'measurement.json').read_text())},'scope':'Pinned final-source Cargo test-profile CLI. All800 checks and50 wave30 fresh production attempts; no800-deploy or publication/whole-battery claim. Shared host load and16 vs4 workers prevent controlled latency comparison. Capability-hole coverage and fresh-agent token/wall-time bakeoff were not remeasured.'}
(out/'survey-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
for name,rows in [('survey-checks.json.gz',checks),('survey-wave30.json.gz',wave)]:
 (out/name).write_bytes(gzip.compress((json.dumps(rows,indent=2)+'\n').encode(),mtime=0))
print(json.dumps({k:v for k,v in summary.items()if k not in ['measurement','scope']},indent=2))
