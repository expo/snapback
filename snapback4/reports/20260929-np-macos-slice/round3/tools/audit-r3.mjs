import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
import {privateBuildFlags,auditNativeProject,compilerClosure} from './lane/snapback4/crates/snapback4/src/verbs/witness/native-closure.mjs';
const cache='/Users/ccheever/sb4-np/subject/.snapback4-witness',root=cache+'/snapshot',out='/Users/ccheever/sb4-np/evidence/round3';
const system=['/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator27.0.sdk','/Applications/Xcode.app/Contents/Developer','/System/Library','/usr/lib'];
const graphs=[];
for(const relative of ['Clique','Pods/Pods']){
 const file=root+'/ios/'+relative+'.xcodeproj';
 const r=spawnSync('xcodebuild',['-project',file,'-alltargets','-configuration','Release','-sdk','iphonesimulator','ARCHS=arm64',...privateBuildFlags(cache),'-showBuildSettings','-json'],{encoding:'utf8',maxBuffer:64000000});
 fs.writeFileSync(out+'/'+relative.replace('/','-')+'-settings.json',r.stdout); if(r.status)throw Error(r.stderr);
 const graph=JSON.parse(spawnSync('/usr/bin/plutil',['-convert','json','-o','-',file+'/project.pbxproj'],{encoding:'utf8',maxBuffer:64000000}).stdout);
 graphs.push(auditNativeProject(graph,file.slice(0,file.lastIndexOf('/')),JSON.parse(r.stdout),root,cache,system,'Clique'));
}
console.log('graphs',graphs.map(g=>[g.sources.length,g.references.length,g.phases.length]));
fs.writeFileSync(out+'/initial-closure.json',JSON.stringify(compilerClosure(root,cache,system,graphs.flatMap(g=>g.sources),graphs.flatMap(g=>g.products)),null,2));
