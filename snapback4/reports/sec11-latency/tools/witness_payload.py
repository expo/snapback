"""Rename only uploaded asset IDs discovered through compiler-typed asset slots."""
import copy,re
ULID=re.compile(r'^[0-9A-HJKMNP-TV-Z]{26}$')
def canonical(row,types):
 ids=set()
 def asset(value,kind):
  if not isinstance(kind,dict):return
  if 'Optional'in kind:asset(value,kind['Optional']);return
  for tag in ['List','ListRange']:
   if tag in kind:
    for item in value.get('Array',[])if isinstance(value,dict)else[]:asset(item,kind[tag]['of'])
    return
  if any(tag in kind for tag in ['Image','Video','File']):
   identity=value.get('Map',{}).get('id',{}).get('Id')if isinstance(value,dict)else None
   if isinstance(identity,str)and ULID.fullmatch(identity):ids.add(identity)
 def image(value,table):
  fields=value.get('Row',{})if isinstance(value,dict)else{}
  for column,kind in types['columns'].get(table,{}).items():asset(fields.get(column),kind)
 def rows(world):
  for table,values in (world or {}).items():
   for value in values:image(value,table)
 def arguments(values,operation):
  for name,kind in types['arguments'].get(operation,{}).items():asset((values or {}).get(name),kind)
 for mode in ['check','fresh','afterTest']:
  for verdict in row[mode]['counterexamples']:
   c=verdict['counterexample'];table=verdict['invariant']['table']
   image(c.get('row'),table);image(c.get('old'),table);rows(c.get('supporting_rows'))
   rows((c.get('observations')or{}).get('absent_rows'))
   arguments(c.get('args'),c.get('operation'))
   for step in c.get('history',[]):
    arguments(step.get('args'),step.get('operation'));rows((step.get('result')or{}).get('committedRows'))
 # The ordered payload supplies an injective naming, preserving every equality
 # edge. Other nominal IDs, opaque strings, asset facts and all fields survive.
 labels={}
 def replace(value):
  if isinstance(value,dict):
   if set(value)=={'Id'}and value['Id']in ids:
    identity=value['Id'];labels.setdefault(identity,f'$uploaded-asset-{len(labels)}');return {'Id':labels[identity]}
   return {k:replace(value[k])for k in sorted(value)}
  if isinstance(value,list):return[replace(v)for v in value]
  return value
 return replace(row),len(labels)
