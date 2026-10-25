// @ref LLP 3000.000.000.001#13-wave-26-developer-loop-repairs-dx9 — changed snippets and password proof scaffolds execute from installed packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';

const root=resolve(import.meta.dirname,'../../..');
test('DX9 packed staging recipe, password templates, task links and Quarry forms run literally', {timeout:300000}, async () => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-dx9-packed-'));
  const env={...process.env,npm_config_cache:'/tmp/dx9-npm-cache'};
  delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(command,args,cwd=dir)=>execFileSync('timeout',['120s',command,...args],{cwd,env,encoding:'utf8',maxBuffer:8*1024*1024});
  const fence=(text,language)=>[...text.matchAll(new RegExp('```'+language+'\\n([\\s\\S]*?)```','g'))].map(m=>m[1]);
  try {
    const pack=source=>join(dir,JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],source))[0].filename);
    const client=pack(join(root,'packages/snapback4'));
    const platformName=`snapback4-${process.platform}-${process.arch}`,native=join(dir,'native');mkdirSync(native);
    copyFileSync(join(root,'packages',platformName,'package.json'),join(native,'package.json'));
    copyFileSync(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'),join(native,'snapback4'));
    const platform=pack(native);
    writeFileSync(join(dir,'package.json'),JSON.stringify({private:true,type:'module',dependencies:{snapback4:`file:${client}`},optionalDependencies:{[platformName]:`file:${platform}`}}));
    run('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
    const cli=join(dir,'node_modules/.bin/snapback4');
    const guide=(name)=>run(cli,['guide',name,'--full']);
    mkdirSync(join(dir,'snapback'));
    const staging=guide('staging');writeFileSync(join(dir,'snapback/schema.q'),fence(staging,'quarry')[0]);
    run(cli,['check']);
    writeFileSync(join(dir,'staging.mjs'),fence(staging,'js')[0]);
    run(process.execPath,['staging.mjs','--once']);
    assert.equal(statSync(join(dir,'staging-users.json')).mode&0o777,0o600);
    // Never copy/print credential bytes to evidence.
    rmSync(join(dir,'staging-users.json'));rmSync(join(dir,'staging'),{recursive:true,force:true});
    const tasks=guide('tasks');
    for(const line of fence(tasks,'sh').flatMap(block=>block.trim().split('\n'))) assert.ok(run(cli,line.split(' ').slice(1)).length);
    for(const command of tasks.matchAll(/`snapback4 guide ([a-z-]+)(?: --section "([^"]+)"| --full)`/g)) {
      const args=['guide',command[1],...(command[2]?['--section',command[2]]:['--full'])];
      assert.ok(run(cli,args).length,command[0]);
    }
    const forms=fence(guide('programs'),'quarry').find(source=>source.includes('fn crewSize'));
    assert.ok(forms);writeFileSync(join(dir,'snapback/schema.q'),forms);run(cli,['check']);
    // The starter detects the standard operator provision signature and seeds
    // every declared role with two real accounts; it never uses dev/status.
    writeFileSync(join(dir,'snapback/schema.q'),fence(staging,'quarry')[0]);
    for(const flag of ['--web','--expo']) {
      const app=join(dir,flag.slice(2));mkdirSync(app);mkdirSync(join(app,'snapback'));
      writeFileSync(join(app,'snapback/schema.q'),fence(staging,'quarry')[0]);
      run(cli,['init',flag,'--skip-existing'],app);run(cli,['check'],app);
      const proof=readFileSync(join(app,'scripts/frontend-proof.mjs'),'utf8');
      assert.ok(proof.includes('startStaging')&&!proof.includes('/dev/status')&&!proof.includes('startDev('));
      if(flag==='--expo') {
        assert.match(readFileSync(join(app,'index.js'),'utf8'),/import App from/);
        assert.match(readFileSync(join(app,'App.tsx'),'utf8'),/export default function App/);
        assert.ok(JSON.parse(readFileSync(join(app,'package.json'))).devDependencies['@types/node']);
      }
      const child=spawn(process.execPath,['scripts/probe-serve.mjs'],{cwd:app,env,stdio:['ignore','pipe','pipe']});
      const closed=once(child,'close');let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
      try {
        const end=Date.now()+30000;
        while(!stdout.includes('\n')&&Date.now()<end) {assert.equal(child.exitCode,null,stderr);await new Promise(resolve=>setTimeout(resolve,20));}
        const ready=JSON.parse(stdout.trim());assert.equal(statSync(ready.credentialsFile).mode&0o777,0o600);
        const config=await fetch(ready.backendUrl+'/auth/config').then(r=>r.json());
        assert.equal(config.development,false);assert.equal(config.environment,'staging');
        child.kill('SIGTERM');assert.deepEqual(await closed,[0,null],stderr);
        assert.equal(stdout.trim().split('\n').length,1);
      } finally {if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
