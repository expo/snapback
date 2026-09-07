from pathlib import Path
import re, json, hashlib
packet=Path('../../packet').resolve() if False else Path('../packet').resolve()
root=Path('probes').resolve()
records=[]
for stage in ['source','before']:
 base=packet/stage; target=root/('final' if stage=='source' else 'before'); seen=set()
 def copy(rel):
  if str(rel) in seen:return
  seen.add(str(rel)); p=base/rel
  if not p.is_file():
   assert str(rel)=='snapback2/packages/evaluator/dist/unicode-tables.ts',str(rel)
   p=packet/'evidence/r8-entrypoint-repair/final-standalone-corrected.sources'/rel
  data=p.read_bytes(); out=target/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
  records.append({'stage':stage,'origin':str(p),'copy':str(out),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
  if p.suffix not in ['.ts','.js','.mjs']:return
  for spec in re.findall(r'(?:from\s*|import\s*\(\s*)[\'\"]([^\'\"]+)[\'\"]',data.decode()):
   if not spec.startswith('.'):continue
   dest=(base/rel.parent/spec).resolve(); relative=dest.relative_to(base)
   options=[relative,relative.with_suffix('.ts'),relative.with_suffix('.js'),Path(str(relative)+'.ts')]
   match=next((r for r in options if (base/r).is_file()),None)
   if not match and str(relative)=='snapback2/packages/evaluator/dist/unicode-tables':match=Path(str(relative)+'.ts')
   if not match:raise Exception((str(rel),spec))
   copy(match)
 copy(Path('snapback2/packages/snapback2/src/offline.ts'))
 copy(Path('snapback2/packages/evaluator/src/test-search-v5-fixtures.json'))
(root/'copied-sources.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps({'copies':len(records),'totalBytes':sum(x['bytes'] for x in records),'note':'Conservative static relative import closure, including type-only imports. Exact copies; no product source modifications.'}))
