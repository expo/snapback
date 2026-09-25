// Run against a COPY of calibration #20's scale-instance, never the packet.
// node probe.mjs URL OUTPUT [count=1000] [sdk|http] [shape|all]
// CAL20_LANE points to the read-only lane for its installed 0.4.1 client and fixture.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const [url,out,countArg='1000',mode='sdk',only='all']=process.argv.slice(2);
const count=Number(countArg);
assert(url&&out&&Number.isSafeInteger(count)&&count>0&&['sdk','http'].includes(mode),
 'usage: node probe.mjs URL OUTPUT[.gz] [positive count=1000] [sdk|http] [shape|all]');
const lane=process.env.CAL20_LANE ?? `${process.env.HOME}/clique-sb4-20260924-astra-cal20/lanes/astra-snapback4`;
const {login}=await import(pathToFileURL(path.join(lane,'node_modules/snapback4/dist/auth.js')));
const {createClient}=await import(pathToFileURL(path.join(lane,'node_modules/snapback4/dist/client.js')));
function stableId(s){let n=BigInt('0x'+createHash('sha256').update(s).digest('hex').slice(0,32)),out='';const a='0123456789ABCDEFGHJKMNPQRSTVWXYZ';for(let i=0;i<26;i++){out=a[Number(n&31n)]+out;n>>=5n;}return out;}
const credentials=new Map();
for(const line of fs.readFileSync(path.join(lane,'instrument/fixtures/scale.log'),'utf8').split('\n')) {
 if(!line.includes(' register '))continue;
 const [,actor,verb,...args]=line.match(/"(?:\\.|[^"\\])*"|\S+/g).map(s=>s.startsWith('"')?JSON.parse(s):s);
 if(verb==='register')credentials.set(actor,args);
}
const clients=new Map(),sessions=new Map();
const traceFetch=process.env.TRACE_FETCH==='1';
let attempts=[];
async function measuredFetch(input,options){
 const before=performance.now(),event={path:new URL(input).pathname};
 if(event.path.startsWith('/q/'))attempts.push(event);
 try {
  const response=await fetch(input,options);event.headersMs=performance.now()-before;event.status=response.status;
  const parse=response.json.bind(response);
  response.json=async()=>{const body=await parse();event.bodyMs=performance.now()-before;event.seq=body.seq;event.denied=body.denied?.code;return body;};
  return response;
 }catch(error){event.error=error.cause?.code??error.name;throw error;}
}
for(const actor of ['u0005','u0500','u0001']){
 const session=await login(url,...credentials.get(actor));assert(session.ok,JSON.stringify(session));
 sessions.set(actor,session.session);
 if(mode==='sdk')clients.set(actor,createClient({url,session:session.session,...(traceFetch?{fetch:measuredFetch}:{})}));
}
const probes=[['following-5','u0005','home',{}],['following-500','u0500','home',{}],['global','u0500','global',{}],['busy-latest','u0001','history',{conversationId:stableId('g0001')}],['chat-list-100','u0500','inbox',{}],['busy-search','u0001','searchChat',{conversationId:stableId('g0001'),q:'coffee'}],['all-chat-search','u0500','searchMessages',{q:'coffee'}]].filter(x=>only==='all'||x[0]===only);
assert(probes.length,'unknown query shape');
const bounds=[1,2,5,10,20,25,27,29,31,35,50,100,Infinity];
function summarize(samples){const v=samples.map(x=>x.ms).sort((a,b)=>a-b);const q=p=>v[Math.ceil(v.length*p)-1];const slow=samples.filter(x=>x.ms>=20);const gaps=slow.slice(1).map((x,i)=>({reads:x.i-slow[i].i,ms:x.startMs-slow[i].startMs}));let lower=0;return {n:v.length,p50:q(.5),p95:q(.95),p99:q(.99),max:v.at(-1),histogram:bounds.map(upper=>{const bin={range:`[${lower},${upper})`,n:v.filter(x=>x>=lower&&x<upper).length};lower=upper;return bin;}),slowCount:slow.length,slowGaps:gaps};}
const result={date:new Date().toISOString(),url,node:process.version,mode,traceFetch,count,warmups:3,thresholdMs:20,shapes:[]};
const start=performance.now();
try{
 for(const [name,actor,op,args]of probes){
  const samples=[];
  for(let i=-3;i<count;i++){
   attempts=[];const before=performance.now();let response;
   if(mode==='sdk')response=await clients.get(actor).query({name:op,kind:'query'},args);
   else {const r=await fetch(`${url}/q/${op}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${sessions.get(actor).token}`},body:JSON.stringify({args}),signal:AbortSignal.timeout(30000)});assert(r.ok,`${r.status}`);response=await r.json();}
   const ms=performance.now()-before;
   assert('data'in response&&response.data!==null,`${name}: ${JSON.stringify(response)}`);
   if(i>=0)samples.push({i,startMs:before-start,ms,rows:Array.isArray(response.data)?response.data.length:null,complete:response.complete,...(traceFetch?{attempts}:{})});
  }
  const summary=summarize(samples);result.shapes.push({name,actor,op,args,summary,samples});
  const encoded=JSON.stringify(result,null,2)+'\n';
  fs.writeFileSync(out,out.endsWith('.gz')?gzipSync(encoded):encoded);
  console.log(JSON.stringify({name,...summary,slowGaps:summary.slowGaps.slice(0,12)}));
 }
}finally {for(const client of clients.values())await client.close();}
