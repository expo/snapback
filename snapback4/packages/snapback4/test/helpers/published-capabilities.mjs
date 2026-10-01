import { hangBudget } from './wait.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Opt-in real-package witness, like the prior F2 witness. The cache only
// avoids downloads: every run checks registry integrity and extracts afresh.
const integrity={
  snapback4:'sha512-z6nd0glf9qkms1GzIfJ4jvJAUr1Y0JqgV8rfXsxWcqhDK7MlEHxAeZlsRBuW5PoJpoHRKOzqxdvgkitVBHQ1vQ==',
  'snapback4-darwin-arm64':'sha512-gRXvTa7jSDMXVhepsLaI+D/ydt8r93ROmpbC6rTUYh9cI+EBGMIqbwcVjDyb5suXwRECaJOPW90ZAXMF43cp6A==',
};
export async function published(cache, into, diagnostic) {
  assert.equal(`${process.platform}-${process.arch}`,'darwin-arm64','the opt-in native 0.2.33 witness requires darwin-arm64');
  mkdirSync(cache,{recursive:true});
  for(const name of ['snapback4','snapback4-darwin-arm64']) {
    const response=await fetch(`https://registry.npmjs.org/${name}/0.2.33`,{signal:AbortSignal.timeout(hangBudget())});
    assert.equal(response.status,200);
    const meta=await response.json(), archive=join(cache,`${name}-0.2.33.tgz`);
    assert.equal(meta.version,'0.2.33');assert.equal(meta.dist.integrity,integrity[name]);
    const [algorithm,want]=integrity[name].split('-');
    const matches=()=>createHash(algorithm).update(readFileSync(archive)).digest('base64')===want;
    if(existsSync(archive)&&!matches())rmSync(archive);
    if(!existsSync(archive)) {
      const tarball=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(hangBudget())});
      assert.equal(tarball.status,200);writeFileSync(archive,Buffer.from(await tarball.arrayBuffer()));
    }
    assert.equal(algorithm,'sha512');
    assert.ok(matches(),`${name} pinned npm integrity`);
    const destination=join(into,name);mkdirSync(destination,{recursive:true});
    const result=spawnSync('tar',['-xzf',archive,'-C',destination],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(readFileSync(join(destination,'package/package.json'),'utf8')).version,'0.2.33');
    diagnostic(`${name}@0.2.33 verified ${meta.dist.integrity}`);
  }
  const binary=join(into,'snapback4-darwin-arm64/package/snapback4');
  const version=spawnSync(binary,['--version'],{encoding:'utf8'});
  assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),'snapback4 0.2.33');
  const wasm=await loadWasm(join(into,'snapback4/package/dist/wasm'));
  return {binary,wasm};
}
export async function loadWasm(directory) {
  const module=await import(pathToFileURL(join(directory,'snapback4_device.js')));
  module.initSync({module:readFileSync(join(directory,'snapback4_device_bg.wasm'))});
  assert.equal(typeof module.WebDevice,'function','WASM glue must export WebDevice');
  return module.WebDevice;
}
