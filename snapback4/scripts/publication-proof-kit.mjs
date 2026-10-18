// Packed guide recipes and pre-wave controls. Every example executes unchanged.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runToolchainCommand} from './publication-starters.mjs';
import {chromiumExecutable} from '../witness/lib.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function proveProofKit(client,platform,directory) {
  const cwd=join(resolve(directory),'proof-kit');mkdirSync(cwd,{recursive:true});
  const env={...process.env,CI:'1',CHROME:process.env.CHROME??chromiumExecutable(),npm_config_audit:'false',npm_config_fund:'false'};
  delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(command,args)=>runToolchainCommand(command,args,{cwd,env,timeout:300000});
  const capture=args=>{
    const result=spawnSync(process.execPath,[join(cwd,'node_modules/snapback4/bin/snapback4.js'),...args],{cwd,env,encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;
  };
  writeFileSync(join(cwd,'package.json'),'{"private":true,"type":"module"}');
  await run('npm',['install','--ignore-scripts','--no-audit','--no-fund',resolve(client),resolve(platform)]);
  const wrapper=join(cwd,'node_modules/snapback4/bin/snapback4.js');
  await run(process.execPath,[wrapper,'init','--web']);
  const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
  pkg.dependencies.snapback4=`file:${resolve(client)}`;
  pkg.optionalDependencies={[`snapback4-${process.platform}-${process.arch}`]:`file:${resolve(platform)}`};
  writeFileSync(join(cwd,'package.json'),JSON.stringify(pkg,null,2));
  await run('npm',['install','--prefer-offline','--no-audit','--no-fund']);
  env.PATH=join(cwd,'node_modules/.bin')+':'+env.PATH;
  const guide=capture(['guide','testing','--full']);writeFileSync(join(cwd,'testing-guide.md'),guide);
  const recipe=guide.match(/<!-- DAY TWO ACCOUNTS BEGIN -->\n```js\n([\s\S]*?)\n```\n<!-- DAY TWO ACCOUNTS END -->/)?.[1];
  assert.ok(recipe,'packed guide has the complete day-two proof');
  writeFileSync(join(cwd,'day2-accounts.mjs'),recipe);
  await run(process.execPath,['day2-accounts.mjs']);
  writeFileSync(join(cwd,'clock-controls.mjs'),clockControls);
  await run(process.execPath,['clock-controls.mjs']);
  const testEnv={...env,SNAPBACK4_BIN:join(cwd,`node_modules/snapback4-${process.platform}-${process.arch}/snapback4`),SNAPBACK4_PROOF_PACKAGE:join(cwd,'node_modules/snapback4')};
  await runToolchainCommand(process.execPath,['--test',join(root,'packages/snapback4/test/wire-first.test.mjs')],{cwd,env:testEnv,timeout:60000});
  return {status:'passed',dayTwo:'production accounts, UI sign-in, v1/hot v2/rollback/forward business assertions',wire:'literal first section, actual packed CLI trace',clock:'30-day coalesced jump, each-boundary cap, memory replay command, page sampling',aliases:'array index path through packed test'};
}
const clockControls=String.raw`
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDev,startStatic,withBrowser,waitForClock,renderedText,waitForFresh,cli,command,cleanup} from 'snapback4/proof';
const cwd=await mkdtemp(join(tmpdir(),'kit4-packed-clock-'));
let dev,web,uiDev;
try {
  await mkdir(join(cwd,'snapback'));await mkdir(join(cwd,'fixtures'));
  const source="use personas alice\ntable counters:\n  n: int\n  cap 1\n  public 'proof'\n  update <- allow\n  online only\nquery counts():\n  return counters first 1 by .id\nmutation bump(counterId: counters):\n  row = counters[counterId] ! else NOT_FOUND\n  update counters[row] {n:row.n+1}\n  return null\njob tick():\n  chunk row in counters first 1 by .id:\n    update counters[row.id] {n:row.n+1}\njob secondTick():\n  chunk row in counters first 1 by .id:\n    update counters[row.id] {n:row.n+1}\nschedule first every 5m: tick\nschedule second every 5m: secondTick\n";
  await writeFile(join(cwd,'snapback/schema.q'),source);
  await writeFile(join(cwd,'fixtures/counters.jsonl'),'{"id":"counter","n":0}\n');
  await writeFile(join(cwd,'fixtures/test.cases.jsonl'),[
    {as:'alice',op:'counts',args:{},save:'rows',count:1},
    {as:'alice',op:'bump',args:{counterId:'$rows.0.id'}},
    {as:'alice',op:'counts',args:{},match:[{n:1}]}].map(JSON.stringify).join('\n'));
  const tested=await cli(['test'],{cwd});assert.equal(tested.code,0,tested.stdout+tested.stderr);
  dev=await startDev({cwd,args:['--no-watch']});
  const post=async(path,body)=>(await fetch(dev.url+path,{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify(body)})).json();
  await post('/seed',[{table:'counters',row:{id:'counter',n:0}}]);
  const refused=await post('/dev/clock/advance',{duration:'30d',eachBoundary:true});
  assert.equal(refused.denied.code,'E_CLOCK_INPUT');assert.match(refused.denied.message,/--each-boundary.*10000.*omit --each-boundary/);
  assert.equal((await (await fetch(dev.url+'/dev/status')).json()).clockOffsetMs,0);
  const advanced=await post('/dev/clock/advance',{duration:'30d'});
  assert.equal(advanced.offsetMs,30*86400000);assert.equal(advanced.schedules.length,2);
  for(const schedule of advanced.schedules) {assert.equal(schedule.firedWindows.length,1);assert.equal(schedule.skippedPeriods,8639);assert.equal(schedule.skippedBoundariesOmitted,8607);}
  const count=async()=> (await post('/q/counts',{args:{}})).data[0].n;
  assert.equal(await count(),2);
  const replay=advanced.schedules[0].skippedBoundaries[0].command;
  assert.ok(replay.includes('--port '+new URL(dev.url).port),replay);
  const replayed=await command('sh',['-c',replay],{cwd});assert.equal(replayed.code,0,replayed.stderr);assert.equal(await count(),3);
  await dev.stop();dev=undefined;
  // The built production starter uses its own real client and witness clock.
  uiDev=await startDev();web=await startStatic('dist');
  await withBrowser({executablePath:process.env.CHROME},async context=>{
    const page=await context.newPage();await page.goto(web.url+'/?api='+encodeURIComponent(uiDev.url));
    await page.getByRole('button',{name:'Continue as a guest',exact:true}).click();
    await waitForFresh(renderedText(page,'Teams and roles'),null);
    const response=await fetch(uiDev.url+'/dev/clock/advance',{method:'POST',body:JSON.stringify({duration:'2m'})});
    const advanced=await response.json();assert.ok(!advanced.denied,JSON.stringify(advanced));
    assert.ok(await waitForClock(page,advanced.now)>=advanced.now);
  });
  console.log('packed clock and alias controls passed');
} finally {await cleanup(()=>web?.stop(),()=>uiDev?.stop(),()=>dev?.stop(),()=>rm(cwd,{recursive:true,force:true}));}
`;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [client,platform,out]=process.argv.slice(2);
  if(!client||!platform||!out) throw Error('usage: publication-proof-kit.mjs client.tgz platform.tgz output-directory');
  console.log(JSON.stringify(await proveProofKit(client,platform,out),null,2));
}
