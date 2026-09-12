import fs from 'node:fs';import crypto from 'node:crypto';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=fs.readdirSync('dist',{recursive:true}).filter(p=>fs.statSync('dist/'+p).isFile()).map(p=>({path:p,bytes:fs.statSync('dist/'+p).size,sha256:hash('dist/'+p)}));
const client=['node_modules/snapback3/dist/client.mjs','node_modules/snapback3/dist/react.mjs'].map(path=>({path,bytes:fs.statSync(path).size,sha256:hash(path)}));
fs.writeFileSync('evidence/transfer-sizes.json',JSON.stringify({epoch:Date.now(),sdk:{scope:'Installed SDK client and React entry files, raw uncompressed bytes; excludes React peer dependencies and native/compiler/owner artifacts; not tree-shaken app contribution',files:client},app:{scope:'All final exported static assets including service worker; raw disk bytes, distinct from actual network transfer and SDK closure',totalBytes:files.reduce((n,f)=>n+f.bytes,0),files}},null,2));
