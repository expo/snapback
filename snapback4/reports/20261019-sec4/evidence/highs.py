"""Measure confirmed wave18 lanes on disposable source-only copies."""
import pathlib,tempfile,subprocess,time,hashlib,json,gzip,sys,os,signal
root=pathlib.Path(__file__).resolve().parent
binary=pathlib.Path(sys.argv[1]).resolve()
extra={
'032':"invariant challenges.read only .challenger = viewer or .challenged = viewer or exists roles[principal = viewer, role = 'captain'] or (.playAt != null and exists roles[principal = viewer, role = 'staff'])\n",
'033':"invariant bouts.scoreA update only not exists appeals[bout = .id, decision = 'upheld'] or exists roles[viewer, role = 'chair']\ninvariant bouts.scoreB update only not exists appeals[bout = .id, decision = 'upheld'] or exists roles[viewer, role = 'chair']\n",
'041':"invariant users.role write only viewer = 'service:operator' or exists users[viewer, role = 'manager']\ninvariant users.building update only viewer = 'service:operator' or exists users[viewer, role = 'manager']\n",
'044':"invariant packages.scan read only .claimedBy = viewer or exists members[viewer, role = 'coordinator']\n",
'047':"invariant staff.role write only viewer = 'service:operator' or exists staff[viewer, role = 'physician']\n",
}
prefix=(sys.argv[sys.argv.index("--label")+1]+"-") if "--label" in sys.argv else ("quick-" if "--check-only" in sys.argv else "")
results=[]
for number in ['004','013','015','019','021','026','032','033','041','044','047']:
 lane=next(pathlib.Path.home().joinpath('sb4-loop/wave18/apps').glob(number+'-snapback-*'))
 spec=extra.get(number)
 if spec is None:spec=next(pathlib.Path.home().joinpath('sb4-loop/wave18-repro/secA').glob(number+'-*/snapback/security.q')).read_text()
 source=lane.joinpath('snapback/schema.q').read_text()
 if number=='013':spec=spec.replace("only exists roles[viewer, role = 'supervisor']","only viewer = 'service:operator' or exists roles[viewer, role = 'supervisor']")
 row={'lane':lane.name,'originalSha256':hashlib.sha256(source.encode()).hexdigest(),'briefSha256':hashlib.sha256((lane/'BRIEF.md').read_bytes()).hexdigest(),'intent':spec}
 with tempfile.TemporaryDirectory(prefix='sec4-high-') as directory:
  scratch=pathlib.Path(directory);(scratch/'snapback').mkdir();(scratch/'tmp').mkdir()
  for path in lane.joinpath('snapback').glob('*.q'):
   text='\n'.join(line for line in path.read_text().splitlines() if not line.lstrip().startswith('invariant '))+'\n'
   (scratch/'snapback'/path.name).write_text(text)
  (scratch/'snapback/security.q').write_text(spec);(scratch/'package.json').write_text('{"private":true}')
  for verb in (['check'] if '--check-only' in sys.argv else ['check','audit']):
   start=time.monotonic();process=subprocess.Popen([str(binary),verb,'--json'],cwd=scratch,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,TMPDIR=str(scratch/'tmp')),start_new_session=True)
   try:stdout,stderr=process.communicate(timeout=600);code=process.returncode
   except subprocess.TimeoutExpired:
    os.killpg(process.pid,signal.SIGTERM)
    try:stdout,stderr=process.communicate(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);stdout,stderr=process.communicate()
    code='timeout'
   with gzip.open(root/f'{prefix}{number}-{verb}.json.gz','wt') as output:output.write(stdout)
   with gzip.open(root/f'{prefix}{number}-{verb}.stderr.gz','wt') as output:output.write(stderr)
   detail={'exit':code,'seconds':round(time.monotonic()-start,3)}
   try:
    report=json.loads(stdout);report=report.get('security',report)
    detail['notes']=[{'code':n['code'],'message':n['message']} for n in report.get('notes',[])]
    detail['invariants']=[{'target':i['invariant']['table']+'.'+str(i['invariant'].get('column') or '')+' '+i['invariant']['target'],'status':i['status'],'origin':(i.get('counterexample') or {}).get('reachability'),'operation':(i.get('counterexample') or {}).get('operation'),'viewer':(i.get('counterexample') or {}).get('viewer'),'history':(i.get('counterexample') or {}).get('history',[]),'reasons':i['reasons']} for i in report.get('invariants',[])]
    detail['coverage']=list(report.get('campaign_coverage',[]))
   except (json.JSONDecodeError,KeyError,TypeError):detail['parse']='no complete JSON report'
   row[verb]=detail;print(number,verb,code,detail['seconds'],[(i['target'],i['status'],i['origin']) for i in detail.get('invariants',[])],flush=True)
 results.append(row);(root/(prefix+'highs.json')).write_text(json.dumps(results,indent=2)+'\n')
