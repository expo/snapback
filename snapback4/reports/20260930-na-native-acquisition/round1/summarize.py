#!/usr/bin/env python3
import hashlib,json,statistics
from pathlib import Path
root=Path(__file__).parent
result=[]; comparisons=[]
def digest(x): return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def table_hash(x):return hashlib.sha256(json.dumps(['witness-table',x],separators=(',',':')).encode()).hexdigest()
for condition in ['unconfined','ten-cpu-loaded']:
 for account in ['u0500','u0001']:
  d=json.loads((root/'measurements'/condition/account/'acquire.json').read_text())
  assert d['format']==2 and d['passed'] and len(d['runs'])==3
  old=json.loads((root.parent/'after'/condition/account/'acquire.json').read_text())['runs'][0]['coverage']
  checks=[]
  for r in d['runs']:
   c=r['coverage'];s=r['restart'];o=s['offline']
   assert r['passed'] and c==o and s['retained'] and s['completed'] and s['downloadedRows']==0
   assert s['serverPositionSha256']==c['positionSha256']
   expected_groups={table_hash(k):v for k,v in old['groupsByTable'].items()}
   expected_tables={table_hash(k):v for k,v in old['residency']['tables'].items()}
   assert c['groups']==old['groups'] and c['rows']==old['rows'] and c['groupsSha256']==old['groupsSha256']
   assert c['groupsByTable']==expected_groups and c['residency']['tables']==expected_tables
   checks.append({'groupsSha256':c['groupsSha256'],'tableCountsBytesSha256':digest(c['residency']['tables']),'retained':s['retained'],'terminalReconnect':s['completed'],'downloadedRows':s['downloadedRows']})
  values=[r['acquiredMs']/1000 for r in d['runs']]
  result.append({'condition':condition,'account':account,'memberships':d['runs'][0]['coverage']['groupsByTable'][table_hash('messages')], 'rows':d['runs'][0]['coverage']['rows'],'acquiredSeconds':values,'medianSeconds':statistics.median(values),'minSeconds':min(values),'maxSeconds':max(values),'firstLocalSeconds':[r['firstLocalMs']/1000 for r in d['runs']],'restartFirstLocalSeconds':[r['restart']['firstLocalMs']/1000 for r in d['runs']],'restartCoverageVerifiedSeconds':[r['restart']['coverageVerifiedMs']/1000 for r in d['runs']],'sqliteBytes':[r['coverage']['residency']['totalBytes'] for r in d['runs']]})
  comparisons.append({'condition':condition,'account':account,'runs':checks,'matchesRound0':True})
(root/'measurements.json').write_text(json.dumps(result,indent=2)+'\n')
(root/'receipt-checks.json').write_text(json.dumps(comparisons,indent=2)+'\n')
for r in result:print(r['condition'],r['account'],'median',round(r['medianSeconds'],3),'range',round(r['minSeconds'],3),round(r['maxSeconds'],3),'restart',round(statistics.median(r['restartFirstLocalSeconds']),3))
