import fs from 'node:fs';import crypto from 'node:crypto';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const artifacts=['snapback4','snapback4-linux-x64','snapback4-expo'].map(name=>{
 const path='/tmp/dx17/packs/'+name+'-0.4.48.tgz',bytes=fs.readFileSync(path);
 return{name,version:'0.4.48',path,bytes:bytes.length,integrity:'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64'),sha256:sha(bytes)};
});
const binary=fs.readFileSync('/tmp/dx17/packs/platform/snapback4');
fs.writeFileSync('/tmp/dx17/evidence/candidate-artifacts.json',JSON.stringify({source:'6d2613c4ee',nativeProfile:'production',target:'x86_64-unknown-linux-musl',incremental:0,devDebug:0,testDebug:0,artifacts,binarySha256:sha(binary),guideBytes:fs.readFileSync('snapback4/crates/snapback4-lang/src/guide/day2.md').length,expo:'Unchanged registry tarball at the same exact version; no Mac build.'},null,2));
for(const n of [2,5]){
 const launch='/tmp/dx17/evidence/after-final-'+n+'-launch.json';
 if(!fs.existsSync(launch))continue;
 const dir=JSON.parse(fs.readFileSync(launch)).dir,file=dir+'/node_modules/snapback4-linux-x64/snapback4';
 if(fs.existsSync(file))console.log({n,version:JSON.parse(fs.readFileSync(dir+'/node_modules/snapback4/package.json')).version,productionDigestMatches:sha(fs.readFileSync(file))===sha(binary)});
}
