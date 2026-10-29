import http from 'node:http';
import{readFileSync,writeFileSync,readdirSync}from'node:fs';
import{execFileSync}from'node:child_process';
import{createHash}from'node:crypto';
const directory=process.argv[2],packages=new Map();
for(const filename of readdirSync(directory).filter(x=>x.endsWith('.tgz'))){
 const bytes=readFileSync(directory+'/'+filename),manifest=JSON.parse(execFileSync('tar',['-xOf',directory+'/'+filename,'package/package.json']));
 packages.set(manifest.name,{filename,bytes,manifest});
}
const server=http.createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(req.url.split('?')[0]).slice(1),name=path.split('/')[0],pack=packages.get(name);
  if(pack&&path.endsWith('/-/'+pack.filename)){res.writeHead(200,{'content-type':'application/octet-stream'});res.end(pack.bytes);return;}
  const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
  const upstream=await fetch('http://127.0.0.1:4873'+req.url,{method:req.method,headers:{accept:req.headers.accept??'*/*',...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(body.length?{body}:{})});
  const bytes=Buffer.from(await upstream.arrayBuffer());
  if(pack&&!path.includes('/-/')){
   let metadata={};try{metadata=JSON.parse(bytes);}catch{}
   const version=pack.manifest.version,dist={tarball:`http://127.0.0.1:${server.address().port}/${name}/-/${pack.filename}`,integrity:'sha512-'+createHash('sha512').update(pack.bytes).digest('base64'),shasum:createHash('sha1').update(pack.bytes).digest('hex')};
   const manifest={...pack.manifest,dist};
   if(path===name){metadata={...metadata,name,'dist-tags':{...metadata['dist-tags'],latest:version},versions:{...metadata.versions,[version]:manifest}};res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(metadata));return;}
   if(path===name+'/'+version){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(manifest));return;}
  }
  res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/octet-stream'});res.end(bytes);
 }catch(e){res.writeHead(500);res.end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));writeFileSync('/tmp/dx17/evidence/after-registry-url.txt',`http://127.0.0.1:${server.address().port}/`);console.log('pid='+process.pid+' port='+server.address().port);
process.on('SIGTERM',()=>server.close(()=>process.exit()));
