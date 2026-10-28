"""Numerical export only. Full stores, credentials and raw app logs remain private."""
import argparse,collections,hashlib,json,math,pathlib,re,statistics
HERE=pathlib.Path(__file__).resolve().parent
DIAGNOSTIC=re.compile(r'snapback4 proof: lingering handles after suite: [A-Za-z]+\(\d+\)(?:, [A-Za-z]+\(\d+\))*; exiting with status \d+')

def stats(values):
 values=sorted(values)
 return {'n':len(values),'median':statistics.median(values),'p90':values[math.ceil(.9*len(values))-1],'max':max(values)} if values else None

def messages(lines):
 result=[]
 for line in lines:
  # This one builder-visible addition is the intended LAT4 behavior. It can be
  # embedded in a parent's multiline assertion; retain raw hashes and count it
  # separately rather than treating its text as a changed underlying failure.
  line=DIAGNOSTIC.sub('',line).rstrip()
  if not line:continue
  line=re.sub(r'/tmp/lat4(?:/[^/]+)?/worker-\d/[^/]+/(?:before|after)','<COPY>',line)
  line=re.sub(r'(<COPY>/logs/)[0-9a-f-]{36}(\.(?:stderr|stdout)\.log)',r'\1<command-id>\2',line)
  line=re.sub(r'Browser Wurlitzer [0-9a-f-]{36}','Browser Wurlitzer <fixture-uuid>',line)
  line=re.sub(r'(Proof (?:Contact|Board)) [0-9a-f]{8}',r'\1 <fixture-uuid-prefix>',line)
  line=re.sub(r'run tag [0-9a-f]{8}','run tag <run-id>',line)
  line=re.sub(r'sb4rendered[0-9a-f]{32}','sb4rendered<launch-id>',line)
  result.append(line)
 return result

def command_summary(root,row,variant):
 name=row['script'].replace(':','-').replace('/','-')+'-'+variant
 directory=root/'logs'/f"w{row['wave']}-{row['lane']}"
 observer=directory/(name+'.observer.jsonl');trace=directory/(name+'.native.jsonl')
 if not observer.exists():return []
 events=[json.loads(s)for s in observer.read_text().splitlines()]
 phases=collections.defaultdict(lambda:collections.defaultdict(float))
 if trace.exists():
  for line in trace.read_text().splitlines():
   event=json.loads(line);phases[event['pid']][event['phase']]+=event['seconds']
 closed={x['child']:x for x in events if x['event']=='command-close'}
 # Count the actual CLI child owned by proof-command, once. The app's spawn of
 # proof-command encloses the same invocation and is not a second CLI command.
 result=[]
 for event in events:
  if event['event']!='command' or event['entry']!='proof-command.js' or event['child']not in closed:continue
  end=closed[event['child']];p=phases[event['child']];security=p.get('deploy.security',0)
  result.append({'verb':event['verb'],'seconds':end['ms']/1000,'code':end['code'],'outsideSecuritySeconds':end['ms']/1000-security,'phases':dict(p)})
 return result

def import_boundary(row,file):
 path=pathlib.Path(f"/home/ccheever/sb4-loop/wave{row['wave']}/apps")/row['lane']/file
 if not path.is_file():return None
 boundary=None;inside=False
 for n,line in enumerate(path.read_text().splitlines(),1):
  if re.match(r'^\s*import\s+(?!\()',line):inside=True
  if inside and ';'in line:
   # An original import-only line cannot contain an authored failing call.
   if not line.split(';',1)[1].strip():boundary=n
   inside=False
 return boundary

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',type=pathlib.Path,default=pathlib.Path('/tmp/lat4'));ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
 raw=[json.loads(l)for p in sorted(a.root.glob('results-*.jsonl'))for l in p.read_text().splitlines()]
 rows=[r for r in raw if 'script'in r];keys=[(r['wave'],r['lane'],r['script'])for r in rows]
 if len(keys)!=len(set(keys)):raise SystemExit('duplicate primary pairs; select declared correction revisions explicitly')
 target=json.loads((HERE.parent/'20261027-lat3/measurements.json').read_text())
 if isinstance(target,dict):target=target.get('pairs',target.get('measurements',target.get('rows',[])))
 # The exact LAT3 successful day-two set, never a newly selected fast subset.
 target_lanes={r['lane']for r in target if r.get('wave')==33 and r.get('script')=='day2:proof'and r['before']['code']==r['after']['code']==0}
 tables={};deltas=[];tails=[];commands={v:collections.defaultdict(list)for v in ['before','after']}
 for r in rows:
  before=messages(r['before'].get('messages',[]));after=messages(r['after'].get('messages',[]))
  # The wrapper introduces an async boundary on an original import-only line.
  # Its added frame is not an authored assertion or call site. Retain raw lists
  # and mark only this synthetic frame, with no error/payload normalization.
  def boundary(line):
   match=re.search(r'(at async file://<COPY>/)(scripts/[^:]+\.mjs):(\d+):(\d+)( \{)?$',line)
   if match and int(match[3])==import_boundary(r,match[2]):
    return line[:match.start()]+match[1]+match[2]+':'+match[3]+':<entry-wrapper>'+(match[5]or'')
   return line
  normalized_same=before==after or len(before)==len(after) and all(x==y or boundary(x)==boundary(y)for x,y in zip(before,after))
  if r['before']['code']!=r['after']['code']or not normalized_same:deltas.append({'wave':r['wave'],'lane':r['lane'],'script':r['script'],'beforeCode':r['before']['code'],'afterCode':r['after']['code'],'sameOperativeMessages':normalized_same})
  for v,lines in [('before',before),('after',after)]:
   r[v]['normalizedMessageSha256']=hashlib.sha256(json.dumps([boundary(line)for line in lines]).encode()).hexdigest()
   r[v]['rawMessageSha256']=hashlib.sha256(json.dumps(r[v].get('messages',[])).encode()).hexdigest()
   for done in r[v].get('completions',[]):tails.append({'wave':r['wave'],'lane':r['lane'],'script':r['script'],'variant':v,**done})
   for command in command_summary(a.root,r,v):
    if command['verb']!='serve':commands[v][command['verb']].append(command)
 for scope,selected in [('all',rows),('LAT3-day2-33',[r for r in rows if r['wave']==33 and r['script']=='day2:proof'and r['lane']in target_lanes])]:
  table={}
  for script in sorted({r['script']for r in selected}):
   pairs=[r for r in selected if r['script']==script and r['before']['code']==r['after']['code']==0]
   table[script]={key:{v:stats([r[v][key]for r in pairs])for v in ['before','after']}for key in ['seconds','withoutPreflightSeconds']}
  tables[scope]=table
 call_differences=[];call_pairs=0;call_records=0;missing_vectors=[]
 for r in rows:
  if r['script']!='probe:serve/client:calls':continue
  directory=a.root/'logs'/f"w{r['wave']}-{r['lane']}";vectors={}
  for v in ['before','after']:
   file=directory/f'probe-serve-client-calls-{v}.calls.stdout';found=[]
   if file.exists():
    for line in file.read_text(errors='replace').splitlines():
     try:value=json.loads(line)
     except ValueError:continue
     if isinstance(value,dict)and'op'in value and'ok'in value:found.append({key:value[key]for key in ['op','role','ok','expected','error']if key in value})
    vectors[v]=found
  if len(vectors)==2:
   call_pairs+=1;call_records+=len(vectors['before'])
   if vectors['before']!=vectors['after']:call_differences.append({'wave':r['wave'],'lane':r['lane'],'beforeRecords':len(vectors['before']),'afterRecords':len(vectors['after'])})
  if r['before']['code']==r['after']['code']==0 and (len(vectors)!=2 or any(not x for x in vectors.values())):missing_vectors.append({'wave':r['wave'],'lane':r['lane']})
 target_rows=[r for r in rows if r['wave']==33 and r['script']=='day2:proof'and r['lane']in target_lanes]
 summary={'qualification':False,'completedPairs':len(rows),'setupErrors':[r for r in raw if 'setupError'in r],'verdictOrMessageDifferences':deltas,'declaredLingeringDiagnosticOccurrences':{v:sum(len(DIAGNOSTIC.findall(line))for r in rows for line in r[v].get('messages',[]))for v in ['before','after']},'LAT3TargetLanes':sorted(target_lanes),'LAT3TargetCoverage':{'expected':len(target_lanes),'observed':len(target_rows),'matchedPassing':sum(r['before']['code']==r['after']['code']==0 for r in target_rows),'nonPassing':[{'lane':r['lane'],'before':r['before']['code'],'after':r['after']['code']}for r in target_rows if r['before']['code']or r['after']['code']]},'tables':tables,'clientCallPairs':call_pairs,'clientCallRecords':call_records,'clientCallDifferences':call_differences,'missingClientCallVectors':missing_vectors,
 'tails':{'completedSuites':len(tails),'overOneSecond':{v:sum(t['variant']==v and t['postCompletionSeconds']>1 for t in tails)for v in ['before','after']},'postCompletionSeconds':{v:stats([t['postCompletionSeconds']for t in tails if t['variant']==v])for v in ['before','after']}},
 'commands':{v:{verb:{'wallSeconds':stats([c['seconds']for c in values]),'outsideSecuritySeconds':stats([c['outsideSecuritySeconds']for c in values]),'count':len(values)}for verb,values in groups.items()}for v,groups in commands.items()}}
 a.out.mkdir(parents=True,exist_ok=True)
 sanitized=[]
 for r in rows:
  value={key:r[key]for key in ['wave','lane','script','beforeBinarySha256','afterBinarySha256']if key in r}
  for v in ['before','after']:value[v]={key:r[v][key]for key in ['code','seconds','startedAt','load','preflightSeconds','withoutPreflightSeconds','normalizedMessageSha256','rawMessageSha256','clientInputDigest','clientOutputDigest']if key in r[v]}
  sanitized.append(value)
 (a.out/'measurements.json').write_text(json.dumps(sanitized,indent=2)+'\n')
 (a.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(a.out/'tails.json').write_text(json.dumps(tails,indent=2)+'\n')
 print(json.dumps({k:summary[k]for k in ['completedPairs','setupErrors','verdictOrMessageDifferences']}))
if __name__=='__main__':main()
