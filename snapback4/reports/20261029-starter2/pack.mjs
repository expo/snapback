import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'../..'),out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const packages=['snapback4','snapback4-expo'], manifest={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),packages:{}};
function pack(name,cwd){const [p]=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',out],{cwd,encoding:'utf8'}));manifest.packages[name]={file:p.filename,sha256:createHash('sha256').update(readFileSync(join(out,p.filename))).digest('hex')};}
for(const name of packages){
  const file=`${name}-0.4.49.tgz`;
  if(process.argv.includes('--keep-client') && existsSync(join(out,file)))manifest.packages[name]={file,sha256:createHash('sha256').update(readFileSync(join(out,file))).digest('hex')};
  else pack(name,join(root,'packages',name));
}
const platform=join(out,'platform');mkdirSync(platform);
for(const name of ['package.json','THIRD-PARTY-NOTICES'])copyFileSync(join(root,'packages/snapback4-linux-x64',name),join(platform,name));
const binary=join(root,'target/x86_64-unknown-linux-musl/production/snapback4');copyFileSync(binary,join(platform,'snapback4'));
pack('snapback4-linux-x64',platform);rmSync(platform,{recursive:true});manifest.nativeSha256=createHash('sha256').update(readFileSync(binary)).digest('hex');writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
