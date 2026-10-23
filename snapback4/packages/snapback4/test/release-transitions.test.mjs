import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { cli, startServe } from '../dist/proof.js';
import { releaseTransitions } from '../../../scripts/release-transitions-cases.mjs';
import { hangBudget } from './helpers/wait.mjs';
// The grouped proof owns over seventy CLI/HTTP call sites plus repeated stages.
test('release reactivation, refusal cleanup, rollback foresight and frozen v1 guide callers', {timeout:hangBudget(120)}, async () => {
  const original=process.env.SNAPBACK4_BIN;
  process.env.SNAPBACK4_BIN??=fileURLToPath(new URL('../../../target/debug/snapback4',import.meta.url));
  try {await releaseTransitions({cli,startServe},tmpdir());}
  finally {if(original===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=original;}
});
