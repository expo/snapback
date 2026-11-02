// The supervisor explicitly withdrew/rejected another wasm build in this chunk.
// Keep the required runner invocation honest: stop before its forbidden step;
// do not turn that step into a success or execute later browser suites.
const childProcess = require('node:child_process');
const spawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  if (args?.includes('scripts/build-wasm.sh')) {
    console.error('STOP: build-wasm not run (supervisor amendment); affected run incomplete.');
    process.exit(125);
  }
  return spawn.call(this, command, args, options);
};
require('node:module').syncBuiltinESMExports();
