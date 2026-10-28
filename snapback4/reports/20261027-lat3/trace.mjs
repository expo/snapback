import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import Module from 'node:module';
import {appendFileSync} from 'node:fs';
const dest=process.env.LAT3_TRACE;
const record=x=>{if(dest)appendFileSync(dest,JSON.stringify({pid:process.pid,at:Date.now(),...x})+'\n',{mode:0o600})};
record({event:'node',argv:process.argv.slice(0,3)});
const spawn=cp.spawn;
cp.spawn=function(command,args=[],options){
 const at=Date.now(); const child=spawn.call(this,command,args,options);
 const id=child.pid;
 record({event:'spawn',child:id,command:String(command),args:args.map((a,i)=>args[i-1]==='--quiet'?'[redacted]':a)});
 child.once('close',(code,signal)=>record({event:'close',child:id,code,signal,ms:Date.now()-at}));
 return child;
};
syncBuiltinESMExports();
const load=Module._load, seen=new WeakSet();
Module._load=function(...args){
 const value=load.apply(this,args);
 if(typeof args[0]!=='string'||!args[0].includes('playwright-core'))return value;
 const chromium=value?.chromium;
 if(chromium&&typeof chromium.launch==='function'&&!seen.has(chromium)){
  seen.add(chromium);const launch=chromium.launch;
  chromium.launch=async function(...options){
   record({event:'browser.launch'});const browser=await launch.apply(this,options);record({event:'browser.launched'});
   const close=browser.close,newContext=browser.newContext;
   browser.close=async function(...options){record({event:'browser.close'});try{return await close.apply(this,options)}finally{record({event:'browser.closed'})}};
   browser.newContext=async function(...options){const context=await newContext.apply(this,options);record({event:'browser.context'});const close=context.close;
    context.on('page',page=>{
     page.on('response',response=>{const url=new URL(response.url());if(url.protocol==='http:'||url.protocol==='https:')record({event:'browser.response',origin:url.origin,path:url.pathname,status:response.status()})});
     page.on('requestfailed',request=>{const url=new URL(request.url());record({event:'browser.requestFailed',origin:url.origin,path:url.pathname,error:request.failure()?.errorText})});
     page.on('pageerror',error=>record({event:'browser.pageError',name:error.name}));
    });
    context.close=async function(...options){record({event:'context.close'});try{return await close.apply(this,options)}finally{record({event:'context.closed'})}};return context;};
   return browser;
  };
 }
 return value;
};
const original=globalThis.fetch;
globalThis.fetch=async function(input,init){
 const at=Date.now(),url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 try {const res=await original(input,init);record({event:'fetch',path:url.pathname,ms:Date.now()-at,status:res.status});return res;}
 catch(e){record({event:'fetch',path:url.pathname,ms:Date.now()-at,error:e.name});throw e;}
};
process.on('beforeExit',()=>record({event:'beforeExit'}));
process.on('exit',code=>record({event:'exit',code}));
