import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const cli = join(packageRoot, 'cli.mjs');
const codegenCli = join(packageRoot, '..', 'snapback-codegen', 'index.mjs');
const defineUrl = pathToFileURL(join(packageRoot, '..', 'snapback-codegen', 'define.mjs')).href;
const campfireRoot = join(packageRoot, '..', '..', 'demos', 'campfire', 'snapback');
const root = mkdtempSync(join(tmpdir(), 'snapback-cli-generate-check-'));
const migrationCode = 'SNAPBACK_TABLE_WRITE_POSTURE_MIGRATION_PENDING';

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function digest(directory) {
  const hash = createHash('sha256');
  const visit = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path, relative);
      else hash.update(relative).update(readFileSync(path));
    }
  };
  visit(directory);
  return hash.digest('hex');
}

test('packaged generate --check runs the full preflight without replacing artifacts', () => {
  try {
    writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
    writeFileSync(join(root, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: {} });
`);
    const generated = spawnSync(process.execPath, [cli, 'generate', root, '--json'], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const before = digest(join(root, 'generated'));
    const envelopeBefore = digest(join(root, '.snapback', 'generations'));
    const checked = spawnSync(process.execPath, [cli, 'generate', root, '--check', '--json'], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.ok, true);
    assert.equal(result.check, true);
    assert.equal(result.checked, true);
    assert.equal(result.emitted, false);
    assert.equal(digest(join(root, 'generated')), before);
    assert.equal(
      digest(join(root, '.snapback', 'generations')),
      envelopeBefore,
      '--check changed immutable generation envelopes or latest-emitted metadata',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged generate --check preserves the same-file helper-cycle refusal', () => {
  const refusalRoot = mkdtempSync(join(tmpdir(), 'snapback-cli-generate-check-refusal-'));
  try {
    writeFileSync(join(refusalRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
    writeFileSync(join(refusalRoot, 'functions.mjs'), `
import { defineJsQuery } from '${defineUrl}';
function ping() { return pong(); }
function pong() { return ping(); }
export const listTodos = defineJsQuery({
  args: {}, reads: ['todos'], handler: async () => ping(),
});
`);
    const checked = spawnSync(
      process.execPath,
      [cli, 'generate', refusalRoot, '--check', '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.ok, false);
    assert(result.diagnostics.some(
      ({ code }) => code === 'SNAPBACK_INLINE_HELPER_CYCLE',
    ));
    assert.equal(existsSync(join(refusalRoot, 'generated')), false);
    assert.equal(existsSync(join(refusalRoot, '.snapback', 'generations')), false);
  } finally {
    rmSync(refusalRoot, { recursive: true, force: true });
  }
});

test('human generate CLIs group migration advisories while JSON retains each finding', () => {
  const codegenHuman = spawnSync(
    process.execPath,
    [codegenCli, campfireRoot, '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(codegenHuman.status, 0, codegenHuman.stderr || codegenHuman.stdout);
  assert.equal(occurrences(codegenHuman.stderr, migrationCode), 0);
  assert.equal(
    occurrences(codegenHuman.stdout, 'migration declare-explicit-write-authority:'),
    1,
  );

  const codegenJson = spawnSync(
    process.execPath,
    [codegenCli, campfireRoot, '--check', '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(codegenJson.status, codegenHuman.status, codegenJson.stderr || codegenJson.stdout);
  assert.equal(occurrences(codegenJson.stderr, migrationCode), 0);
  const result = JSON.parse(codegenJson.stdout);
  assert.equal(result.diagnostics.filter(({ code }) => code === migrationCode).length, 3);
  assert.equal(result.summary.migrationAdvisories.length, 1);
  assert.equal(
    result.authorizationReview.writePolicyChecks.filter(
      ({ genericWriteDisposition }) => genericWriteDisposition === 'migration-pending',
    ).length,
    3,
  );

  const snapbackHuman = spawnSync(
    process.execPath,
    [cli, 'generate', campfireRoot, '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(snapbackHuman.status, codegenHuman.status, snapbackHuman.stderr || snapbackHuman.stdout);
  assert.equal(occurrences(snapbackHuman.stderr, migrationCode), 0);
  assert.equal(
    occurrences(snapbackHuman.stdout, 'migration declare-explicit-write-authority:'),
    1,
  );
});
