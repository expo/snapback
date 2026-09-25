import pathlib,json,hashlib,datetime
root=pathlib.Path.cwd(); artifacts=root/'reports/20260924-expo-0.4.1'; qpath=artifacts/'qualified.json'; q=json.loads(qpath.read_text()); digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
q['witnesses']={}
for segment in ['offline','restart']:
 p=artifacts/(segment+'-ios-run.json'); m=json.loads(p.read_text()); assert m['exitStatus']==0 and m['error'] is None; assert m['cliVersion']=='0.4.1'; assert m['prime'] and m['relaunch']==(segment=='restart'); assert m['udid']==q['simulator']
 for a in m['artifacts'].values():
  f=pathlib.Path(a['path']); assert f.stat().st_size==a['bytes']; assert digest(f)==a['sha256']
 q['witnesses'][segment]={'manifest':p.name,'exitStatus':0,'seconds':round((m['endedAt']-m['startedAt'])/1000,3),'prime':m['prime'],'relaunch':m['relaunch'],'artifactHashesVerified':True,'installedExecutableSha256':q['app']['sha256']}
pkg=root/'packages/snapback4-expo'; files=[pkg/'package.json',pkg/'README.md',pkg/'expo-module.config.json']+[p for tree in ['ios','src'] for p in (pkg/tree).rglob('*') if p.is_file()]
q['files']={str(p.relative_to(pkg)):digest(p) for p in sorted(files)}
for path,sha in q['xcframework'].items(): assert q['files'][path]==sha
q['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();q['qualification']='Rebuilt native framework and Release chat-expo app; offline --prime and restart --prime --relaunch passed using this worktree’s built public CLI witness verb. CLI source-suite and installed-consumer qualification pending.'
qpath.write_text(json.dumps(q,indent=2)+'\n'); print(json.dumps(q['witnesses'],indent=2));print('All native artifact hashes and framework source hashes verified; Expo source bytes recorded.')
