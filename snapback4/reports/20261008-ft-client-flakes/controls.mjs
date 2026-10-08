// Disposable, test-only mutations. Run from snapback4; product files stay fixed.
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runFile } from '../../scripts/run-client-tests.mjs';
const out = resolve('target/ft-client-flakes/controls');
mkdirSync(out, { recursive: true });
const dir = 'packages/snapback4/test';
const copies = [], results = [];
async function run(name, original, transform, nodeArgs = [], env = {}) {
  const file = `${dir}/.ft-${name}-${process.pid}.test.mjs`;
  const source = readFileSync(`${dir}/${original}.test.mjs`, 'utf8');
  const changed = transform(source);
  if (source === changed) throw Error(`control ${name} did not match`);
  copies.push(file); writeFileSync(file, changed);
  const result = await runFile(file, { nodeArgs, env,
    onOutput: text => appendFileSync(`${out}/${name}.log`, text) });
  results.push({ name, ...result });
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
}
try {
  await run('session-immediate', 'local-e2e', source => source.replace(
    '    await until(async () => {\n      dead =', '    {\n      dead =').replace(
    '      return dead.denied?.code === "E_AUTH";\n    }).catch(() => {});', '    }'),
    ['--test-name-pattern=a device restores its session on its own']);
  await run('react-no-storage', 'react', source => source.replace('        enforce: "pre",', `        enforce: "pre",
        transform(code, id) {
          if (id.endsWith('/src/journal-changes.ts')) return code.replace('window.addEventListener?.("storage", storageChanged)', 'void storageChanged');
        },`));
  await run('follow-no-drain', 'delivery-fault-matrix', source => source.replace(
    'while (pending()) { quiesced++; try { await pending(); } catch {} }', '/* control: join the competitor instead of owning the faulting I/O */'),
    ['--test-name-pattern=every delivery await|competing sync/install: 48 transient'], { RG_MATRIX_SITE: '48', RG_MATRIX_MODE: 'transient' });
} finally {
  for (const file of copies) unlinkSync(file);
}
