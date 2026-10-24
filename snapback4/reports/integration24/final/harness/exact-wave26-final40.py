import hashlib,json,os,pathlib,re,signal,socket,subprocess,time,urllib.error,urllib.request
out=pathlib.Path('/home/ccheever/sb4-loop/integ24/exact-wave26-final40');out.mkdir(exist_ok=True)
pre=pathlib.Path('/home/ccheever/sb4-loop/prewave24')
exact=pre/'exact2-integ24-wave26'
root=pathlib.Path('/home/ccheever/projects/snapback-sb4loop')
binary=pathlib.Path('/home/ccheever/projects/snapback-sb4loop/snapback4/target/integ24-wave26-final40-bin/snapback4')
client=pathlib.Path('/home/ccheever/sb4-loop/integ24/pack-wave26-final40/snapback4-0.4.40.tgz')
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CHROME='/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',SNAPBACK4_BIN=str(binary),CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='8')
assert binary.is_file()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source=subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=root,text=True).strip()
assert subprocess.check_output(['timeout','10s',str(binary),'--version'],text=True).strip()=='snapback4 0.4.40'
result={'source':source,'exactOriginMainAtClone':subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=exact,text=True).strip(),'binarySha256':sha(binary),'clientSha256':sha(client),'apps':{}}
def command(args,cwd,key,budget=1800):
 path=out/f'exact-{key}.log'
 with path.open('w') as log:
  p=subprocess.run(['timeout',str(budget)+'s',*map(str,args)],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+15)
 entry={'argv':list(map(str,args)),'cwd':str(cwd),'exit':p.returncode,'log':str(path)}
 (out/f'exact-{key}.status').write_text(str(p.returncode)+'\n')
 assert p.returncode==0,entry
 return entry
manifest=exact/'package.json';pkg=json.loads(manifest.read_text());pkg['devDependencies']['snapback4']=str(client);manifest.write_text(json.dumps(pkg,indent=2)+'\n')
result['clientInstall']=command(['bun','install'],exact,'root-client-install',600)
servers=[]
try:
 for kind,port in [('synced',28924),('online',28925)]:
  parent=pre/(kind+'-integ24-wave26-final40')
  assert not parent.exists(),'preserve an existing app: '+str(parent)
  parent.mkdir()
  (parent/'package.json').write_text(json.dumps({'name':'integration24-'+kind,'private':True,'type':'module','dependencies':{'snapback4':str(client)}},indent=2)+'\n')
  row={'directory':str(parent/'app'),'port':port,'commands':[]}
  row['commands'].append(command(['bun','install'],parent,kind+'-install',600))
  with socket.socket() as probe:probe.bind(('127.0.0.1',port))
  args=['bun',exact/'scripts/exact.mjs','new','app','--snapback','--port',str(port)]
  if kind=='online':
   (parent/'snapback').mkdir()
   schema=(pre/'synced-integ24-wave26-final40/snapback/schema.q').read_text()
   assert 'sync public last 100 by byTime' in schema
   (parent/'snapback/schema.q').write_text(schema.replace('sync public last 100 by byTime','online only'))
   row['authoredBackend']='Fresh synced starter schema, replacing sync with online only before Exact new --online; no Exact product code changed.'
   args.append('--online')
  row['commands'].append(command(args,parent,kind+'-new'))
  log=(out/f'exact-{kind}-server.log').open('w')
  server=subprocess.Popen(['timeout','7200s',str(binary),'dev','--port',str(port),'--no-watch'],cwd=parent,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  servers.append((server,log,parent));(out/f'exact-{kind}-server.pid').write_text(str(server.pid)+'\n')
  for _ in range(200):
   assert server.poll() is None,'backend exited'
   try:urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health',timeout=2);break
   except urllib.error.HTTPError:break
   except OSError:time.sleep(.1)
  else:raise AssertionError('backend never bound')
  if kind=='online':
   appdir=parent/'app'
   (appdir/'app.contract').write_text('shape Board\n  latest: string\nshape Post\n  id: string\n  status: enum<"sent", "failed">\ncomponent App\n  state draft = ""\n  resource board = notes() as shape Board else empty()\n  mutation posted as shape Post refreshes board\n  action edit(value: string)\n    draft = value\n  action post()\n    send posted = post(draft)\n  view\n    column\n      input value=draft input=edit testId="draft"\n      button "Post" press=post() testId="post"\n      text board.latest testId="latest"\n      text (match posted { case some(p) => p.status, case none => "" }) testId="fate"\n')
   appid=json.loads((appdir/'app.json').read_text())['app']['id']
   (appdir/'app.ts').write_text("import type { Answer, Result, Sources } from './app.contract.d.ts';\nimport { Snapback, refused } from './snapback4/snapback.ts';\nimport { api } from './backend/api.ts';\n"+f"export const appId = '{appid}';\nconst origin = 'http://127.0.0.1:{port}';\n"+"export const grants = `net.fetch ${origin}`;\nconst db = new Snapback({origin, headers: () => ({'x-snapback-persona':'alice'})});\nconst sources: Sources = {\nnotes: async (): Promise<Result<'notes'>> => { const read=await db.read(api.recent,{}); if(read.denied)throw refused(read.denied); return {latest:read.data?.[0]?.body??''}; },\npost: async ([body]): Promise<Result<'post'>> => { const sent=await db.send(api.post,{body}); if(sent.state==='failed')throw refused(sent.why); return {...sent.result,status:'sent'}; },\n};\nexport const answer: Answer = (source,args,store,storage,native) => sources[source](args,store,storage,native);\n")
   (appdir/'app.test.contract').write_text('epoch now\n\ntest "online write uses the merged backend"\n  clock data\n  type "draft" "hello from merged 0.4.40"\n  tap "post"\n  clock data\n  expect text "latest" == "hello from merged 0.4.40"\n  expect text "fate" == "sent"\n')
  row['commands'].append(command(['bun','exact.mjs','snapback'],parent/'app',kind+'-snapback'))
  wired=json.loads((parent/'app/app.json').read_text())
  mount=wired['typescript']['sources']['snapback4'].replace('\\','/').rstrip('/')
  assert mount.endswith('/online') if kind=='online' else mount.endswith('/ts'),mount
  row['commands'].append(command(['bun','exact.mjs','test','web'],parent/'app',kind+'-web',2400))
  text=(out/f'exact-{kind}-web.log').read_text()
  counts=re.findall(r'(\d+) passed, (\d+) failed',text)
  assert counts and int(counts[-1][0])>0 and int(counts[-1][1])==0,text[-2000:]
  row['tests']={'passed':int(counts[-1][0]),'failed':0}
  row['schemaSha256']=sha(parent/'snapback/schema.q')
  row['appManifest']=json.loads((parent/'app/app.json').read_text())
  result['apps'][kind]=row
  (out/'exact-results.json').write_text(json.dumps(result,indent=2)+'\n')
 assert result['binarySha256']==sha(binary)
 result['completionSource']=subprocess.check_output(['timeout','10s','git','rev-parse','HEAD'],cwd=root,text=True).strip()
 result['status']='passed';(out/'exact-results.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({kind:row['tests'] for kind,row in result['apps'].items()}),flush=True)
finally:
 for server,log,parent in servers:
  if server.poll() is None:os.killpg(server.pid,signal.SIGTERM)
  try:server.wait(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(server.pid,signal.SIGKILL);server.wait()
  log.close()
 (out/'exact-cleanup.json').write_text(json.dumps([{'pid':s.pid,'cwd':str(p),'exit':s.returncode} for s,log,p in servers],indent=2)+'\n')
