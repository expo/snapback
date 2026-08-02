import {access, readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const protocol = JSON.parse(await readFile(join(root, 'protocol', 'program.v1.json'), 'utf8'));
const rows = [];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

for (const app of protocol.applications) {
  const providers = app.id === 'field-notebook'
    ? ['snapback', 'zero', 'replicache']
    : ['snapback', 'zero'];
  const manifest = JSON.parse(await readFile(
    join(root, 'protocol', 'acceptance', `${app.id}.v1.json`),
    'utf8'
  ));
  for (const provider of providers) {
    const path = join(root, 'apps', app.id, 'evidence', `${provider}.v1.json`);
    if (!(await exists(path))) {
      rows.push({app: app.id, provider, state: 'missing'});
      continue;
    }
    try {
      const receipt = JSON.parse(await readFile(path, 'utf8'));
      const ids = new Set(receipt.results?.map((result) => result.id) ?? []);
      const missingChecks = manifest.checks.filter((id) => !ids.has(id));
      rows.push({
        app: app.id,
        provider,
        state: receipt.ok && missingChecks.length === 0 ? 'complete' : 'incomplete',
        pass: receipt.counts?.pass ?? 0,
        gap: receipt.counts?.gap ?? 0,
        fail: receipt.counts?.fail ?? 0,
        missingChecks
      });
    } catch (error) {
      rows.push({app: app.id, provider, state: 'invalid', error: String(error.message ?? error)});
    }
  }
}

const counts = Object.fromEntries(['complete', 'incomplete', 'missing', 'invalid'].map((state) => [
  state,
  rows.filter((row) => row.state === state).length
]));
const status = {
  schemaVersion: 'snapback.zero-bakeoff.program-status.v1',
  expectedArms: 13,
  counts,
  complete: counts.complete === 13,
  rows
};
process.stdout.write(JSON.stringify(status, null, 2) + '\n');
if (counts.invalid > 0) process.exitCode = 1;
