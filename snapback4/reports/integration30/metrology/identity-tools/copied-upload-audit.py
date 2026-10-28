"""Explicit ticket-case origin audit. Never changes the literal census or its exit.
Only wave23/008, fixed N_ARGUMENT_GRANT witness. No general ID normalization.
"""
import pathlib,json,copy,hashlib,collections,re,sys
KEY='23/008-snapback-arborist-removal-quotes'
WITNESS='60880cab49cccc6e4c7388db71671006157b1443846ceaf4cfc840958a1dc2ce'
FIELDS=('buildingsPhoto','linesPhoto','treePhoto')
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def get(v,p):
 for k in p:v=v[k]
 return v
def leaves(v,p=()):
 if isinstance(v,dict):
  for k,value in v.items():yield from leaves(value,p+(k,))
 elif isinstance(v,list):
  for i,value in enumerate(v):yield from leaves(value,p+(i,))
 else:yield p,v
def audit_witness(a,b):
 try:
  assert a['id']==b['id']==WITNESS
  assert a['candidate']==b['candidate']=="invariant siteSurveys.always only exists roles[principal = .homeowner, role = 'homeowner']"
  assert a['operation']==b['operation']=='provision'
  assert a['reachability']==b['reachability']=='generated-fixture-trace'
  ar=a['supportingRows']['siteSurveys'];br=b['supportingRows']['siteSurveys'];assert len(ar)==len(br)==2
  mapping={};reverse={};paths=set()
  for i,(left,right)in enumerate(zip(ar,br)):
   assert left['id']==right['id'] and left['initial']is True and right['initial']is True
   assert left['initialKey']==left['quote']==right['initialKey']==right['quote']
   for field in FIELDS:
    x,y=left[field],right[field]
    assert type(x)is str and type(y)is str and re.fullmatch('[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}',x)and re.fullmatch('[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}',y)
    assert x not in mapping and y not in reverse
    mapping[x]=y;reverse[y]=x;paths.add(('supportingRows','siteSurveys',i,field))
  # The graph origins are the two initial rows produced by openQuote's explicit
  # copies of image argument .id. Row identity/order and every other field stay exact.
  for image in ('old','row'):
   for field in FIELDS:
    x,y=a[image][field],b[image][field]
    if x is None:assert y is None
    else:
     assert type(x)is str and mapping.get(x)==y
     paths.add((image,field))
  assert not({x for x,y in mapping.items()if x!=y}&set(reverse))
  assert not({y for x,y in mapping.items()if x!=y}&set(mapping))
  expected=copy.deepcopy(a)
  for p in paths:
   container=get(expected,p[:-1]);container[p[-1]]=mapping[container[p[-1]]]
  # This field is serialized from a BTreeSet, NOT a chronology. Require exactly
  # the lexically sorted unique set on both sides, including every unchanged ID.
  ag,bg=a['generatedIds'],b['generatedIds'];assert all(type(x)is str for x in ag+bg)
  assert ag==sorted(set(ag)) and bg==sorted(set(bg))
  assert set(mapping)<=set(ag) and set(reverse)<=set(bg)
  expected['generatedIds']=sorted(mapping.get(x,x)for x in ag)
  # Rendered summary may differ only at the explicit copied-ID JSON properties.
  # Match complete property/value tokens, never arbitrary strings or substrings.
  summary=a['summary']
  for field in FIELDS:
   for x,y in mapping.items():
    token='"'+field+'":"'+x+'"';replacement='"'+field+'":"'+y+'"'
    summary=summary.replace(token,replacement)
  expected['summary']=summary
  # No other string occurrence of either origin may be silently recolored.
  # Opaque data, callers, args, histories, IDs and relationship edges remain exact.
  for p,x in leaves(a):
   if type(x)is str and(x in mapping or x in reverse):
    assert p in paths or p[:1]==('generatedIds',)
  assert canonical(expected)==canonical(b)
  return dict(accepted=True,idPairs=len(mapping),witnessId=WITNESS)
 except(AssertionError,KeyError,TypeError,ValueError)as e:return dict(accepted=False,reason=type(e).__name__+': '+str(e))
def audit_envelope(a,b):
 expected=copy.deepcopy(a);results=[]
 for prefix in [('reviews',),('security','securityReviews')]:
  try:av=get(a,prefix);bv=get(b,prefix)
  except(KeyError,TypeError):continue
  assert type(av)is list and type(bv)is list and len(av)==len(bv)
  for i,(left,right)in enumerate(zip(av,bv)):
   if canonical(left)==canonical(right):continue
   if left.get('code')!='N_ARGUMENT_GRANT' or right.get('code')!='N_ARGUMENT_GRANT':return dict(accepted=False,reason='different question family')
   probe=copy.deepcopy(left);probe['witness']=right.get('witness')
   if canonical(probe)!=canonical(right):return dict(accepted=False,reason='question metadata differs')
   result=audit_witness(left['witness'],right['witness']);results.append(result)
   if not result['accepted']:return result
   get(expected,prefix)[i]=copy.deepcopy(right)
 return dict(accepted=bool(results)and canonical(expected)==canonical(b),witnesses=results)
def main():
 root=pathlib.Path(sys.argv[1]);manifest=json.loads(pathlib.Path(sys.argv[2]).read_text());origin=manifest[KEY]
 source=pathlib.Path.home()/'sb4-loop/wave23/apps/008-snapback-arborist-removal-quotes/snapback';texts=[(q.name,q.read_text())for q in sorted(source.glob('*.q'))]
 source_hash=hashlib.sha256(canonical(dict(current=texts,predecessor=[])).encode()).hexdigest();assert source_hash==origin['sourceSha256']
 text='\n'.join(t for n,t in texts)
 for token in origin['requiredSourceText']:assert token in text
 item=json.loads((root/'w23-008-snapback-arborist-removal-quotes.json').read_text());pairs=collections.defaultdict(dict)
 for row in item['rows']:
  assert row['sourceSha256']==source_hash
  pairs[row['mode'],row['temperature']][row['label']]=row
 results=[]
 for(mode,temp),pair in pairs.items():
  a,b=pair['baseline']['security'],pair['candidate']['security']
  exact=canonical(a)==canonical(b);result=dict(accepted=True,exact=True)if exact else audit_envelope(a,b)
  results.append(dict(mode=mode,temperature=temp,**result))
 report=dict(key=KEY,method='Separate source-bound ticket-case audit. Graph bijection from six openQuote copied image IDs. All other typed values, question metadata, IDs, callers, histories, row order and opaque strings exact. generatedIds must be a sorted unique BTreeSet rendering on each side and the mapped set must match. Only explicit copied-ID property tokens in summary may vary. Original literal comparator and failures unchanged.',sourceSha256=source_hash,rows=results,ok=all(r['accepted']for r in results))
 (root/'copied-upload-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));assert report['ok']
if __name__=='__main__':main()
