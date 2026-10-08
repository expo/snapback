// Controlled schedules and negative controls; no product source edits.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { runFile } from '../../scripts/run-client-tests.mjs';
const directory = 'packages/snapback4/test', out = 'target/ft-client-flakes/state-controls';
mkdirSync(out, { recursive: true });
const copies = [], results = [], selected = process.argv.slice(2);
function replace(source, before, after) {
  if (!source.includes(before)) throw Error(`control no longer matches: ${before}`);
  return source.replace(before, after);
}
async function run(name, source, pattern) {
  if (selected.length && !selected.includes(name)) return;
  const file = `${directory}/.ft-state-${name}-${process.pid}.test.mjs`;
  writeFileSync(file, source); copies.push(file);
  const result = await runFile(file, { nodeArgs: [`--test-name-pattern=${pattern}`],
    onOutput: text => appendFileSync(`${out}/${name}.log`, text) });
  results.push({ name, ...result });
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
}
const residency = readFileSync(`${directory}/residency.test.mjs`, 'utf8');
let held = replace(residency, '  let queryGate = null;', '  let queryGate = null, applyGate; const applyEntered = Promise.withResolvers();');
held = replace(held, 'const answer = await core.call(request);', `if (request.op === "apply" && request.page.watermark === 2 && applyGate) {
  const gate = applyGate; applyGate = null; applyEntered.resolve(); await gate.promise;
} const answer = await core.call(request);`);
held = replace(held, 'return { trace:', 'return { holdApply() { applyGate = Promise.withResolvers(); this.releaseApply = applyGate.resolve; }, applyEntered: applyEntered.promise, trace:');
held = replace(held, '  await f.seed([{ table: "audit", row: { id: "a2"', '  f.holdApply();\n  await f.seed([{ table: "audit", row: { id: "a2"');
held = replace(held, '  // @ref LLP 3000.023#10 — a sync publication', '  await f.applyEntered; f.releaseApply();\n  // @ref LLP 3000.023#10 — a sync publication');
const noBarrier = replace(held, `  await client.sync();
  await until(() => watch.getSnapshot().data?.[0]?.id === "a2" && watch.getSnapshot().fresh === true && !watch.getSnapshot().revalidating,
    "server answer settled after sync", { diagnostics });`, '  // Negative control: disconnect before the held apply has finished.');
const acquisition = readFileSync(`${directory}/acquisition.test.mjs`, 'utf8');
const delayed = replace(acquisition, '        if (path.startsWith("/m/")) posts++;', `        if (path === "/m/add" && mode === "sent-queued") await sleep(6000);
        if (path.startsWith("/m/")) posts++;`);
const defaultWait = replace(delayed,
  'const first = await terminal(await client.mutate({ kind: "mutation", name: "add" }, { body: "sent but not caught up" }, { waitSeconds: 0 }));',
  'const first = await client.mutate({ kind: "mutation", name: "add" }, { body: "sent but not caught up" });');
const missing = replace(acquisition, 'client.onWrite(write => events.push(write)); f.mode("sent-queued");',
  'client.onWrite(write => { if (write.state === "pending") events.push(write); }); f.mode("sent-queued");');
try {
  await Promise.all([
    run('residency-held', held, '^server-class watches run locally'),
    run('residency-no-barrier', noBarrier, '^server-class watches run locally'),
    run('receipt-delayed', delayed, '^W5R2a wasm:'),
    run('receipt-default', defaultWait, '^W5R2a wasm:'),
    run('receipt-no-emission', missing, '^W5R2a wasm:'),
  ]);
} finally { for (const file of copies) unlinkSync(file); }
