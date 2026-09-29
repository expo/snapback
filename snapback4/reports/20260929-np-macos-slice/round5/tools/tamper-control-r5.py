from pathlib import Path
import subprocess,json,os
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';tools=r/'lane/snapback4/reports/20260929-np-macos-slice/round5/tools';u=(e/'owned.udid').read_text().strip()
# Instrument only this launched driver's node boundary, before its actual byte
# verifier. Nothing fabricates a success, receipt, or tool output.
wrapper=e/'tamper-bin';wrapper.mkdir()
node=wrapper/'node';node.write_text('''#!/Users/ccheever/np-tools/node/bin/node
const fs=require('node:fs'), cp=require('node:child_process'), path=require('node:path');
const args=process.argv.slice(2);
if(args[0]?.endsWith('/verify.mjs') && args[1]?.endsWith('/base.app')) {
 const file=path.join(args[1],'main.jsbundle'); const b=fs.readFileSync(file); b[40]^=1; fs.writeFileSync(file,b);
 fs.writeFileSync(process.env.NP_TAMPER_RECORD,JSON.stringify({file,beforeVerifier:true,at:Date.now()}));
}
const p=cp.spawn('/Users/ccheever/np-tools/node/bin/node',args,{stdio:'inherit'});
p.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exit(code);});
''');node.chmod(0o755)
# The normal runner prepends its pinned node, so run a recorded direct command
# here with this single-purpose wrapper first, preserving every other host pin.
import time,hashlib
name='control-tampered-output';argv=[str(r/'lane/snapback4/target/debug/snapback4'),'witness','ios','--build',str(r/'subject'),'--smoke','--udid',u,'--port','49371','--artifacts',str(e/name)]
env=dict(os.environ,PATH=str(wrapper)+':'+str(r.parent/'np-tools/node/bin')+':'+str(r.parent/'np-tools/bun/bin')+':'+str(r.parent/'.cargo/bin')+':'+os.environ['PATH'],DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer',TMPDIR=str(r/'tmp'),NP_TAMPER_RECORD=str(e/'tamper-injection.json'))
record={'argv':argv,'cwd':str(r/'subject'),'env':{k:env[k] for k in ['PATH','DEVELOPER_DIR','TMPDIR','NP_TAMPER_RECORD']},'startedAt':int(time.time()*1000),'cliSha256':hashlib.sha256(Path(argv[0]).read_bytes()).hexdigest()}
with (e/(name+'.log')).open('x') as log:
 p=subprocess.Popen(argv,cwd=record['cwd'],env=env,stdout=log,stderr=subprocess.STDOUT);record['pid']=p.pid;(e/(name+'-command.json')).write_text(json.dumps(record,indent=2));record['exitStatus']=p.wait()
record['endedAt']=int(time.time()*1000);record['durationMs']=record['endedAt']-record['startedAt'];(e/(name+'-command.json')).write_text(json.dumps(record,indent=2))
text=(e/(name+'.log')).read_text();assert record['exitStatus']==1 and 'app inventory differs from preparation' in text,text
assert (e/'tamper-injection.json').exists() and not (e/name/'installed.json').exists() and not (e/name/'proof.json').exists()
print('Tampered built output refused before install',flush=True)
