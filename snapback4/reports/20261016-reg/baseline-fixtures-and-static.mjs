import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {cli,startDev,loadFixtures,startStatic,cleanup} from 'snapback4/proof';
const pkg=JSON.parse(readFileSync('package.json'));pkg.dependencies.snapback4='0.4.30';writeFileSync('package.json',JSON.stringify(pkg));
const initialized=await cli(['init','--web']);assert.equal(initialized.code,0,initialized.stderr);
const schema='snapback/schema.q';writeFileSync(schema,readFileSync(schema,'utf8').replace(/^use identity.*$/m,''));
const dev=await startDev();
try{await assert.rejects(loadFixtures('fixtures',{url:dev.url}),/E_INPUT: \/:.*E_AUTH/);console.log('R1 baseline failed as expected: guide fixture call loses E_AUTH');}
finally{await cleanup(()=>dev.stop());}
await assert.rejects(startStatic('missing-dist'),/ENOENT/);console.log('P20 baseline failed as expected: missing dist emits ENOENT');
