"""Group monotonic checkpoint batches for rule evaluation without rotating or resampling."""
import json,pathlib
base=pathlib.Path('target/sq')
for kind in ['immediate','warm']:
 result={'method':'Same-process replay; monotonic checkpoints; original per-checkpoint round numbers retained','rounds':[]}
 for checkpoint,stage in [('10%','10pct'),('50%','50pct'),('full','full')]:
  data=json.loads((base/f'{checkpoint}-live-{kind}-curve.json').read_text())
  for batch in data['rounds']:
   batch['stage']=stage
   result['rounds'].append(batch)
 (base/f'live-{kind}-curve.json').write_text(json.dumps(result,indent=2)+'\n')
