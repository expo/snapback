import {mkdirSync,mkdtempSync,copyFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fetchPinned,prootCommand,prootEnvironment,proofCache} from '/home/ccheever/projects/sb4-b32-dx15/snapback4/scripts/qualify-linux-proot.mjs';
import {prootInput,prootDistributions} from '/home/ccheever/projects/sb4-b32-dx15/snapback4/scripts/linux-proof-inputs.mjs';
import {run} from '/home/ccheever/projects/sb4-b32-dx15/snapback4/scripts/publication-artifacts.mjs';
const work=mkdtempSync('/home/ccheever/projects/sb4-b32-dx15/snapback4/target/srv1-no-proc-');
try{
 const root=join(work,'root'),scratch=join(work,'scratch'),inputs=join(work,'inputs'),temporary=join(work,'tmp');for(const p of [root,scratch,inputs,temporary])mkdirSync(p);
 run('tar',['--extract','--file',fetchPinned(prootDistributions[0].rootfs),'--directory',root,'--no-same-owner']);for(const p of ['consumer','proof','dev','tmp'])mkdirSync(join(root,p),{recursive:true});
 copyFileSync('/tmp/srv1-darwin-check/target/x86_64-unknown-linux-musl/debug/srv1-darwin-check',join(inputs,'probe'));
 const invoke=script=>run(fetchPinned(prootInput),[...prootCommand(root,scratch,inputs),'/bin/sh','-ec',script],{cwd:work,env:prootEnvironment(temporary),timeout:20000});
 const healthy=invoke('test ! -e /proc/self; SNAPBACK4_SUPERVISOR_PID=$$ /proof/probe serve; echo healthy-completed');if(!healthy.includes('survived with live parent'))throw Error(healthy);
 const death=invoke('/proof/probe --launch | tail -n 2');if(death.includes('survived with live parent')||!death.includes('launcher exits'))throw Error(death);
 console.log(JSON.stringify({noProc:true,healthyParent:'passed',parentDeathEOF:'passed',healthy,death}));
}finally{rmSync(work,{recursive:true,force:true});}
