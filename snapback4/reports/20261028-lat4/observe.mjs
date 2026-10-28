// Private timestamp/resource-only observer: never records application output.
import {appendFileSync} from 'node:fs';
import {getActiveResourcesInfo} from 'node:process';
const path=process.env.LAT4_OBSERVER;
const record=x=>{if(path)appendFileSync(path,JSON.stringify({pid:process.pid,at:Date.now(),entry:process.argv[1]?.split('/').at(-1),...x})+'\n',{mode:0o600});};
process.__lat4Done=()=>record({event:'suite-done',resources:getActiveResourcesInfo().sort()});
record({event:'start'});
for(const stream of [process.stdout,process.stderr]) {
 const write=stream.write;
 stream.write=function(...args){record({event:'output'});return write.apply(this,args);};
}
process.on('exit',code=>record({event:'exit',code}));
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const spawn=cp.spawn;
cp.spawn=function(command,args=[],options){
 const began=Date.now(),child=spawn.call(this,command,args,options);
 const verb=String(command).split('/').at(-1)==='snapback4' || String(command).includes('lat4/') && !String(command).endsWith('node') ? args[0] : args.find(a=>['deploy','rollback','releases','sql','data','token','check','test','stop','serve'].includes(a));
 if(verb)record({event:'command',child:child.pid,verb});
 child.once('close',(code,signal)=>{if(verb)record({event:'command-close',child:child.pid,verb,code,signal,ms:Date.now()-began});});
 return child;
};syncBuiltinESMExports();
