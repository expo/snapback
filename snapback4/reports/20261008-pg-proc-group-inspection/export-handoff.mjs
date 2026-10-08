import { runFile } from '../../scripts/run-client-tests.mjs';
const file = new URL('../../packages/snapback4/test/export-background.test.mjs', import.meta.url).pathname;
const result = await runFile(file, {
  nodeArgs: ['--test-name-pattern', '^maintenance crash matrix: publication-handoff \\(off, next Expo fails\\)$'],
});
console.log(JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;
