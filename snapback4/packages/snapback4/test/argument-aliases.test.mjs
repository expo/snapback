import test from 'node:test';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {cli,startServe} from '../dist/proof.js';
import {argumentAliasCases} from '../../../scripts/argument-alias-cases.mjs';

test('argument aliases preserve old calls across server, generated and CLI paths',{timeout:240_000},async()=>{
  const previous=process.env.SNAPBACK4_BIN;
  process.env.SNAPBACK4_BIN??=fileURLToPath(new URL('../../../target/debug/snapback4',import.meta.url));
  try {await argumentAliasCases({cli,startServe},tmpdir());}
  finally {if(previous===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=previous;}
});
