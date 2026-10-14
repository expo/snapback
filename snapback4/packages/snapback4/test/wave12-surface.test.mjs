import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertChangelogHelp,checkVerbHelp,changelogFlags} from '../../../scripts/check-verb-help.mjs';
import {createClient} from '../dist/client.js';
const binary = process.env.SNAPBACK4_BIN ?? fileURLToPath(new URL('../../../target/debug/snapback4',import.meta.url));
const changelog = readFileSync(new URL('../CHANGELOG.md',import.meta.url),'utf8');
const cli = (...args) => { const result=spawnSync(binary,args,{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout; };

test('publication check catches 0.4.28 deploy --schema omission and covers every announced flag', () => {
  // Use the actual baseline's help source, without changing another checkout.
  const baseline = spawnSync('git',['show','c22dfefc9c:snapback4/crates/snapback4/src/verb_help.rs'],{encoding:'utf8'});
  assert.equal(baseline.status,0,baseline.stderr);
  const deploy = baseline.stdout.match(/"deploy" => "([\s\S]*?)",\n        "rollback"/)[1];
  assert.throws(()=>assertChangelogHelp('- deploy --schema selects saved complete source',()=>deploy), /deploy --help omits announced --schema/);
  assert.throws(()=>assertChangelogHelp('- deploy --unknown-new-flag does something',()=>cli('deploy','--help')), /omits announced --unknown-new-flag/);
  assert.throws(()=>changelogFlags('- --unknown lacks a verb'), /needs an explicit/);
  checkVerbHelp(binary,changelog);
  const help=cli('deploy','--help');assert.match(help,/--schema file.q.*saved complete source; keep it outside snapback\//);
});

test('guide discovery accepts unambiguous names, successful section keywords and quoted/unquoted OR', () => {
  assert.equal(cli('guide','produc'),cli('guide','production'));
  const topic=cli('guide','totals','--section','count');assert.doesNotMatch(topic,/No heading|no section/);assert.match(topic,/count/);
  const quoted=cli('guide','deploy','--find','bearer OR generation');
  const unquoted=cli('guide','deploy','--find','bearer','OR','generation');
  assert.equal(quoted,unquoted);assert.match(quoted,/^\s*\d+: .*bearer/im);assert.match(quoted,/^\s*\d+: .*generation/im);
});

test('bare operation names refuse with generated handle guidance before query/write dispatch', async () => {
  let requests=0;
  const client=createClient({url:'http://127.0.0.1:1',persona:'alice',fetch:async()=>{requests++;throw new Error('unexpected dispatch');}});
  try {
    const query=await client.query('list',{}); assert.equal(query.denied.code,'E_OP');assert.match(query.denied.message,/generated handle \(api.op\)/);
    const write=await client.mutate('add',{});assert.equal(write.state,'failed');assert.equal(write.why.code,'E_OP');assert.match(write.why.message,/generated handle \(api.op\)/);
    // The transport's ordinary background probe may run, but no invalid op is dispatched.
  } finally { await client.close(); }
});
