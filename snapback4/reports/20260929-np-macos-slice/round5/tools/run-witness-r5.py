import json, subprocess, time, os, pathlib, sys, hashlib
root=pathlib.Path('/Users/ccheever/sb4-np'); name='round5/'+sys.argv[1]; argv=[str(root/'lane/snapback4/target/debug/snapback4'),'witness','ios',*sys.argv[2:],'--artifacts',str(root/'evidence'/name)]
env=os.environ.copy(); env.update(PATH=str(pathlib.Path.home()/'np-tools/node/bin')+':'+str(pathlib.Path.home()/'np-tools/bun/bin')+':'+str(pathlib.Path.home()/'.cargo/bin')+':'+env['PATH'],DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer',TMPDIR=str(root/'tmp'))
record={'argv':argv,'cwd':str(root/'subject'),'env':{k:env[k] for k in ['PATH','DEVELOPER_DIR','TMPDIR','SIMCTL_CHILD_NP_SELECT_ALTERNATE','NP_CONTROL_FACTS','NP_CONTROL_RECORD'] if k in env},'loadAverageStart':os.getloadavg(),'startedAt':int(time.time()*1000),'cliSha256':hashlib.sha256(pathlib.Path(argv[0]).read_bytes()).hexdigest()}
with (root/'evidence'/f'{name}.log').open('x') as log:
 p=subprocess.Popen(argv,cwd=record['cwd'],env=env,stdout=log,stderr=subprocess.STDOUT); record['pid']=p.pid
 (root/'evidence'/f'{name}-command.json').write_text(json.dumps(record,indent=2)); record['exitStatus']=p.wait()
record.update(endedAt=int(time.time()*1000),loadAverageEnd=os.getloadavg()); record['durationMs']=record['endedAt']-record['startedAt']
(root/'evidence'/f'{name}-command.json').write_text(json.dumps(record,indent=2)); print(json.dumps(record)); sys.exit(record['exitStatus'])
