import { appendFileSync, writeFileSync } from 'node:fs';
import { runFile } from '../../../scripts/run-client-tests.mjs';
const rows = [];
for (let run = 1; run <= 3; run++) {
  const result = await runFile('packages/snapback4/test/per-row-react.test.mjs', {
    nodeArgs: ['--import', new URL('./inject-reload.mjs', import.meta.url).href, '--test-name-pattern', '^1,000 per-row'],
    onOutput: text => appendFileSync(new URL(`./review-reload-${run}.log`, import.meta.url), text),
  });
  rows.push({ run, ...result });
}
writeFileSync(new URL('./review-control.json', import.meta.url), JSON.stringify(rows, null, 2));
console.log(rows.map(({ run, code, passed, reason, counts }) => ({ run, code, passed, reason, counts })));
