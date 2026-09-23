import test from 'node:test';
import {recoverTimeline} from '../../../experiments/f3b-deliverability/reproduce.mjs';

test('declared timeline historical overflow: SDK snapshot restart preserves pending writes on WASM and SQLite', {timeout:240000}, async t=>{
  t.diagnostic(JSON.stringify(await recoverTimeline()));
});
