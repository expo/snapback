"""Keep literal hashes; project only the three existing successful timing strings."""
import argparse,collections,hashlib,json,math,pathlib,re,statistics

def stats(values):
 values=sorted(values)
 return {'n':len(values),'median':statistics.median(values),'p90':values[math.ceil(.9*len(values))-1],'max':max(values)}if values else None

def output(root,row,variant):
 result=row[variant];suffix='-rollback'if result.get('activationAttempted')is False else ''
 stem=root/row['lane']/(row['scenario']+'-'+variant+suffix)
 raw=stem.with_suffix('.stdout').read_bytes();stderr=stem.with_suffix('.stderr').read_bytes()
 if result['code']!=0:return hashlib.sha256(raw+b'\0'+stderr).hexdigest()
 try:value=json.loads(raw)
 except ValueError:return hashlib.sha256(raw+b'\0'+stderr).hexdigest()
 for path in [('adoption',),('details',),('preview','phases')]:
  parent=value
  for key in path[:-1]:parent=parent.get(key,{})if isinstance(parent,dict)else{}
  if isinstance(parent,dict)and isinstance(parent.get(path[-1]),str):
   parent[path[-1]]=re.sub(r'; [0-9]+(?:\.[0-9]+)? ms$','; <elapsed-ms>',parent[path[-1]]) if path==('adoption',) else re.sub(r'\b[0-9]+(?:\.[0-9]+)? ms\b','<elapsed-ms>',parent[path[-1]])
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\0'+stderr).hexdigest()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--roots',type=pathlib.Path,nargs='+',required=True);ap.add_argument('--out',type=pathlib.Path,required=True);ap.add_argument('--corrections-root',type=pathlib.Path);a=ap.parse_args()
 rows=[];errors=[];superseded=[];corrections=[]
 if a.corrections_root:
  corrections=[json.loads(line)for p in sorted(a.corrections_root.glob('results-*.jsonl'))for line in p.read_text().splitlines()]
 corrected={r['lane']for r in corrections}
 for lane in corrected:
  if {r.get('scenario')for r in corrections if r['lane']==lane}!={'unchanged','reactivate','new-release'}:raise SystemExit('incomplete explicit corrected lane')
 for root in [*a.roots,*([a.corrections_root]if a.corrections_root else [])]:
  for p in sorted(root.glob('results-*.jsonl')):
   for line in p.read_text().splitlines():
    r=json.loads(line)
    if root!=a.corrections_root and r['lane']in corrected:superseded.append(r);continue
    if 'scenario'not in r:errors.append(r);continue
    r['outputIgnoringDeclaredElapsedFieldsEqual']=output(root,r,'before')==output(root,r,'after');rows.append(r)
 table={}
 for scenario in sorted({r['scenario']for r in rows}):
  pairs=[r for r in rows if r['scenario']==scenario and r['before']['code']==r['after']['code']==0 and r['before'].get('activationAttempted',True)and r['after'].get('activationAttempted',True)]
  table[scenario]={v:stats([r[v]['withoutPreflightSeconds']for r in pairs])for v in ['before','after']}
 result={'qualification':False,'rows':len(rows),'setupErrors':errors,'explicitlySupersededAttempts':superseded,'literalOutputEqual':sum(r['sameOutput']for r in rows),'allStoreDumpsEqual':all(r['sameStore']for r in rows),'allReleaseFilesEqual':all(r['sameReleaseFiles']for r in rows),'outputDifferencesBeyondDeclaredElapsedFields':[{'lane':r['lane'],'scenario':r['scenario']}for r in rows if not r['outputIgnoringDeclaredElapsedFieldsEqual']], 'nonSecuritySeconds':table,'cases':rows,'notes':['Full canonical store dumps include every table, column, row and metadata field; no normalization.','Only successful JSON strings at adoption, details and preview.phases project numeric ms durations. Literal hashes remain. No error, assertion, id, rule, count, timestamp or refusal is normalized.','Clock-controlled identity is distinct from unmodified-realtime wall-time qualification.']}
 a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['rows','setupErrors','allStoreDumpsEqual','allReleaseFilesEqual','outputDifferencesBeyondDeclaredElapsedFields']}))
if __name__=='__main__':main()
