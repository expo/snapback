// Test-only load hook: keep merged source/binary, substitute only round 3's transport.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const target = new URL('../../../packages/snapback4/dist/node-fetch.js', import.meta.url).href;
const source = readFileSync(new URL('./round3-node-fetch.js', import.meta.url), 'utf8');
registerHooks({
  load(url, context, nextLoad) {
    return url === target ? { format: 'module', source, shortCircuit: true } : nextLoad(url, context);
  },
});
