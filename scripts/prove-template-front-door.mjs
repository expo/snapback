import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateApp, scaffoldApp } from '../packages/snapback-cli/index.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templates = ['react', 'crud-dashboard', 'media-feed', 'todo-contract', 'expo-chat'];
const temporaryRoot = mkdtempSync(join(tmpdir(), 'snapback-template-front-door-'));

try {
  const defaultProject = join(temporaryRoot, 'default-template');
  const scaffolded = scaffoldApp(defaultProject);
  assert.equal(scaffolded.ok, true);
  assert.equal(scaffolded.template, 'todo-contract');
  console.log(`default scaffoldApp: ok (template=${scaffolded.template})`);

  const generatedDefault = await generateApp(join(defaultProject, 'snapback'));
  assert.equal(generatedDefault.ok, true, JSON.stringify(generatedDefault.diagnostics));
  console.log('default generateApp: ok');

  for (const template of templates) {
    const backend = join(repoRoot, 'packages', 'snapback-cli', 'templates', template, 'snapback');
    const generated = await generateApp(backend);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    console.log(`direct ${template} generateApp: ok`);
  }

  console.log('template front door proof: ok');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
