// Paired real-host ordinary-live controls; source baseline is transpiled from HEAD.
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import ts from '../../node_modules/typescript/lib/typescript.js';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const baselineCommit = 'b9624729aaa5c5d3ed380c247f415e7dc8d56f81';
const sidecars = [];
for (const name of ['local', 'local-query']) {
  const source = execFileSync('git', ['show', `${baselineCommit}:snapback4/packages/snapback4/src/${name}.ts`], { encoding: 'utf8' })
    .replace('"./local-query.ts"', '"./local-query-rh-baseline.ts"');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true } }).outputText;
  const file = new URL(`../../packages/snapback4/dist/${name}-rh-baseline.js`, import.meta.url);
  writeFileSync(file, output); sidecars.push(file);
}
after(() => { for (const file of sidecars) unlinkSync(file); });
const { createLocalClient: baseline } = await import('../../packages/snapback4/dist/local-rh-baseline.js');
import { createLocalClient as fixed } from '../../packages/snapback4/dist/local.js';
import { fixture, source, opener, q, until } from '../../packages/snapback4/test/helpers/answers-stay.mjs';
const rows = [];
const runs = Number(process.env.RH_RUNS ?? 100);
const output = process.env.RH_REVERSE ? './latency-reverse.json' : './latency.json';
const program = source.replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room] last 1 by byRoom\ntable profiles:')
  .replace("return messages['room'] first 100", "return messages['room'] last 100")
  .replace('table profiles:\n  name: text\n  read <- allow', 'table profiles:\n  name: text\n  read <- allow\n  update <- allow') + `
mutation editProfile(name: text): server
  update profiles['bob'] { name }
`;
for (const host of ['wasm', 'process']) for (const mode of ['known-local', 'server-only-source', 'current-history-fallback']) {
  test(`${host} ${mode}: ${runs} paired mutations`, async t => {
    const f = await fixture(t, program);
    assert.equal((await f.post('/seed', [{ table: 'messages', row: { id: 'older', room: 'room', body: 'older', at: 0 } }])).seeded, 1);
    const readers = [];
    const name = mode === 'known-local' ? 'item' : mode === 'server-only-source' ? 'profile' : 'history';
    const factories = host === 'wasm' ? [['baseline', baseline], ['fixed', fixed]] : [['fixed', fixed], ['baseline', baseline]];
    if (process.env.RH_REVERSE) factories.reverse();
    for (const [label, open] of factories) {
      const client = await open({ url: f.url, persona: 'bob', waitSeconds: 1, device: opener(host, join(f.dir, `${host}-${label}`)) });
      t.after(() => client.close()); await client.sync();
      const watch = client.observe(q(name), name === 'history' ? { c: null } : {});
      t.after(() => watch.close());
      let expected, done, started;
      const samples = [];
      const value = read => name === 'history' ? read.data?.[0]?.body : name === 'profile' ? read.data?.name : read.data?.body;
      watch.subscribe(() => {
        const read = watch.getSnapshot();
        if (done && value(read) === expected && read.complete && !read.revalidating) {
          samples.push(performance.now() - started); const resolve = done; done = undefined; resolve();
        }
      });
      await until(() => watch.getSnapshot().data && watch.getSnapshot().complete, 'initial ordinary answer');
      readers.push({ client, label, samples, arm(value, at) { expected = value; started = at; return new Promise(resolve => { done = resolve; }); } });
    }
    for (let index = 0; index < runs + 10; index++) {
      // Keep each trial's initial partition current; both clients see the same
      // next commit, network path and host load. Ten warm-up trials are dropped.
      await Promise.all(readers.map(r => r.client.sync()));
      const value = `value-${index}`, started = performance.now();
      const deliveries = readers.map(r => r.arm(value, started));
      const mutation = name === 'profile' ? 'editProfile' : 'edit';
      const reply = await f.post(`/m/${mutation}`, { id: `${mode}-${index}`, args: name === 'profile' ? { name: value } : { body: value } });
      assert.equal(reply.state, 'sent');
      await Promise.all(deliveries);
    }
    for (const reader of readers) {
      const samples = reader.samples.slice(10), sorted = [...samples].sort((a,b) => a-b);
      const row = { host, mode, label: reader.label, n: samples.length, p50: sorted[Math.ceil(samples.length*.5)-1], p95: sorted[Math.ceil(samples.length*.95)-1], max: sorted.at(-1), samples };
      rows.push(row); console.log(JSON.stringify({ ...row, samples: undefined }));
    }
    writeFileSync(new URL(output, import.meta.url), JSON.stringify(rows, null, 2)+'\n');
  });
}
