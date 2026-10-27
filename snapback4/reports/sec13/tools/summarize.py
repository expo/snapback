"""Compare source-identical private surveys; never relabel new questions as gates."""
import argparse,json,math,statistics,pathlib
p=argparse.ArgumentParser();p.add_argument('before');p.add_argument('after');p.add_argument('out');a=p.parse_args()
def rows(directory):
 return {(r['wave'],r['lane']):r for r in json.loads((pathlib.Path(directory)/'results.json').read_text())}
def percentile(values,q):
 xs=sorted(values);return xs[math.ceil(len(xs)*q)-1]
def output(rs):
 xs=[r['defaultCheck']['lines'] for r in rs.values()];return {'count':len(xs),'median':statistics.median(xs),'p90':percentile(xs,.9),'max':max(xs)}
def gates(r):return sorted((g['code'],g['message'])for g in r['gates'])
before,after=rows(a.before),rows(a.after);assert before.keys()==after.keys();assert len(after)==800
same_hash=[];gate_changes=[];exit_changes=[];witnesses={};tool_failures=[]
for key,b in before.items():
 n=after[key]
 if b['sha256']!=n['sha256']:same_hash.append(key)
 if gates(b)!=gates(n):gate_changes.append({'wave':key[0],'lane':key[1],'before':gates(b),'after':gates(n)})
 if b['checkExit']!=n['checkExit']:exit_changes.append({'wave':key[0],'lane':key[1],'before':b['checkExit'],'after':n['checkExit']})
 if n['checkExit']not in[0,1]or n['defaultCheck']['exit']not in[0,1]:tool_failures.append(key)
 for d in n['reviews']:
  if d['code']in['N_OPTIONAL_EVIDENCE','N_CHILD_EVIDENCE_PRESENCE','N_MOVABLE_TIME_ANCHOR','N_EVENT_TIME_ANCHOR'] and d.get('witness'):
   witnesses[d['code']]=witnesses.get(d['code'],0)+1
result={'schemas':len(after),'sourceHashMismatches':same_hash,'beforeOutput':output(before),'afterOutput':output(after),'gateChanges':gate_changes,'exitChanges':exit_changes,'toolFailures':tool_failures,'selectedWitnessCounts':witnesses,'noNewGateCodes':True}
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
