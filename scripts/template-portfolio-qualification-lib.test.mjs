import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertTemplateScriptSurface,
  discoverRegisteredTemplates,
} from './template-portfolio-qualification-lib.mjs';

const CLI_ROOT = resolve(import.meta.dirname, '../packages/snapback-cli');

function fixture(name) {
  const root = resolve(CLI_ROOT, 'templates', name);
  return {
    name,
    manifest: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
    readme: readFileSync(resolve(root, 'README.md'), 'utf8'),
    instructions: readFileSync(resolve(root, 'AGENTS.md'), 'utf8'),
  };
}

test('every registered template exposes a manifest-derived cold-agent glossary', () => {
  const answers = new Map();
  for (const name of discoverRegisteredTemplates(CLI_ROOT)) {
    answers.set(name, assertTemplateScriptSurface(fixture(name)).commands);
  }
  assert.deepEqual(answers.get('expo-chat'), {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: 'bun run carry:web-browser',
    simulatorObservation: 'bun run carry:native-simulator',
  });
  assert.deepEqual(answers.get('todo-contract'), {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: null,
    simulatorObservation: null,
  });
  const todo = fixture('todo-contract');
  assert.match(todo.readme, /Migration: `test:live` was removed/u);
  assert.doesNotMatch(todo.instructions, /Migration: `test:live` was removed/u);
});

test('missing scripts, changed command classes, and documentation drift fail closed', () => {
  const current = fixture('react');
  assert.throws(
    () => assertTemplateScriptSurface({
      ...current,
      manifest: { ...current.manifest, scripts: { ...current.manifest.scripts, 'test:static': undefined } },
    }),
    /react omits test:static/u,
  );
  assert.throws(
    () => assertTemplateScriptSurface({
      ...current,
      manifest: { ...current.manifest, scripts: { ...current.manifest.scripts, test: 'node different-suite.mjs' } },
    }),
    /react changes test command class/u,
  );
  assert.throws(
    () => assertTemplateScriptSurface({
      ...current,
      manifest: {
        ...current.manifest,
        scripts: { ...current.manifest.scripts, 'carry:web-browser': undefined },
      },
    }),
    /react README script glossary disagrees with package.json/u,
  );
  assert.throws(
    () => assertTemplateScriptSurface({
      ...current,
      readme: current.readme.replace('raw acceptance implementation', 'raw runtime check'),
    }),
    /react README script glossary disagrees with package.json/u,
  );
});
