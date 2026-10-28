"""Keep literal comparison red; audit only the explicitly ticketed upload IDs."""
import ast,importlib.util,sys
from identity_validation import *
TOOLS=BASE/'identity-tools';missing=object()
def functions(path,names):
 tree=ast.parse(path.read_text());ns={'json':json,'collections':collections,'missing':missing}
 exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in names],type_ignores=[]),str(path),'exec'),ns);return ns
tools=load(TOOLS/'provenance.json')
for name,expected in tools['sha256'].items():assert sha(TOOLS/name)==expected
direct_functions=functions(TOOLS/'direct-upload-audit.py',{'canonical','diff','get','leaves','scope','audit'})
direct=direct_functions['audit']
spec=importlib.util.spec_from_file_location('integration30_copied',BASE/'copied-upload-v046-audit.py')
copied=importlib.util.module_from_spec(spec);spec.loader.exec_module(copied)
root=BASE/'identity';census=validate_census(root)
origins=load(TOOLS/'reviewed-upload-origins.json');origins.update(load(TOOLS/'additional-upload-origins.json'))
extra=BASE/'identity-origins-extra.json'
if extra.exists():
 additions=load(extra);assert set(additions).isdisjoint(origins)
 for origin in additions.values():assert 'sourceSha256'in origin
 origins.update(additions)
for key,origin in origins.items():
 assert type(origin['assetFields'])is list and origin['assetFields']
 if key not in census['inputHashes']:continue
 if 'sourceSha256'in origin:assert origin['sourceSha256']==census['inputHashes'][key][0]
 wave,lane=key.split('/',1);app=pathlib.Path.home()/'sb4-loop'/f'wave{wave}'/'apps'/lane/'snapback'
 text='\n'.join(p.read_text()for p in sorted(app.glob('*.q')))
 for field in origin['assetFields']:
  assert type(field)is str and re.search(r'\b'+re.escape(field)+r'\s*:\s*(?:image|file|video)\b',text),(key,field)
copied_origin=load(TOOLS/'reviewed-copied-upload-origin.json')[copied.KEY]
assert census['inputHashes'][copied.KEY][0]==copied_origin['sourceSha256']
def valid_nonce_pair(x,y):
 return bool(type(x)is str and type(y)is str and re.fullmatch('[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}',x)and re.fullmatch('[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}',y)and x[:10]==y[:10])
def audit(key,a,b):
 if key in origins:
  result=direct(a,b,set(origins[key]['assetFields']))
  if result['accepted']:
   for path,x,y in direct_functions['diff'](a,b):
    if not valid_nonce_pair(x,y):return dict(accepted=False,reason='Malformed upload ULID or changed logical timestamp',path=list(path))
  return result
 if key==copied.KEY:
  result=copied.audit_envelope(a,b)
  if result['accepted']:
   for prefix in [('reviews',),('security','securityReviews')]:
    try:left,right=copied.get(a,prefix),copied.get(b,prefix)
    except(KeyError,TypeError):continue
    for x,y in zip(left,right):
     if (x.get('witness')or{}).get('id')!=copied.WITNESS:continue
     for old,new in zip(x['witness']['supportingRows']['siteSurveys'],y['witness']['supportingRows']['siteSurveys']):
      for field in copied.FIELDS:
       if not valid_nonce_pair(old[field],new[field]):return dict(accepted=False,reason='Malformed copied upload ULID or changed logical timestamp')
  return result
 return dict(accepted=False,reason='Source has no explicit typed-upload origin allowance')
exceptions=[];unexplained=[];tiers=collections.Counter()
for wave,lane in census['keys']:
 name=f'w{wave}-{lane}.json';item=load(root/name,census['manifest'][name]);pairs=collections.defaultdict(dict)
 for row in item['rows']:pairs[row['mode'],row['temperature']][row['label']]=row
 reviews=pairs['check','cold']['candidate']['security'].get('reviews')or[]
 ids=[r['id']for r in reviews];assert len(ids)==len(set(ids)),(wave,lane,'duplicate decision ID')
 for r in reviews:tiers['gate'if r['gated']else'question'if r.get('witness')else'advisory']+=1
 for mode,temp in MATRIX:
  a,b=(pairs[mode,temp][label]['security']for label in ['baseline','candidate'])
  if canonical(a)==canonical(b):continue
  result=audit(f'{wave}/{lane}',a,b);row=dict(wave=wave,lane=lane,mode=mode,temperature=temp,**result)
  (exceptions if result['accepted']else unexplained).append(row)
assert len(exceptions)+len(unexplained)==len(census['mismatches'])
self_rows=[];self_complete=False
if '--verify-self'in sys.argv:
 for choice,a,b,capture_sha in validate_replays(BASE/'control-self-replays',census):
  result=audit(f"{choice['wave']}/{choice['lane']}",a,b);assert result['accepted'],(choice,result)
  self_rows.append(dict(**choice,sha256=capture_sha,audit=result))
 self_complete=True
report=dict(schemas=len(census['keys']),pairedComparisons=len(census['keys'])*6,invocations=len(census['keys'])*12,workers=4,literalExact=len(census['keys'])*6-len(census['mismatches']),literalNonmatches=len(census['mismatches']),allowedUploadIdExceptions=len(exceptions),unexplained=unexplained,toolFailures=[],inputMismatches=[],uniqueDecisionIds=True,tiers=dict(tiers),strictComparatorExit=1 if census['mismatches']else 0,unchangedControlReproductionsComplete=self_complete,identityModuloTicketedUploadIds=self_complete and not unexplained,censusBinding=census['binding'],censusBindingSha256=census['bindingSha256'],censusProvenance=census['provenance'],exceptions=exceptions,unchangedControlSelfReproductions=self_rows,method='Complete scalar-exact census remains unchanged. Allow only explicitly source-bound typed media metadata IDs with all other fields exact, bijective graph aliases, valid ULIDs and identical logical timestamps; copied-ID presentation only in the two fixed source-bound witnesses of the same ticket case. Every differing schema independently reproduces the same class of drift in two unchanged-control runs. No arbitrary ID/text/array normalization or reuse of historical capture approvals.',toolHashes={str(p.name):sha(p)for p in[BASE/'identity_validation.py',pathlib.Path(__file__),BASE/'reproduce-control-upload.py',REPO/'snapback4/reports/lat1/measure.py',TOOLS/'direct-upload-audit.py',TOOLS/'copied-upload-audit.py',TOOLS/'provenance.json',TOOLS/'reviewed-upload-origins.json',TOOLS/'additional-upload-origins.json',TOOLS/'reviewed-copied-upload-origin.json',BASE/'identity-validator-provenance.json',BASE/'copied-upload-v046-audit.py',BASE/'copied-upload-v046-origin.json',BASE/'copied-upload-v046-controls.py',BASE/'copied-upload-v046-controls.json',BASE/'warm-administration-controls.py',BASE/'warm-administration-controls.json',REPO/'snapback4/reports/integration29/sequential-payload-difference.json',*([extra] if extra.exists() else [])]})
atomic_json(root/'capture-manifest.json',census['manifest']);atomic_json(root/'identity-qualification.json',report)
assert validate_census(root)['bindingSha256']==census['bindingSha256']
print(json.dumps({k:v for k,v in report.items()if k not in ['exceptions','unchangedControlSelfReproductions','censusProvenance']},indent=2))
if unexplained:raise SystemExit(1)
