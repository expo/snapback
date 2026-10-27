// The affected consumer-only subset of qualify-linux; no publication or override.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {proveDay2} from '../../../scripts/publication-day2.mjs';
import {proveDay4} from '../../../scripts/publication-day4.mjs';
import {proveDay5} from '../../../scripts/publication-day5.mjs';
import {proveReleaseTransitions} from '../../../scripts/publication-release-transitions.mjs';
import {proveDormant} from '../../../scripts/publication-dormant.mjs';
import {proveDX8} from '../../../scripts/publication-dx8.mjs';
import {proveMigrations} from '../../../scripts/publication-migrations.mjs';
const [client,platform,out]=process.argv.slice(2).map(path=>resolve(path));mkdirSync(out,{recursive:true});
delete process.env.SNAPBACK4_BIN;delete process.env.PORT_LO;delete process.env.PORT_HI;
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const summary={clientSha256:sha(client),platformSha256:sha(platform),proofs:{}};
const consumer=join(out,'day2-compatibility');
for(const [name,run]of [
  ['day2',()=>proveDay2(client,platform,out)],
  ['releaseTransitions',()=>proveReleaseTransitions(consumer)],
  ['dormant',()=>proveDormant(consumer)],
  ['dx8',()=>proveDX8(consumer,client,platform)],
  ['day4',()=>proveDay4(consumer)],
  ['day5',()=>proveDay5(consumer)],
  ['migrations',()=>proveMigrations(client,platform,out)],
]) {
  const start=Date.now();
  try {const value=await run();summary.proofs[name]={status:'passed',elapsedMs:Date.now()-start,proof:value};console.log(name,'PASS');}
  catch(error) {summary.proofs[name]={status:'failed',elapsedMs:Date.now()-start,errorType:error.name};writeFileSync(join(out,name+'-failure.private.txt'),String(error.stack),{mode:0o600});console.log(name,'FAIL',error.name);}
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));
}
process.exitCode=Object.values(summary.proofs).some(p=>p.status!=='passed')?1:0;
