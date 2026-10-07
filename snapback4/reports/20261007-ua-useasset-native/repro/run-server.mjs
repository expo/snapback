import http from 'node:http';
import fs from 'node:fs';
import {createClient} from './expo/node_modules/snapback4/dist/client.js';
import {signup} from './expo/node_modules/snapback4/dist/auth.js';
const backend=fs.readFileSync(new URL('./backend.log',import.meta.url),'utf8').match(/http:\/\/127\.0\.0\.1:\d+/)[0];
const log=entry=>fs.appendFileSync(new URL('./trace.jsonl',import.meta.url),JSON.stringify({at:Date.now(),...entry})+'\n');
const chunkMs=Number(process.env.UA_CHUNK_MS??0);
const server=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
 if(req.method==='OPTIONS'){res.end();return;}
 if(req.url==='/ua-log'){let data='';req.on('data',b=>data+=b);req.on('end',()=>{try{log({kind:'app',...JSON.parse(data)})}catch{}res.end('ok')});return;}
 log({kind:'http',method:req.method,path:req.url,headers:Object.keys(req.headers),bearer:!!req.headers.authorization,range:req.headers.range});
 const upstream=http.request(backend+req.url,{method:req.method,headers:req.headers},response=>{log({kind:'response',path:req.url,status:response.statusCode});res.writeHead(response.statusCode,{...response.headers,'access-control-allow-origin':'*'});
 if(chunkMs>0&&req.url.startsWith('/assets/')&&[200,206].includes(response.statusCode)){const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{const body=Buffer.concat(parts);let part=0,offset=0;res.flushHeaders();const timer=setInterval(()=>{const end=Math.floor(body.length*++part/12);res.write(body.subarray(offset,end));offset=end;log({kind:'chunk',path:req.url,part,bytes:end});if(part===12){clearInterval(timer);res.end();}},chunkMs);res.on('close',()=>clearInterval(timer));});}else response.pipe(res)});
 upstream.on('error',e=>{log({kind:'proxy-error',message:e.message});res.writeHead(502);res.end()});req.pipe(upstream);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
const login=await signup(url,'ua@example.test','ua-password-123');if(!login.ok)throw Error(JSON.stringify(login));
const client=createClient({url,session:login.session});
const uploaded=await client.upload(fs.readFileSync(new URL('../../packages/snapback4/test/fixtures/cal26-avatar.png',import.meta.url)));
if(!uploaded.ok)throw Error(JSON.stringify(uploaded));
const written=await client.mutate({kind:'mutation',name:'send'},{photo:{id:uploaded.asset.id}});if(written.state!=='sent')throw Error(JSON.stringify(written));
const config={url,asset:uploaded.asset,message:written.result,mode:process.env.UA_MODE??'ordinary'};fs.writeFileSync(new URL('./config.json',import.meta.url),JSON.stringify(config,null,2));
await client.close();console.log(JSON.stringify(config));
