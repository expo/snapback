import assert from 'node:assert/strict';import {mkdirSync} from 'node:fs';import {proveExpoUpgrades} from '../scripts/publication-regressions.mjs';
const base='/home/ccheever/sb4-loop/dist/0.4.30/';
for(const mode of ['literal-install','upgrade']) {
 const directory=new URL('./reg-baseline-'+mode,import.meta.url).pathname;mkdirSync(directory,{recursive:true});
 await assert.rejects(proveExpoUpgrades(base+'snapback4-0.4.30.tgz',base+'snapback4-linux-x64-0.4.30.tgz',base+'snapback4-expo-0.4.30.tgz',directory,[mode]),/command exited/);
 console.log('R2 baseline '+mode+' failed as expected');
}
