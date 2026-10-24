#!/usr/bin/env python3
"""Replay the bakeoff's independent one-line intents on automatically removed copies."""
import argparse,concurrent.futures,hashlib,json,pathlib,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
repro=pathlib.Path.home()/'sb4-loop/wave26-repro/sec'
labels=['002-specF1','008-specF1','008-specF2','018-specF1','020-specF1','024-specF1','024-specF2','031-specF1','033-specF1','033-specF2','036-specF1','049-specF1']
def measure(label):
 source=repro/label/'snapback';texts=[(f.name,f.read_text()) for f in sorted(source.glob('*.q'))]
 schema=dict(texts)['schema.q'];spec_line=max(i+1 for i,l in enumerate(schema.splitlines()) if l.startswith('invariant '));site=f'schema.q:{spec_line}:1'
 with tempfile.TemporaryDirectory(prefix='sb4-sec10-finding-') as tmp:
  root=pathlib.Path(tmp);(root/'snapback').mkdir()
  for name,text in texts:(root/'snapback'/name).write_text(text)
  r=subprocess.run(['timeout','--kill-after=5s','600',binary,'test'],cwd=root,capture_output=True,text=True)
  witnesses=[]
  for line in r.stdout.splitlines():
   if line.startswith('security violation: '):
    w=json.loads(line[len('security violation: '):])
    if w.get('reachability') in ['authored-fixture-trace','generated-fixture-trace']:witnesses.append(dict(site=w['invariant_site'],operation=w['operation'],effect=w['effect'],history=[s['operation'] for s in w.get('history',[])]))
  row=dict(finding=label,sourceSha256=hashlib.sha256(json.dumps(texts).encode()).hexdigest(),spec=schema.splitlines()[spec_line-1],specSite=site,exit=r.returncode,specWitnesses=sum(w['site']==site for w in witnesses),witnesses=witnesses,summary=[l for l in (r.stdout+'\n'+r.stderr).splitlines() if l.startswith(('security tests:','security histories:','security directed histories:','test:'))])
  (out/(label+'.json')).write_text(json.dumps(row,indent=2)+'\n');return row
with tempfile.TemporaryDirectory(prefix='sb4-sec10-finding-bin-') as private:
 original=pathlib.Path(a.binary).resolve();snapshot=pathlib.Path(private)/'snapback4';shutil.copy2(original,snapshot);binary=str(snapshot)
 (out/'measurement.json').write_text(json.dumps(dict(binarySha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),findings=labels),indent=2)+'\n')
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(measure,labels))
 (out/'results.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(dict(tested=len(rows),caught=sum(r['specWitnesses']>0 for r in rows))))
