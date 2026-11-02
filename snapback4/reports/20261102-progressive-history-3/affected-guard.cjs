// Keep the mandated affected invocation within this chunk's filesystem fence
// and its once-only wasm build / excluded-browser instructions. No step is
// reported successful by this guard. The standalone final build is logged.
const fs = require('node:fs');
const path = require('node:path');
const sb = path.resolve(__dirname, '../..');
const source = path.resolve(sb, '../target/affected');
const destination = path.join(sb, 'target/affected');
const remap = value => typeof value === 'string' && (value === source || value.startsWith(source + path.sep))
  ? destination + value.slice(source.length) : value;
for (const name of ['mkdirSync', 'writeFileSync']) {
  const original = fs[name];
  fs[name] = function(file, ...args) { return original.call(this, remap(file), ...args); };
}
const cp = require('node:child_process');
const spawn = cp.spawn;
cp.spawn = function(command, args, options) {
  if (args?.includes('scripts/build-wasm.sh')) {
    console.error('STOP: affected build-wasm not run; final standalone wasm build runs once. Browser suites not run (sandbox); affected run incomplete.');
    process.exit(125);
  }
  return spawn.call(this, command, args, options);
};
require('node:module').syncBuiltinESMExports();
