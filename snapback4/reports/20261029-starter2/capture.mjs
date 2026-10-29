import {readFileSync,writeFileSync,readdirSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const phase=process.argv[2],n=Number(process.argv[3]);
if(!['before','after','after2'].includes(phase)||![5,23,36,39,19,32].includes(n))throw Error('unknown replay');
const base='/tmp/starter2-evidence',launch=JSON.parse(readFileSync(`${base}/${phase}-${n}-launch.json`)),result=JSON.parse(readFileSync(`${base}/${phase}-${n}-result.json`)),dir=launch.dir;
const archived=JSON.parse(readFileSync(`${dir}/.harness/sessions/manifest.json`));
if(result.status!==0||!result.report||!archived.matched||archived.missing.length)throw Error('capture refuses incomplete replay');
const packs=`${base}/${phase}-packs`,manifest=JSON.parse(readFileSync(`${packs}/manifest.json`));
const integrity=JSON.parse(execFileSync('python3',[new URL('./verify-installed.py',import.meta.url).pathname,dir,`${packs}/snapback4-0.4.49.tgz`],{encoding:'utf8'}));
const native=`${dir}/node_modules/snapback4-linux-x64/snapback4`,nativeSha256=createHash('sha256').update(readFileSync(native)).digest('hex');
if(nativeSha256!==manifest.nativeSha256)throw Error('native artifact differs from replay pack');
writeFileSync(`${base}/${phase}-${n}-integrity.json`,JSON.stringify({...integrity,nativeSha256,expectedNativeSha256:manifest.nativeSha256},null,2));
if(process.argv.includes('--clean')){
 const owned=[];
 for(const pid of readdirSync('/proc').filter(s=>/^\d+$/.test(s))){try{
  if(readFileSync(`/proc/${pid}/environ`).toString().split('\0').includes(`SB4_LANE=starter2-${phase}-${n}`)){
   const birth=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19];owned.push({pid:Number(pid),birth});process.kill(Number(pid),'SIGTERM');
  }
 }catch{}}
 await new Promise(r=>setTimeout(r,1000));
 for(const {pid,birth}of owned)try{if(readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[19]===birth)process.kill(pid,'SIGKILL');}catch{}
 mkdirSync(`${base}/applications`,{recursive:true});
 execFileSync('tar',['-czf',`${base}/applications/${phase}-${n}.tgz`,'--exclude=node_modules','--exclude=dist','--exclude=.expo','--exclude=.data','--exclude=.scratch','--exclude=.snapback4','--exclude=.harness','--exclude=.agent.ndjson','-C',dir,'.']);
 for(const leaf of ['node_modules','dist','.expo','.data','.scratch','.snapback4'])rmSync(`${dir}/${leaf}`,{recursive:true,force:true});
 rmSync(launch.tmp,{recursive:true,force:true});
}
console.log(phase,n,'client/native bytes match',integrity.files);
