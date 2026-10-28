# Integration30 adaptation: current paths/cardinality/binary pins; unique disposition IDs checked in every mode.
# Historical review validation is omitted: these are fresh captures, not the old reviewed bytes.
"""Read-only complete census and self-replay validators. No product execution."""
import pathlib,json,hashlib,ast,collections,re,copy
REPO=pathlib.Path('/home/ccheever/projects/snapback-sb4loop')
BASE=pathlib.Path(__file__).parent
MATRIX=(('check','cold'),('check','warm'),('staging','cold'),('staging','warm'),('review','cold'),('production','cold'))
CANDIDATE='e01da19c3cde5ba6c81dae725983e09a4441924fb91c800eeb37a3ea95778778'
CONTROL='0c1bab788d27d51df03ccefdd758ee05f10a968b6f6cb54d87fc997c57dd3562'
COMMANDS={'check':['check'],'review':['check','--review'],'production':['deploy','release'],'staging':['deploy','release','--staging']}
SCOPES={'direct':'direct-six-reviewed-media-fields','copied':'copied-wave23-008-fixed-witness'}
VERDICT_LINES={'direct':'**READY for the narrowly scoped direct-upload audit of these six cases.** I found no material acceptance hole in the inspected payloads.','copied':'**READY — only for this limited exception audit.** No blocking finding for the fixed captured witness and source.'}
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def digest(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def load(path,expected=None):
 raw=path.read_bytes()
 if expected is not None:assert hashlib.sha256(raw).hexdigest()==expected,('stale capture',str(path))
 return json.loads(raw)
def atomic_json(path,value):
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)
def extraction():
 path=REPO/'snapback4/reports/lat1/measure.py';tree=ast.parse(path.read_text());ns={'json':json}
 exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='envelope'],type_ignores=[]),str(path),'exec'),ns);return ns['envelope']
envelope=extraction()
def inputs(wave,lane):
 app=pathlib.Path.home()/'sb4-loop'/f'wave{wave}'/'apps'/lane;texts=[(p.name,p.read_text())for p in sorted((app/'snapback').glob('*.q'))];assert texts
 prior=[]
 if wave==31:prior=[(p.name,p.read_text())for p in sorted((pathlib.Path.home()/'sb4-loop/wave31/v1-clients'/lane/'snapback').glob('*.q'))];assert prior
 fixtures=[(p.relative_to(app/'fixtures').as_posix(),sha(p))for p in sorted((app/'fixtures').rglob('*.jsonl'))]
 return digest(dict(current=texts,predecessor=prior)),digest(fixtures)
def string(v):assert type(v)is str and v

def site(v):
 assert type(v)is dict
 string(v['file']);assert type(v['line'])is int and v['line']>0 and type(v['col'])is int and v['col']>0

def report_shape(report):
 assert type(report)is dict and type(report['format'])is int and report['format']==1;string(report['scope'])
 for key in ['exclusions','invariants','exposures','notes','uncovered','campaign_coverage']:assert type(report[key])is list
 assert type(report['roles'])is dict
 for key in ['exclusions','campaign_coverage']:
  for value in report[key]:string(value)
 for values in report['roles'].values():assert type(values)is list and all(type(x)is str for x in values)
 for verdict in report['invariants']:
  assert type(verdict)is dict and verdict['status']in ['proved','refuted','unproved']and verdict['direct_rule']in ['proved','refuted','unproved']
  assert {'counterexample','invariant','obligations','paths','reasons'}<=verdict.keys()
  inv=verdict['invariant'];assert type(inv)is dict and {'column','operation','policy','requirements','site','table','target','predicate','unsupported'}<=inv.keys();site(inv['site'])
  for key in ['table','target','predicate']:string(inv[key])
  for key in ['paths','reasons','obligations']:assert type(verdict[key])is list
  assert verdict['counterexample']is None or type(verdict['counterexample'])is dict
  for obligation in verdict['obligations']:
   assert obligation['status']in ['proved','refuted','unproved'];string(obligation['path']);string(obligation['reason']);assert obligation['repair']is None or type(obligation['repair'])is str
 for note in report['notes']:
  string(note['code']);string(note['message']);site(note['site']);assert type(note['mechanical'])is bool

def reviews_shape(reviews):
 assert type(reviews)is list
 assert len({r["id"]for r in reviews})==len(reviews),"duplicate disposition ID"
 for r in reviews:
  assert type(r)is dict and {'family','id','code','site','gated','acknowledged','recorded','reason','scope','witness'}<=r.keys()
  assert type(r['id'])is str and re.fullmatch('[0-9a-f]{64}',r['id'])
  for key in ['code','site','scope']:string(r[key])
  for key in ['gated','acknowledged','recorded']:assert type(r[key])is bool
  for key in ['family','reason']:assert r[key]is None or type(r[key])is str
  if r['witness']is not None:
   assert type(r['witness'])is dict and type(r['witness']['id'])is str and re.fullmatch('[0-9a-f]{64}',r['witness']['id'])

WARM_REACTIVATIONS={
 '27/032-snapback-service-dog-placements':'4a50e461cb0999d663ca4f11f986b70db6fd54cdc169aef5856cc7458cf295a7',
 '31/020-snapback-fat-bike-tours':'9742ee0c59ea70ac01e788505677fecb80d5d0f66b6b2c2c5fcc3e91f4a520ac',
 '33/020-snapback-horseback-trail-rides':'e69de2ec1ec06bbcfc8e4505c9785edf6afc54146ed9d2f6fdd9b29b3e14eff4',
}
def warm_reactivation_projection(row,parsed):
 # Extra comparison of NON-security deployment administration only. The actual
 # security envelope stays scalar-exact. No witness/row/history is normalized.
 key=f"{row['wave']}/{row['lane']}"
 assert row['mode']=='staging'and row['temperature']=='warm'and row['exit']==0
 assert row['sourceSha256']==WARM_REACTIVATIONS[key]
 assert set(parsed)=={'adoption','backfills','details','generation','live','preview','release','rollbackView','security','sourceRelease'}
 assert parsed['security']is None and parsed['backfills']==[]and parsed['rollbackView']is None
 for field,value in [('generation',2),('release',2),('sourceRelease',1)]:assert type(parsed[field])is int and parsed[field]==value
 live=parsed['live'];assert type(live)is dict and live['exact']is True and live['rowShape']['matchesTarget']is True
 for field in ['release','source','target']:assert type(live[field])is int and live[field]==2
 preview=parsed['preview'];assert type(preview)is dict and preview['security']is None and preview['sourceRelease']==1 and preview['preview']is True
 assert preview['current']['items']==[]and preview['plan']['items']==[]
 assert len(preview['current']['events'])==1 and len(preview['plan']['events'])==2
 assert canonical(preview['current']['events'][0])==canonical(preview['plan']['events'][0])
 projected=copy.deepcopy(parsed)
 for container,field in [(projected,'adoption'),(projected,'details'),(projected['preview'],'phases')]:
  assert type(container[field])is str
  container[field],count=re.subn(r'\b[0-9]+(?:\.[0-9]+)? ms\b','<elapsed> ms',container[field]);assert count>0
 for group,index in [('current',0),('plan',0),('plan',1)]:
  event=projected['preview'][group]['events'][index]
  assert type(event['at'])is int and event['at']>0
  event['at']='<physical-deployment-event-time>'
 return projected

def validate_row(row):
 assert type(row['exit'])is int and row['exit']in [0,1]and'parseError'not in row
 parsed=json.loads(row['stdout']);assert type(parsed)is dict and canonical(envelope(parsed,row['mode'],row['exit']))==canonical(row['security'])
 if row['mode']in ['check','review']:
  assert type(parsed['ok'])is bool
  for key in ['notes','newNotes','acknowledgedNotes']:assert type(parsed[key])is list
  assert parsed['acknowledgmentNotApplied']is None or type(parsed['acknowledgmentNotApplied'])is str
  report_shape(parsed['security']);reviews_shape(parsed['securityReviews'])
 else:
  sec=parsed.get('security');sec=json.loads(sec)if type(sec)is str else sec
  if not sec:
   assert row['temperature']=='warm'and row['mode']=='staging'and row['exit']==0
   if parsed.get('unchanged')is True:
    assert type(parsed['generation'])is int and type(parsed['release'])is int and type(parsed['live'])is dict and type(parsed['live']['exact'])is bool
   else:warm_reactivation_projection(row,parsed)
   return
  assert type(sec)is dict
  string(sec['notice']);string(sec['verdict']);assert type(sec['fixes'])is int and sec['fixes']>=0 and type(sec['changedNotes'])is int and sec['changedNotes']>=0 and type(sec['pending'])is bool
  report_shape(sec['report']);reviews_shape(sec['securityReviews'])

def validate_item(item,wave,lane,source_hash,fixture_hash):
 assert item['wave']==wave and item['lane']==lane and len(item['rows'])==12
 pairs=collections.defaultdict(dict)
 for row in item['rows']:
  assert row['wave']==wave and row['lane']==lane and row['sourceSha256']==source_hash and row['fixtureSha256']==fixture_hash
  validate_row(row);pair=pairs[row['mode'],row['temperature']];assert row['label']not in pair;pair[row['label']]=row
 assert set(pairs)==set(MATRIX)
 for pair in pairs.values():assert set(pair)=={'baseline','candidate'}
 warm=pairs['staging','warm']
 if not warm['baseline']['security']['security']and not warm['candidate']['security']['security']:
  projected=[]
  for label in ['baseline','candidate']:
   row=warm[label];parsed=json.loads(row['stdout']);projected.append(parsed if parsed.get('unchanged')is True else warm_reactivation_projection(row,parsed))
  assert canonical(projected[0])==canonical(projected[1])
 return pairs

def mismatch_key(row):return row['wave'],row['lane'],row['mode'],row['temperature']
def select_replays(mismatches):
 chosen={};rank={'production':0,'review':1,'check':2,'staging':3}
 for r in sorted(mismatches,key=lambda r:(rank[r['mode']],r['temperature']!='cold',r['wave'],r['lane'])):chosen.setdefault((r['wave'],r['lane']),{k:r[k]for k in ['wave','lane','mode','temperature']})
 return [chosen[k]for k in sorted(chosen)]

def validate_census(root):
 summary=load(root/'summary.json');assert summary['schemas']==1020 and summary['toolFailures']==[]and summary['inputMismatches']==[]
 keyfile=BASE/'survey-keys.json';keys=load(keyfile);assert len(keys)==1020 and len(set(map(tuple,keys)))==1020
 prov=load(root/'provenance.json');assert prov['workers']==4 and prov['identity']is True and prov['latencyTrace']is False
 measure=REPO/'snapback4/reports/lat1/measure.py';assert sha(measure)==prov['toolSha256']and sha(keyfile)==prov['keysSha256']
 assert set(prov['binaries'])=={'baseline','candidate'}and prov['binaries']['baseline']['sha256']==CONTROL and prov['binaries']['candidate']['sha256']==CANDIDATE
 for binary in prov['binaries'].values():assert sha(pathlib.Path(binary['path']))==binary['sha256']
 expected_files={f'w{w}-{l}.json'for w,l in keys};assert {p.name for p in root.glob('w*.json')}==expected_files
 manifest={};mismatches=[];input_hashes={}
 for wave,lane in keys:
  path=root/f'w{wave}-{lane}.json';raw=path.read_bytes();manifest[path.name]=hashlib.sha256(raw).hexdigest();sh,fh=inputs(wave,lane);input_hashes[f'{wave}/{lane}']=[sh,fh]
  pairs=validate_item(json.loads(raw),wave,lane,sh,fh)
  for mode,temp in MATRIX:
   a,b=(pairs[mode,temp][label]['security']for label in ['baseline','candidate'])
   if canonical(a)!=canonical(b):mismatches.append(dict(wave=wave,lane=lane,mode=mode,temperature=temp,fields=sorted(k for k in a.keys()|b.keys()if canonical(a.get(k))!=canonical(b.get(k)))))
 actual=summary['mismatches'];assert len(actual)==len(mismatches)and len(set(map(mismatch_key,actual)))==len(actual)
 assert canonical(sorted([{**r,'fields':sorted(r['fields'])}for r in actual],key=mismatch_key))==canonical(sorted(mismatches,key=mismatch_key))
 binding=dict(summarySha256=sha(root/'summary.json'),provenanceSha256=sha(root/'provenance.json'),keysSha256=sha(keyfile),toolSha256=sha(measure),captureManifestSha256=digest(manifest),inputHashesSha256=digest(input_hashes))
 return dict(summary=summary,keys=keys,provenance=prov,manifest=manifest,inputHashes=input_hashes,mismatches=mismatches,chosen=select_replays(mismatches),binding=binding,bindingSha256=digest(binding))

def validate_replay_item(item,choice,census,run_id):
 wave,lane=choice['wave'],choice['lane'];assert item['wave']==wave and item['lane']==lane and item['runId']==run_id and item['binarySha256']==CONTROL
 assert len(item['rows'])==2 and {r['label']for r in item['rows']}=={'first','second'}
 by_label={r['label']:r for r in item['rows']};assert by_label['first']['workingCopy']!=by_label['second']['workingCopy']
 for ordinal,label in enumerate(['first','second'],1):
  row=by_label[label];assert type(row['ordinal'])is int and row['ordinal']==ordinal and row['runId']==run_id and row['binarySha256']==CONTROL and row['role']=='unchanged-control-self-reproduction'
  assert row['wave']==wave and row['lane']==lane and row['mode']==choice['mode']and row['temperature']==choice['temperature']
  assert [row['sourceSha256'],row['fixtureSha256']]==census['inputHashes'][f'{wave}/{lane}']
  assert row['command']==[census['provenance']['binaries']['baseline']['path'],*COMMANDS[choice['mode']],'--json'];validate_row(row)
 a,b=(by_label[label]['security']for label in ['first','second']);assert canonical(a)!=canonical(b),'unchanged control did not reproduce nonce drift';return a,b

def validate_replays(out,census):
 prov=load(out/'provenance.json');complete=load(out/'complete.json');assert prov['role']=='unchanged-control-self-reproduction'and prov['binarySha256']==CONTROL and prov['workers']==4
 assert prov['censusBindingSha256']==census['bindingSha256']and canonical(prov['censusProvenance'])==canonical(census['provenance'])
 assert prov['toolSha256']==sha(BASE/'reproduce-control-upload.py')and prov['validatorSha256']==sha(pathlib.Path(__file__))and prov['extractionToolSha256']==sha(REPO/'snapback4/reports/lat1/measure.py')
 assert type(prov['runId'])is str and re.fullmatch('[0-9a-f]{32}',prov['runId'])
 assert complete['complete']is True and complete['runId']==prov['runId']and complete['binarySha256']==CONTROL and complete['censusBindingSha256']==census['bindingSha256']
 assert complete['schemas']==len(census['chosen'])and canonical(complete['chosen'])==canonical(prov['chosen'])==canonical(census['chosen'])
 expected={f"w{r['wave']}-{r['lane']}.json"for r in census['chosen']};assert {p.name for p in out.glob('w*.json')}==expected==set(complete['capturesSha256'])
 pairs=[]
 for choice in census['chosen']:
  name=f"w{choice['wave']}-{choice['lane']}.json";item=load(out/name,complete['capturesSha256'][name]);a,b=validate_replay_item(item,choice,census,prov['runId']);pairs.append((choice,a,b,complete['capturesSha256'][name]))
 assert sha(pathlib.Path(census['provenance']['binaries']['baseline']['path']))==CONTROL
 return pairs
