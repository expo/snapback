import json,pathlib,os,re
out=pathlib.Path(os.environ['SEC3_OUT'])
def unpack(value):
 if isinstance(value,dict) and len(value)==1:return unpack(next(iter(value.values())))
 return value
apps={};vs={}
for n in (6,11,13,15,19,21,27,40,45,48):
 x=json.loads((out/f'{n:03}.json').read_text());apps[n]=x
 report=json.loads(x['check']['stdout'])['security'];inv={f"{i['invariant']['site']['file']}:{i['invariant']['site']['line']}:{i['invariant']['site']['col']}":i['invariant'] for i in report['invariants']}
 records=[]
 for line in x['test']['stdout'].splitlines():
  if line.startswith('security violation: '):
   v=json.loads(line[len('security violation: '):]);v['declaration']=inv.get(v['invariant_site'],{});records.append(v)
 vs[n]=records

def pick(n,table,target,operation=None,column=None,role=None,steps=()):
 for v in vs[n]:
  d=v['declaration']
  if v['reachability']!='authored-fixture-trace' or d.get('table')!=table or d.get('target')!=target or d.get('column')!=column:continue
  if operation and v['operation']!=operation:continue
  if steps and not all(any(h['operation']==s for h in v['history']) for s in steps):continue
  if role and not any(unpack(h['args'].get('role'))==role and unpack(h['args'].get('who'))==v['viewer'] for h in v['history']):continue
  return {k:v[k] for k in ('invariant_site','viewer','operation','effect','reachability','history')}
 return None
criteria=[('013 F1',13,'submissions','read','visibleSubmissions',None,'team',()),('019 F1',19,'inspections','read','inspectionsOf',None,'landowner',()),('021 F1',21,'briefs','read','opponentBrief',None,None,('createTournament',)),('021 F2',21,'directors','insert','createTournament',None,None,()),('027 F1',27,'roles','write','grantRole','role',None,()),('027 F2',27,'episodes','read','episodesOfShow',None,'guest',()),('045 F1',45,'repairNotes','read','notesFor',None,None,()),('048 F2',48,'readings','read','gaugeHistory',None,'manager',('logReading','assignRole'))]
results=[]
for case in criteria:
 key,n,*args=case;w=pick(n,*args);results.append(dict(finding=key,status='caught' if w else 'not caught',witness=w))
write=pick(19,'inspections','insert','recordInspection');results[1]['write_half']=write
if not write:results[1]['status']='partial'
summary={'scope':'Eight calibrated real high roots from day-two ground truth; extra stricter/miscalibrated declarations are not counted as confirmed highs. Finite execution, not a universal proof.','source':json.loads((out/'build-provenance.json').read_text())['commit'],'binary_sha256':json.loads((out/'build-provenance.json').read_text())['binary_sha256'],'caught':sum(r['status']=='caught' for r in results),'partial':sum(r['status']=='partial' for r in results),'not_caught':sum(r['status']=='not caught' for r in results),'results':results,'lanes':[{'lane':x['lane'],'check_exit':x['check']['exit'],'test_exit':x['test']['exit'],'history_sequences':re.findall(r'security histories: (\d+)',x['test']['stdout']),'check_seconds':x['check']['seconds'],'test_seconds':x['test']['seconds']} for x in apps.values()]}
(out/'calibrated-highs.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:summary[k] for k in ('caught','partial','not_caught','source','binary_sha256')}))
raise SystemExit(int(summary['caught']!=8 or summary['partial'] or summary['not_caught']))
