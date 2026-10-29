// Census actual npm tarballs, counting a recursive file listing and every .md
// except README. Run after frozen packs exist; o200k_base matches Codex census.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {getEncoding} from 'js-tiktoken';
const root=resolve(process.env.TOK6_ROOT??resolve(import.meta.dirname,'../..'));
const encoder=getEncoding('o200k_base'),result={};
for(const phase of ['before','after']){
 const tarball=join(root,`target/tok6/${phase}/snapback4-0.4.49.tgz`);
 const files=execFileSync('tar',['-tf',tarball],{encoding:'utf8'}).split('\n').filter(p=>p&&!p.endsWith('/')).map(p=>p.replace(/^package\//,'')).sort();
 const markdown=files.filter(p=>p.endsWith('.md'));
 const docs=markdown.filter(p=>p!=='README.md').map(p=>execFileSync('tar',['-xOf',tarball,'package/'+p],{encoding:'utf8',maxBuffer:8*1024*1024}));
 const text=files.join('\n')+'\n'+docs.join('\n');
 result[phase]={files:files.length,markdown,bytesBeyondReadme:Buffer.byteLength(text),tokensBeyondReadme:encoder.encode(text).length};
}
result.ceilingTokens=3000;result.pass=result.after.tokensBeyondReadme<=result.ceilingTokens;
writeFileSync(join(root,'target/tok6/evidence/markdown-budget.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));if(!result.pass)process.exitCode=1;
