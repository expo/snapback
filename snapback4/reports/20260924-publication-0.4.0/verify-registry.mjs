import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),report=resolve(root,'reports/20260924-publication-0.4.0');
const stage=JSON.parse(readFileSync(resolve(report,'staged-receipt.json')));
const expo=JSON.parse(readFileSync(resolve(root,'reports/20260924-expo-0.4.0-phase4/qualified.json')));
const expected=process.argv.includes('--expo')?[{name:'snapback4-expo',version:'0.4.0',integrity:expo.integrity,bytes:expo.bytes,tarball:expo.tarball}]:[stage.client,stage.platformArtifact].map(a=>({...a,tarball:resolve(root,'target/publication/snapback4-darwin-arm64-0.4.0',a.filename)}));
const path=resolve(report,'registry-verified.json');
const record=existsSync(path)?JSON.parse(readFileSync(path)):{source:'20cb39bf0ffd49f619e3d904bbb7355bc19993bd',packages:{}};
const sri=b=>'sha512-'+createHash('sha512').update(b).digest('base64');
for(const a of expected) {
 assert.equal(sri(readFileSync(a.tarball)),a.integrity,'qualified local integrity');
 const response=await fetch(`https://registry.npmjs.org/${a.name}/${a.version}`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'registry version must be readable');
 const meta=await response.json();assert.equal(meta.name,a.name);assert.equal(meta.version,a.version);assert.equal(meta.dist.integrity,a.integrity);
 assert.equal(new URL(meta.dist.tarball).origin,'https://registry.npmjs.org');
 const download=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(60000)});assert.equal(download.status,200);
 const data=Buffer.from(await download.arrayBuffer());assert.equal(sri(data),a.integrity);assert.equal(data.length,a.bytes);
 record.packages[a.name]={version:a.version,integrity:a.integrity,bytes:data.length,tarballUrl:meta.dist.tarball,metadataMatches:true,downloadMatches:true,qualifiedLocalTarball:a.tarball,verifiedAt:new Date().toISOString()};
 console.log(`${a.name}@${a.version}: registry metadata + downloaded ${data.length} bytes match ${a.integrity}`);
}
writeFileSync(path,JSON.stringify(record,null,2)+'\n');
