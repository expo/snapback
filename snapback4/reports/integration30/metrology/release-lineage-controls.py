from pathlib import Path
import json,runpy,copy,hashlib
p=Path(__file__).parent;explain=runpy.run_path(str(p/'release-field-lineage.py'))['explain'];rows=json.loads((p/'release150.json').read_text())['results'];checks=[]
for r in rows:
 q=r.get('rollback1',{})
 if not q.get('missingColumns'):continue
 lane=next((Path.home()/f"sb4-loop/wave{r['wave']}/apps").glob(r['lane']+'-snapback-*'));src=(lane/'snapback/schema.q').read_text();lineages=explain(src,q['rowShape'],q['missingColumns'])
 for item in lineages:
  shape=copy.deepcopy(q['rowShape']);table=item.get('child',item['parent']);shape['tables'][table].remove(item['column'])
  try:explain(src,shape,q['missingColumns'])
  except AssertionError:checks.append(dict(wave=r['wave'],lane=r['lane'],field=item['old'],negative='actual served target column removed',rejected=True))
  else:raise AssertionError('missing served column accepted')
  bad=src.replace('renamed from '+item['old'],'renamed from unbound_control')if item['kind']=='declared rename'else src.replace(item['declaration'],item['declaration'].replace(' from ',' from unbound_'))
  assert bad!=src
  try:explain(bad,q['rowShape'],q['missingColumns'])
  except AssertionError:checks.append(dict(wave=r['wave'],lane=r['lane'],field=item['old'],negative='authored lineage removed',rejected=True))
  else:raise AssertionError('undeclared lineage accepted')
result=dict(positiveRollbackPopulations=32,negativeControls=len(checks),allPass=True,checks=checks,toolSha256=hashlib.sha256((p/'release-field-lineage.py').read_bytes()).hexdigest(),auditSha256=hashlib.sha256((p/'release150-audit.py').read_bytes()).hexdigest(),controlsSourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
(p/'release-lineage-controls-retained.json').write_text(json.dumps(result,indent=2)+'\n');print('lineage negative controls',len(checks),'PASS')
