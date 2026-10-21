#!/usr/bin/env python3
"""Re-check and re-audit authored fresh-builder intent against a supplied binary."""
import argparse,concurrent.futures,hashlib,json,pathlib,shutil,subprocess,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parent

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--binary',required=True);parser.add_argument('--out',default='builders-final');args=parser.parse_args()
 binary=pathlib.Path(args.binary).resolve();digest=hashlib.sha256(binary.read_bytes()).hexdigest();out=ROOT/args.out;out.mkdir(exist_ok=True)
 inputs=[p.parent for cohort in ['builders','builders-extra'] for p in (ROOT/cohort).glob('*/provenance.json')]
 def evaluate(source):
  report=out/source.name;report.mkdir(exist_ok=True);summary={'lane':source.name,'binarySha256':digest,'sourceEvidence':str(source.relative_to(ROOT)),'commands':[]}
  with tempfile.TemporaryDirectory(prefix='sb4-sec5-builder-recheck-') as name:
   project=pathlib.Path(name);shutil.copytree(source/'final',project/'snapback');(project/'package.json').write_text('{}\n')
   for verb in ['check','audit']:
    started=time.monotonic();command=['timeout','30s',str(binary),verb,'--json'];result=subprocess.run(command,cwd=project,capture_output=True,text=True)
    (report/(verb+'.json')).write_text(result.stdout);(report/(verb+'.stderr.txt')).write_text(result.stderr)
    row={'verb':verb,'command':command,'exitCode':result.returncode,'seconds':round(time.monotonic()-started,3)}
    try:
     document=json.loads(result.stdout);security=document['security'] if verb=='check' else document;invariants=security['invariants']
     row['verdictCounts']={status:sum(v['status']==status for v in invariants) for status in ['proved','refuted','unproved']}
     row['refuted']=[{'table':v['invariant']['table'],'column':v['invariant']['column'],'target':v['invariant']['target'],'operation':(v.get('counterexample') or {}).get('operation'),'reachability':(v.get('counterexample') or {}).get('reachability')} for v in invariants if v['status']=='refuted']
    except Exception as error:row['parseError']=str(error)
    summary['commands'].append(row)
  (report/'provenance.json').write_text(json.dumps(summary,indent=2)+'\n');return summary
 summaries=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
  for result in executor.map(evaluate,sorted(inputs)):
   summaries.append(result);print(json.dumps(result),flush=True)
 (out/'summary.json').write_text(json.dumps({'binary':str(binary),'binarySha256':digest,'lanes':summaries},indent=2)+'\n')
if __name__=='__main__':main()
