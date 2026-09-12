import fs from 'node:fs';
import {createClient} from 'snapback3/client';
const segment=process.argv[process.argv.indexOf('--segment')+1];
const diagnostic=process.argv.includes('--diagnostic-text-only');
if(segment!=='m1'){console.error(`${segment}: blocked-by-M1; no segment installed`);process.exit(1)}
const client=createClient({url:process.env.CLIQUE_URL??'http://127.0.0.1:54900',storage:false,live:false});
const receipts=[];let actorSession;
try{
 await client.ready;
 for(const line of fs.readFileSync('instrument/fixtures/starter-m1.log','utf8').trim().split('\n')){
  const tokens=line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(t=>t.startsWith('"')?JSON.parse(t):t);
  const [time,actor,verb,...args]=tokens;
  if(verb==='register'){
   try{actorSession=await client.auth.signup(...args)}catch(error){actorSession=await client.auth.login(...args)}
   receipts.push({actor,verb,settled:true,principal:actorSession.principal.id});
  }else if(verb==='profile-set'){
   if(!diagnostic)throw Error('S3_CAPABILITY_UNAVAILABLE: profile-set requires avatar media. Replay stopped at first unsupported action; segment not installed.');
   const [displayName,handle,bio,location,link]=args;
   const current=await client.query('profiles.mine',{});
   const fields={displayName,handle,bio,location,link};
   if(!current||Object.entries(fields).some(([k,v])=>current[k]!==v)){
    const result=await client.mutate('profiles.save',fields).settled;
    if(result.state!=='committed')throw Error(JSON.stringify(result));
   }
   receipts.push({actor,verb,settled:false,diagnosticTextOnly:true,omitted:'avatar'});
  }else throw Error(`Unsupported verb ${verb}`);
 }
 console.log(diagnostic?'Diagnostic textual personas loaded. This is NOT an installed starter segment.':'Seed installed');
}catch(error){console.error(String(error));receipts.push({error:String(error)});process.exitCode=1}
finally{client.close();fs.writeFileSync(`evidence/seed-m1${diagnostic?'-partial':''}.json`,JSON.stringify({segment,installed:false,diagnostic,receipts},null,2)+'\n')}
