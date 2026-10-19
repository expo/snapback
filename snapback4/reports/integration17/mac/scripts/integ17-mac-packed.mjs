import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,client,platform,directory]=process.argv.slice(2);mkdirSync(directory,{recursive:true});
const cases=[['proof-kit','publication-proof-kit.mjs','proveProofKit'],['staging','publication-staging.mjs','proveStaging'],['security','publication-security.mjs','proveSecurity']];
const rows=[];
for(const [label,file,fn] of cases){
 const started=Date.now();console.log('packed start',label);
 try {const module=await import(pathToFileURL(join(root,'scripts',file)));const result=await module[fn](client,platform,join(directory,label));rows.push({label,exit:0,seconds:(Date.now()-started)/1000,result});console.log('packed passed',label);}
 catch(error){rows.push({label,exit:1,seconds:(Date.now()-started)/1000,error:String(error.stack??error)});console.error('packed failed',label,error);}
 writeFileSync(join(directory,'results.json'),JSON.stringify(rows,null,2));
}
process.exitCode=rows.some(row=>row.exit)?1:0;
