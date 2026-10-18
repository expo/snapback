import {spawn,execFileSync} from 'node:child_process';
import {mkdirSync,openSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
export async function startProduction(){
 const bin=process.env.SNAPBACK4_BIN||resolve('node_modules/snapback4-linux-x64/snapback4');
 const release=join(tmpdir(),`sec2-release-${process.pid}`);mkdirSync(release,{recursive:true});
 execFileSync(bin,['deploy',release],{cwd:process.cwd(),stdio:['ignore','ignore','pipe'],timeout:60000});
 process.env.SNAPBACK4_SEC2_RELEASE=release;
 const port=Number(process.env.PORT_LO);const url=`http://127.0.0.1:${port}`;
 const fd=openSync(join(release,'serve.log'),'a');
 const child=spawn(bin,['serve',release,'--port',String(port),'--bind','127.0.0.1'],{stdio:['ignore',fd,fd],env:{...process.env,SNAPBACK4_SUPERVISOR_PID:String(process.pid)}});
 const until=Date.now()+30000;
 while(true){
  if(child.exitCode!==null)throw Error('production serve exited');
  try{const r=await fetch(url+'/auth/config',{signal:AbortSignal.timeout(1000)});const j=await r.json();if(r.ok&&j.development===false)break;}catch{}
  if(Date.now()>until){child.kill('SIGKILL');throw Error('production serve readiness timeout');}
  await new Promise(r=>setTimeout(r,30));
 }
 let stopped=false;
 return {url,release,token(service){return execFileSync(bin,['token','--service',service,'--release',release,'--quiet'],{encoding:'utf8',timeout:15000}).trim();},async stop(){if(stopped)return;stopped=true;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);await done;clearTimeout(timer);rmSync(release,{recursive:true,force:true});}};
}
