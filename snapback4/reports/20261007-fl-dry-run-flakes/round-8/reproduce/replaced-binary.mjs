// Explain the discarded Cargo-overlap batch using only a disposable binary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runFile, fileStallTimeout } from '../../../../scripts/run-client-tests.mjs';
assert.equal(process.platform, 'linux');
const file = `packages/snapback4/test/.fl-r8-replaced-${process.pid}.test.mjs`;
let source = fs.readFileSync('packages/snapback4/test/export-background.test.mjs', 'utf8');
source = source.replace("const binary = fs.realpathSync(new URL('../../../target/debug/snapback4', import.meta.url));", `const binaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sb4-r8-replace-binary-'));
process.once('exit',()=>fs.rmSync(binaryRoot,{recursive:true,force:true}));
const binary=path.join(binaryRoot,'snapback4');
fs.copyFileSync(fs.realpathSync(new URL('../../../target/debug/snapback4',import.meta.url)),binary);`);
const point = '    held=await holdRetention(f);await seedQueuedExports(f);\n    held.child.stdin.end();await held.exited;held=undefined;';
assert.equal(source.split(point).length, 2);
source = source.replace(point, '    held=await holdRetention(f);await seedQueuedExports(f);\n    fs.copyFileSync(binary,binary+".new");fs.renameSync(binary+".new",binary);\n    held.child.stdin.end();await held.exited;held=undefined;');
source = source.replace("'coalesced maintenance queue drained',90000)", "'coalesced maintenance queue drained',9000)");
fs.writeFileSync(file, source);
try {
  let output = '';
  const result = await runFile(file, {
    timeout: fileStallTimeout('export-background.test.mjs'),
    nodeArgs: ['--test-name-pattern=^maintenance crash matrix: publication-committed \\(off, next Expo succeeds\\)$'],
    onOutput: text => { output += text; process.stdout.write(text); },
  });
  assert.equal(result.passed, false); assert.equal(result.counts.fail, 1);
  assert.equal(result.reason, undefined); assert.equal(result.inspectionFailure, undefined);
  assert.equal(result.keeperExit.cleanupAcknowledged, true);
  assert.match(output, /coalesced maintenance queue drained/);
  assert.match(output, /No such file or directory/);
  console.log('REPLACED_BINARY_CONTROL ' + JSON.stringify(result));
} finally { fs.rmSync(file); }
