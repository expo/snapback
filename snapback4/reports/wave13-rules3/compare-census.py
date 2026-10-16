"""Compare recorded CLI checks, fail if a formerly clean schema is refused."""
from pathlib import Path
import collections,json
root=Path(__file__).parent
before=json.loads((root/'before.json').read_text())
after=json.loads((root/'after.json').read_text())
def counts(rows):
    result=collections.Counter()
    def visit(value):
        if isinstance(value,dict):
            if 'code' in value: result[value['code']]+=1
            for item in value.values(): visit(item)
        elif isinstance(value,list):
            for item in value: visit(item)
    for row in rows: visit(row['result'])
    return dict(sorted(result.items()))
assert [r['lane'] for r in before]==[r['lane'] for r in after]
assert len(before)==100
new=[new['lane'] for old,new in zip(before,after) if old['exit']==0 and new['exit']!=0]
summary={'lanes':100,'before_pass':sum(r['exit']==0 for r in before),
    'after_pass':sum(r['exit']==0 for r in after),'newly_refused_clean_schemas':new,
    'before_codes':counts(before),'after_codes':counts(after)}
(root/'census-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
assert not new, f'New refusals: {new}'
