import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Opt-in real-package witness, like the prior F2 witness. The cache only
// avoids downloads: every run checks registry integrity and extracts afresh.
export async function published(cache, into, diagnostic) {
  mkdirSync(cache,{recursive:true});
  for(const name of ['snapback4','snapback4-darwin-arm64']) {
    const response=await fetch(`https://registry.npmjs.org/${name}/0.2.33`,{signal:AbortSignal.timeout(30_000)});
    assert.equal(response.status,200);
    const meta=await response.json(), archive=join(cache,`${name}-0.2.33.tgz`);
    if(!existsSync(archive)) {
      const tarball=await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(30_000)});
      assert.equal(tarball.status,200);writeFileSync(archive,Buffer.from(await tarball.arrayBuffer()));
    }
    const [algorithm,want]=meta.dist.integrity.split('-'), bytes=readFileSync(archive);
    assert.equal(algorithm,'sha512');
    assert.equal(createHash(algorithm).update(bytes).digest('base64'),want,`${name} npm integrity`);
    const destination=join(into,name);mkdirSync(destination,{recursive:true});
    const result=spawnSync('tar',['-xzf',archive,'-C',destination],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    diagnostic(`${name}@0.2.33 verified ${meta.dist.integrity}`);
  }
  const binary=join(into,'snapback4-darwin-arm64/package/snapback4');
  const wasm=await loadWasm(join(into,'snapback4/package/dist/wasm'));
  return {binary,wasm};
}
export async function loadWasm(directory) {
  const module=await import(pathToFileURL(join(directory,'snapback4_device.js')));
  module.initSync({module:readFileSync(join(directory,'snapback4_device_bg.wasm'))});
  return module.WebDevice;
}
