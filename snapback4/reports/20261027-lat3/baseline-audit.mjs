// Attribute the observed live npm audit red without bypassing the starter gate.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {runToolchainCommand,evaluateStarterAudit} from '../../scripts/publication-starters.mjs';
const source='/tmp/lat3/packed-consumers/starters/starter-expo';
const cwd='/tmp/lat3/baseline-expo-audit';mkdirSync(cwd,{recursive:true});
const pack='/home/ccheever/sb4-loop/reports/integration28/ready-pack';
const pkg=JSON.parse(readFileSync(join(source,'package.json')));
pkg.dependencies.snapback4='file:'+join(pack,'snapback4-0.4.44.tgz');
pkg.optionalDependencies={'snapback4-linux-x64':'file:'+join(pack,'snapback4-linux-x64-0.4.44.tgz')};
writeFileSync(join(cwd,'package.json'),JSON.stringify(pkg,null,2));
writeFileSync(join(cwd,'package-lock.json'),readFileSync(join(source,'package-lock.json')));
const env={...process.env,npm_config_cache:'/tmp/lat3/consumer-npm-cache'};
await runToolchainCommand('npm',['install','--ignore-scripts','--prefer-offline','--no-audit','--no-fund'],{cwd,env,timeout:300000});
await runToolchainCommand(process.execPath,['--input-type=commonjs','-e',`
 const {spawnSync}=require('node:child_process'),{writeFileSync}=require('node:fs');
 const r=spawnSync('npm',['audit','--json','--audit-level=low'],{encoding:'utf8',timeout:180000,maxBuffer:16777216});
 if(r.error||r.signal||r.status===null||r.status>1)throw Error(r.error||r.stderr||'npm audit failed');
 writeFileSync('audit.json',JSON.stringify(JSON.parse(r.stdout),null,2));
`],{cwd,env,timeout:200000});
const report=JSON.parse(readFileSync(join(cwd,'audit.json')));
const allowlist=JSON.parse(readFileSync(new URL('../../scripts/starter-audit-allowlist.json',import.meta.url)));
let verdict;
try{evaluateStarterAudit(report,'expo',allowlist,{});verdict='passed';}catch(e){verdict=e.message;}
const graph=directory=>Object.entries(JSON.parse(readFileSync(join(directory,'package-lock.json'))).packages)
 .filter(([path])=>path&&!/^node_modules\/snapback4(?:-linux-x64)?$/.test(path))
 .map(([path,pkg])=>[path,pkg.version]).sort(([a],[b])=>a.localeCompare(b));
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const baselineGraph=digest(graph(cwd)),candidateGraph=digest(graph(source));
const result={qualification:false,baselineVerdict:verdict,baselineGraph,candidateGraph,
 sameForeignDependencyGraph:baselineGraph===candidateGraph,
 vulnerabilities:report.vulnerabilities,metadata:report.metadata?.vulnerabilities};
writeFileSync(join(cwd,'comparison.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({baselineVerdict:verdict,sameForeignDependencyGraph:result.sameForeignDependencyGraph}));
if(verdict==='passed'||!result.sameForeignDependencyGraph)process.exitCode=1;
