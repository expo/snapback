import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const directory=process.argv[2],label=process.argv[3]??'initial',names=['snapback4','snapback4-linux-x64','snapback4-expo'],packages=new Map();
for(const name of names){const filename=`${name}-0.4.46.tgz`,bytes=readFileSync(`${directory}/${filename}`),manifest=JSON.parse(execFileSync('tar',['-xOf',`${directory}/${filename}`,'package/package.json'],{encoding:'utf8'}));packages.set(name,{filename,bytes,manifest});}
const server=http.createServer(async(req,res)=>{
 try {
  const path=decodeURIComponent(req.url.split('?')[0]).slice(1),name=path.split('/-/')[0],pack=packages.get(name);
  if(pack&&path.includes('/-/')){res.writeHead(200,{'content-type':'application/octet-stream'});res.end(pack.bytes);return;}
  if(pack){const manifest={...pack.manifest,dist:{tarball:`http://127.0.0.1:${server.address().port}/${name}/-/${pack.filename}`,integrity:'sha512-'+createHash('sha512').update(pack.bytes).digest('base64'),shasum:createHash('sha1').update(pack.bytes).digest('hex')}};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({name,'dist-tags':{latest:'0.4.46'},versions:{'0.4.46':manifest}}));return;}
  const chunks=[];for await (const chunk of req) chunks.push(chunk);
  const body=Buffer.concat(chunks);
  const upstream=await fetch('http://127.0.0.1:4873'+req.url,{method:req.method,headers:{'accept':req.headers.accept??'*/*',...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(body.length?{body}: {})});
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/octet-stream'});res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(error.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));writeFileSync(`/tmp/ver1-evidence/registry-url-${label}.txt`,`http://127.0.0.1:${server.address().port}/`);console.log(`pid=${process.pid} port=${server.address().port}`);
process.on('SIGTERM',()=>server.close(()=>process.exit()));
