// @ref LLP 3000.011.003.000#10 — upgrade the actual packed Expo consumer with both supported acquisition paths.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runToolchainCommand} from './publication-starters.mjs';

// Only the candidate artifacts are substituted. Expo and the rest of npm retain
// their real registry metadata, dependency solver, tarballs and lifecycle scripts.
export async function proveExpoUpgrades(client,platform,expo,directory,modes=['literal-install','upgrade','adapter-first']) {
  const artifacts=[client,platform,expo].map(path=>{
    const bytes=readFileSync(path), result=spawnSync('tar',['-xzOf',resolve(path),'package/package.json'],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    return {manifest:JSON.parse(result.stdout),bytes,integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
  });
  const version=artifacts[0].manifest.version;
  const registry=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const item=artifacts.find(item=>path==='/'+item.manifest.name || path==='/'+item.manifest.name+'/'+version || path==='/'+item.manifest.name+'/latest');
      if(path.startsWith('/_tar/')){const item=artifacts[Number(path.slice(6))];if(!item){res.writeHead(404).end();return;}res.end(item.bytes);return;}
      if(item){
        const manifest={...item.manifest,dist:{tarball:origin+'/_tar/'+artifacts.indexOf(item),integrity:item.integrity}};
        res.setHeader('content-type','application/json');res.end(JSON.stringify(path==='/'+manifest.name?{name:manifest.name,'dist-tags':{latest:version},versions:{[version]:manifest}}:manifest));return;
      }
      const upstream=await fetch('https://registry.npmjs.org'+req.url,{signal:AbortSignal.timeout(60000)});
      res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch(error){res.writeHead(502).end(String(error));}
  });
  await new Promise(resolve=>registry.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+registry.address().port;
  const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1',npm_config_registry:origin,npm_config_audit:'false',npm_config_fund:'false'};
  delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(cmd,args,cwd,extra={})=>runToolchainCommand(cmd,args,{cwd,env:{...env,...extra},timeout:300000});
  const results=[];
  try {
    for(const mode of modes) {
      const cwd=join(directory,'expo-upgrade-'+mode);mkdirSync(cwd,{recursive:true});
      const cli=join(cwd,'node_modules/.bin/snapback4');
      if(mode==='adapter-first') {
        writeFileSync(join(cwd,'package.json'),'{"private":true}');
        await run('npm',['install','--save-exact',`snapback4@${version}`,`snapback4-expo@${version}`],cwd);
        assert.equal(JSON.parse(readFileSync(join(cwd,'node_modules/react/package.json'))).version,'19.2.3');
        assert.equal(JSON.parse(readFileSync(join(cwd,'node_modules/react-native/package.json'))).version,'0.86.3');
        await run('npx',['snapback4','init','--expo'],cwd);
        await run('npm',['install'],cwd);
      } else {
      // Install and generate with the actual previous published CLI first.
      writeFileSync(join(cwd,'package.json'),'{"private":true}');
      await run('npm',['install','--no-save','--ignore-scripts','snapback4@0.4.29'],cwd,{npm_config_registry:'https://registry.npmjs.org'});
      await run(cli,['init','--expo'],cwd);
      const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
      assert.equal(pkg.dependencies.expo,'57.0.22');
      await run('npm',['install','--prefer-offline'],cwd,{npm_config_registry:'https://registry.npmjs.org'});
      assert.equal(JSON.parse(readFileSync(join(cwd,'node_modules/snapback4/package.json'))).version,'0.4.29');
      assert.equal(JSON.parse(readFileSync(join(cwd,'node_modules/snapback4-expo/package.json'))).version,'0.4.29');
      if(mode==='literal-install') await run('npm',['install','--save-exact',`snapback4@${version}`,`snapback4-expo@${version}`],cwd);
      else await run('npx',['--yes',`snapback4@${version}`,'upgrade','--to',version],cwd);
      }
      await run(cli,['check'],cwd);
      await run('npm',['run','typecheck'],cwd);
      await run(join(cwd,'node_modules/.bin/expo'),['export','-p','web','--max-workers','2'],cwd);
      const installed=JSON.parse(readFileSync(join(cwd,'node_modules/expo/package.json')));
      if(mode!=='adapter-first') assert.equal(installed.version,'57.0.22','the qualified lower peer preserves the old Expo runtime');
      const core=JSON.parse(readFileSync(join(cwd,'node_modules/expo-modules-core/package.json'))).version;
      assert.ok(Number(core.split('.')[2])>=23 && core.startsWith('57.0.'), 'adapter core floor wins over older Expo alignment');
      results.push({mode,status:'passed',fromExpo:mode==='adapter-first'?null:'57.0.22',expo:installed.version,version,webExport:'passed'});
    }
    return results;
  } finally {registry.closeAllConnections();await new Promise(resolve=>registry.close(resolve));}
}
