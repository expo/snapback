// A4 arm repro: the module-form action catch-22 on packaged 0.1.7.
// (1) a js:{source, exportName} action whose handlers file uses ANY export
//     form refuses generation with BUNDLE_UNSUPPORTED_EXPORT;
// (2) stripping the export passes generation but the server then fails to
//     load the handler: SNAPBACK_HANDLER_EXPORT_MISSING (dev exits before
//     ready, SNAPBACK_DEV_SERVER_START_FAILED).
// The probe swaps the live sources in place and restores them afterwards.
import { spawnSync, spawn } from 'node:child_process';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const fn = join(root, 'snapback', 'functions.mjs');
const handlers = join(root, 'snapback', 'handlers-probe.mjs');
const backup = join(root, 'snapback', 'functions.mjs.probe-backup');
const out = { probes: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const moduleFormAction = `
export const probeModuleAction = defineAction({
  args: {},
  js: { source: 'handlers-probe.mjs', exportName: 'probeModuleAction' },
  result: results.value(v.object({ ok: v.boolean() })),
  writes: [],
});
`;

function generate() {
  const res = spawnSync(join(root, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1' },
  });
  return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

copyFileSync(fn, backup);
try {
  // (1) export form refused at generation
  writeFileSync(handlers, 'export async function probeModuleAction(ctx, args) { return { ok: true }; }\n');
  writeFileSync(fn, readFileSync(backup, 'utf8') + moduleFormAction);
  const gen1 = generate();
  out.probes.push({
    name: 'module-form with export',
    generateStatus: gen1.status,
    diagnostic: (gen1.output.match(/BUNDLE_UNSUPPORTED_EXPORT[^"]*/) ?? [null])[0],
    excerpt: gen1.output.slice(-400),
  });

  // (2) export-free form generates but cannot load
  writeFileSync(handlers, 'async function probeModuleAction(ctx, args) { return { ok: true }; }\n');
  const gen2 = generate();
  out.probes.push({ name: 'module-form without export: generation', generateStatus: gen2.status });
  if (gen2.status === 0) {
    rmSync(join(root, '.snapback', 'dev.sqlite3'), { force: true });
    const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    const deadline = Date.now() + 30_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(200);
    if (child.exitCode === null) child.kill('SIGTERM');
    out.probes.push({
      name: 'module-form without export: server load',
      devExitCode: child.exitCode,
      exportMissing: stderr.includes('SNAPBACK_HANDLER_EXPORT_MISSING'),
      startFailed: stderr.includes('SNAPBACK_DEV_SERVER_START_FAILED'),
      stderrExcerpt: stderr.slice(0, 500),
    });
  }
} finally {
  copyFileSync(backup, fn);
  rmSync(backup, { force: true });
  rmSync(handlers, { force: true });
  const restore = generate();
  out.restored = restore.status === 0;
}
writeFileSync(join(root, 'a4-evidence', 'probe-action-forms.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
