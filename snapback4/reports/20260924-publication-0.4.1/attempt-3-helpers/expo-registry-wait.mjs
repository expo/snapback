import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const expected=JSON.parse(readFileSync('reports/20260924-publication-0.4.1/expo-staged.json')).integrity;
const started=Date.now();
for(;;) {
 const result=spawnSync('npm',['view','snapback4-expo@0.4.1','dist.integrity','--json'],{encoding:'utf8'});
 if(result.status===0) {assert.equal(JSON.parse(result.stdout),expected);console.log(`snapback4-expo@0.4.1 registry matches ${expected}; propagation ${(Date.now()-started)/1000}s`);break;}
 assert.match(`${result.stdout}\n${result.stderr}`,/(?:E404|404 Not Found|is not in this registry)/i);
 assert.ok(Date.now()-started<600000,'published Expo version not readable after 10 minutes');
 console.log('waiting for snapback4-expo@0.4.1 to become readable');await delay(15000);
}
