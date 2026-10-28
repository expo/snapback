"""Summarize completed paired commands; failures never become speed wins."""
import argparse,collections,json,math,pathlib,statistics,re,sys
sys.dont_write_bytecode=True
from replay import messages
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);a=ap.parse_args()
rows=[]
for p in sorted(pathlib.Path('/tmp/lat3').glob('corpus-[0-9].jsonl')):
 rows.extend(json.loads(line) for line in p.read_text().splitlines())
raw_count=len(rows);selected={};setups=[]
for x in rows:
 if 'script'not in x:setups.append(x);continue
 key=(x['wave'],x['lane'],x['script'])
 if key not in selected or x.get('measurementRevision',1)>selected[key].get('measurementRevision',1):selected[key]=x
rows=[*selected.values(),*setups]
for pair in rows:
 if 'script'not in pair:continue
 name=pair['script'].replace(':','-').replace('/','-')
 for variant in ['before','after']:
  log=pathlib.Path('/tmp/lat3/corpus-logs')/f"w{pair['wave']}-{pair['lane']}"/f'{name}-{variant}.log'
  if log.exists():pair[variant]['messages']=messages(log)
def stats(values):
 if not values:return None
 values=sorted(values)
 return {'n':len(values),'median':statistics.median(values),'p90':values[math.ceil(.9*len(values))-1],'max':max(values)}
tables={}
def failure_messages(lines):
 # Node process warnings are diagnostics, not failed assertions. Preserve raw
 # message lists separately; canonicalize copy roots and explicit launch/run
 # identities, never refusal codes, deadlines, rule text or assertion values.
 return [re.sub(r'Browser Wurlitzer [0-9a-f-]{36}', 'Browser Wurlitzer <fixture-uuid>',re.sub(r'(<COPY>/logs/)[0-9a-f-]{36}(\.(?:stderr|stdout)\.log)',r'\1<command-id>\2',re.sub(r'run tag [0-9a-f]{8}', 'run tag <run-id>',re.sub(r'sb4rendered[0-9a-f]{32}', 'sb4rendered<launch-id>',re.sub(r'/tmp/lat3/corpus-\d/[^/]+/(?:before|after)', '<COPY>',line)))))
         for line in lines if not re.match(r'^\s*(?:\|\s*)?\(node:\d+\).*Warning:',line)]
call_differences=[];call_pairs=0;call_records=0;missing_vectors=[]
for pair in rows:
 if pair.get('script')!='probe:serve/client:calls':continue
 directory=pathlib.Path('/tmp/lat3/corpus-logs')/f"w{pair['wave']}-{pair['lane']}"
 records={}
 for variant in ['before','after']:
  path=directory/f'probe-serve-client-calls-{variant}.calls.stdout'
  if not path.exists():continue
  found=[]
  for line in path.read_text(errors='replace').splitlines():
   try:value=json.loads(line)
   except ValueError:continue
   if isinstance(value,dict) and 'op'in value and 'ok'in value:found.append({k:value[k] for k in ['op','role','ok','expected','error'] if k in value})
  records[variant]=found
 if len(records)==2:
  call_pairs+=1
  call_records+=len(records['before'])
  if records['before']!=records['after']:call_differences.append({'wave':pair['wave'],'lane':pair['lane'],'beforeRecords':len(records['before']),'afterRecords':len(records['after'])})
 if pair['before']['code']==pair['after']['code']==0 and (len(records)!=2 or any(not values for values in records.values())):
  missing_vectors.append({'wave':pair['wave'],'lane':pair['lane']})
for scope,waves in [('all',[30,31,32,33,34]),('day-one',[32,34]),('day-two',[33])]:
 selected=[x for x in rows if x.get('wave') in waves]
 table={}
 for script in ['acceptance','frontend:proof','day2:proof','probe:serve/client:calls']:
  pairs=[x for x in selected if x.get('script')==script and x['before']['code']==0 and x['after']['code']==0]
  metrics=['seconds','withoutPreflightSeconds'] if script!='probe:serve/client:calls' else ['seconds','readySeconds','callsSeconds','withoutPreflightSeconds','readyWithoutPreflightSeconds','callsWithoutPreflightSeconds']
  for metric in metrics:
   complete=[p for p in pairs if metric in p['before'] and metric in p['after']]
   table[script+'/'+metric]={v:stats([x[v][metric] for x in complete]) for v in ['before','after']}
 tables[scope]=table
summary={'completedPairs':sum('script'in x for x in rows),'rawRows':raw_count,'explicitlySupersededRows':raw_count-len(rows),'lanes':len({(x['wave'],x['lane']) for x in rows}),
 'setupErrors':[x for x in rows if 'setupError'in x],
 'exitDifferences':[{k:x[k] for k in ['wave','lane','script','before','after']} for x in rows if not x.get('sameExit',True)],
 'nonzeroPairs':[{'wave':x['wave'],'lane':x['lane'],'script':x['script'],'beforeCode':x['before']['code'],'afterCode':x['after']['code']} for x in rows if 'script'in x and (x['before']['code']!=0 or x['after']['code']!=0)],
 'rawMessageDifferenceCount':sum(not x.get('sameMessages',True) for x in rows),
 'messageDifferenceCount':sum(failure_messages(x['before'].get('messages',[]))!=failure_messages(x['after'].get('messages',[])) for x in rows if 'script'in x),
 'clientCallPairsCompared':call_pairs,'clientCallRecordsCompared':call_records,'missingClientCallVectors':missing_vectors,'clientCallDifferences':call_differences,'tables':tables}
pathlib.Path(a.out).write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['completedPairs','lanes','setupErrors','messageDifferenceCount']}))
