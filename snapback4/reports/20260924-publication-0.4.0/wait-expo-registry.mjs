import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const expected=JSON.parse(readFileSync('reports/20260924-expo-0.4.0-phase4/qualified.json')).integrity;
const started=Date.now();
for(;;) {
 const response=await fetch('https://registry.npmjs.org/snapback4-expo/0.4.0',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(30000)});
 if(response.ok) {const meta=await response.json();assert.equal(meta.dist.integrity,expected);console.log(`snapback4-expo@0.4.0 registry matches ${expected}; propagation ${(Date.now()-started)/1000}s`);break;}
 assert.equal(response.status,404,'unexpected registry response');
 assert.ok(Date.now()-started<600000,'published Expo version not readable after 10 minutes');
 console.log('waiting for snapback4-expo@0.4.0 to become readable');await delay(15000);
}
