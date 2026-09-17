#!/usr/bin/env node
// @ref LLP 3000.007#21.5 — N >= 3, with derived-data ceremony and chosen-number counters.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { cpus, hostname, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVerificationLane } from './run.mjs';
import { command, launch } from './ceremony-process.mjs';
import { measureBounds } from './bounds-metrics.mjs';
import { probeBounds } from './bounds-probes.mjs';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here,'..');
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const read = (path) => existsSync(path) ? readFileSync(path,'utf8') : '';
function installedPin(lane) {
  const platform = `snapback4-${process.platform}-${process.arch}`, deps = join(lane,'node_modules');
  const files = {};
  function visit(path) {
    for (const entry of readdirSync(path,{withFileTypes:true})) {
      const child = join(path,entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files[relative(deps,child)] = hash(child);
    }
  }
  visit(join(deps,'snapback4')); visit(join(deps,platform));
  return {version:JSON.parse(read(join(deps,'snapback4/package.json'))).version,
    platformVersion:JSON.parse(read(join(deps,platform,'package.json'))).version,
    binarySha256:hash(join(deps,platform,'snapback4')), readmeSha256:hash(join(deps,'snapback4/README.md')),
    files, packageLockSha256:hash(join(lane,'package-lock.json'))};
}
export function packetHashes() {
  return Object.fromEntries(['bounds-brief.md','bounds.mjs','bounds-seed.mjs','bounds-metrics.mjs','bounds-probes.mjs',
    'ceremony-metrics.mjs','ceremony-process.mjs','run.mjs'].map((name) => [name,hash(join(here,name))]));
}
const resultShape = (r) => ({ok:r.status === 0 && !r.timedOut && !r.error,status:r.status,timedOut:r.timedOut,error:r.error,tail:r.out.slice(-3000)});
export async function verifyBounds(lane) {
  const directory = prepareVerificationLane(lane);
  const check = resultShape(await command('npx',['--no-install','snapback4','check'],{cwd:directory,log:join(directory,'verify-check.log')}));
  const acceptanceDirectory = prepareVerificationLane(lane);
  const acceptance = resultShape(await command('npm',['run','acceptance'],{cwd:acceptanceDirectory,log:join(acceptanceDirectory,'verify-acceptance.log'),limitMs:1800000}));
  const probeDirectory = prepareVerificationLane(lane), probes = await probeBounds(probeDirectory);
  const result = {directory,acceptanceDirectory,probeDirectory,check,acceptance,probes,ok:check.ok && acceptance.ok && probes.ok};
  writeFileSync(join(directory,'verification.json'),JSON.stringify(result,null,2)+'\n'); return result;
}
export function verdict(measurement, outcome) {
  return measurement.reportedGreen === true && outcome.pinUnchanged === true && outcome.verify?.ok === true &&
    outcome.exitCode === 0 && !outcome.timedOut;
}
export function recordRun(metrics, lane, out) {
  mkdirSync(dirname(metrics),{recursive:true});
  appendFileSync(metrics,JSON.stringify(out)+'\n');
  writeFileSync(join(lane,'runner-result.json'),JSON.stringify(out,null,2)+'\n');
}
async function main(argv) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('bounds bar requires Node 24');
  const args = {};
  for (let i=0;i<argv.length;i+=2) {
    if (!argv[i].startsWith('--') || argv[i+1] === undefined) throw new Error('arguments are --name value pairs');
    const name=argv[i].slice(2);
    if (!['n','version','root','metrics','model','effort','limit','reverify','output'].includes(name)) throw new Error(`unknown --${name}`);
    args[name]=argv[i+1];
  }
  if (args.reverify) {
    const lane=resolve(args.reverify), measurement=measureBounds(lane), verify=await verifyBounds(lane);
    const previous=JSON.parse(read(join(lane,'runner-result.json')) || '{}'), installed=installedPin(lane);
    const pinUnchanged=previous.installedBefore && JSON.stringify(previous.installedBefore) === JSON.stringify(installed) &&
      hash(join(lane,'bounds-seed.mjs')) === packetHashes()['bounds-seed.mjs'];
    const out={at:new Date().toISOString(),reverify:lane,packet:packetHashes(),measurement,verify,installed,pinUnchanged:!!pinUnchanged,
      green:measurement.reportedGreen && verify.ok && !!pinUnchanged};
    writeFileSync(resolve(args.output ?? join(lane,'bounds-reverification.json')),JSON.stringify(out,null,2)+'\n');
    console.log(JSON.stringify(out)); process.exitCode=out.green ? 0 : 1; return;
  }
  const n=Number(args.n ?? 3), limit=Number(args.limit ?? 3600), version=args.version ?? '0.2.27';
  if (!Number.isInteger(n) || n<3) throw new Error('--n must be an integer >= 3; smaller runs cannot calibrate the bounds bar');
  if (!Number.isFinite(limit) || limit<=0) throw new Error('--limit must be positive seconds');
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('--version must be an exact published version');
  const runsRoot=resolve(args.root ?? join(tmpdir(),`snapback4-bounds-${Date.now()}`)), metrics=resolve(args.metrics ?? join(root,'metrics/boundsbar.jsonl'));
  const model=args.model ?? 'gpt-6-astra', effort=args.effort ?? 'medium', packet=packetHashes();
  const brief=read(join(here,'bounds-brief.md')).replaceAll('{VERSION}',version).replace('60 minutes',`${limit/60} minutes`);
  mkdirSync(runsRoot,{recursive:true}); let failures=0;
  for (let run=1;run<=n;run++) {
    const lane=join(runsRoot,`run-${run}`);
    if (existsSync(lane)) throw new Error(`refusing existing lane: ${lane}`);
    mkdirSync(lane); writeFileSync(join(lane,'brief.md'),brief); cpSync(join(here,'bounds-seed.mjs'),join(lane,'bounds-seed.mjs'));
    const start=Date.now(), out={at:new Date(start).toISOString(),run,version,model,effort,lane,packet,node:process.version,
      limitSeconds:limit,host:{name:hostname(),platform:process.platform,arch:process.arch,cpus:cpus().length,cpu:cpus()[0]?.model,sharedAndLoaded:true},
      loadAverages:[{phase:'start',at:new Date().toISOString(),values:loadavg()}],green:false,measurementComplete:false};
    const sample=setInterval(() => out.loadAverages.push({phase:'running',at:new Date().toISOString(),values:loadavg()}),30000);
    console.log(JSON.stringify({phase:'start',run,lane}));
    try {
      writeFileSync(join(lane,'package.json'),JSON.stringify({name:`bounds-run-${run}`,private:true,type:'module'},null,2)+'\n');
      const install=await command('npm',['install','--save-exact',`snapback4@${version}`],{cwd:lane,log:join(lane,'install.log'),limitMs:180000});
      out.installSeconds=(Date.now()-start)/1000;
      if (!resultShape(install).ok) throw new Error(`install failed: ${install.out}`);
      out.installedBefore=installedPin(lane);
      if (out.installedBefore.version !== version || out.installedBefore.platformVersion !== version) throw new Error('installed pin mismatch');
      const agentStart=Date.now();
      const invocation=['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m',model,
        '-c',`model_reasoning_effort=${effort}`,'-C',lane,'-o',join(lane,'FINAL.md'),'-'];
      out.invocation={command:join(process.env.HOME,'.volta/bin/codex'),args:invocation};
      console.log(JSON.stringify({phase:'agent',run,lane}));
      const agent=launch(out.invocation.command,invocation,{cwd:lane,input:brief,log:join(lane,'codex.ndjson'),limitMs:Math.max(1,limit*1000-(Date.now()-start))});
      out.agentPid=agent.child.pid; const result=await agent.done;
      Object.assign(out,{agentWallSeconds:(Date.now()-agentStart)/1000,wallSeconds:(Date.now()-start)/1000,
        exitCode:result.status,exitSignal:result.signal,timedOut:result.timedOut,agentError:result.error});
      out.installedAfter=installedPin(lane);
      out.pinUnchanged=JSON.stringify(out.installedBefore) === JSON.stringify(out.installedAfter) && hash(join(lane,'bounds-seed.mjs')) === packet['bounds-seed.mjs'];
      Object.assign(out,measureBounds(lane));
      out.measurementComplete=out.measurementErrors.length === 0;
      console.log(JSON.stringify({phase:'verify',run,reportedGreen:out.reportedGreen,wallSeconds:out.wallSeconds}));
      const verificationStart=Date.now(); out.verify=await verifyBounds(lane); out.verificationSeconds=(Date.now()-verificationStart)/1000;
      out.runtimeBounds=out.verify.probes.runtimeBounds; out.seedSeconds=out.verify.probes.seedSeconds;
      out.green=verdict(out,out);
      out.loopBarComparison={wallAtMost1200:out.wallSeconds<=1200,snapbackAttributedAtMost1:out.correctionLoops.snapbackAttributed<=1};
    } catch (error) { out.error=error.stack; out.green=false; }
    finally {
      clearInterval(sample); out.wallSeconds ??= (Date.now()-start)/1000;
      out.totalSeconds=(Date.now()-start)/1000; out.loadAverages.push({phase:'finish',at:new Date().toISOString(),values:loadavg()});
    }
    if (!out.green || !out.measurementComplete) failures++;
    recordRun(metrics,lane,out);
    console.log(JSON.stringify({phase:'complete',run,green:out.green,measurementComplete:out.measurementComplete,error:out.error}));
  }
  console.log(`bounds bar: ${n-failures} passed; ${failures} failed; ${n} runs`); process.exitCode=failures ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
