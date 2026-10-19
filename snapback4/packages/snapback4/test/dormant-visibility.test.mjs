import test from 'node:test';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {cli,startServe} from '../dist/proof.js';
import {dormantCases} from '../../../scripts/dormant-cases.mjs';
test('dormant old views, exact forward, conflicts and operator inspection',{timeout:240_000},async()=>{
  const old=process.env.SNAPBACK4_BIN;
  process.env.SNAPBACK4_BIN??=fileURLToPath(new URL('../../../target/debug/snapback4',import.meta.url));
  try {await dormantCases({cli,startServe},tmpdir());}
  finally {if(old===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=old;}
});
