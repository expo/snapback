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
  assert.deepEqual(answers.get('crud-dashboard'), {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: 'bun run carry:web-browser',
    simulatorObservation: null,
  });
  assert.deepEqual(answers.get('media-feed'), {
    ordinaryCompletion: 'bun run prove',
    staticChecking: 'bun run test:static',
    rawAcceptanceDebugging: 'npm test',
    browserObservation: 'bun run carry:web-browser',
    simulatorObservation: 'bun run carry:native-simulator',
  });
  const todo = fixture('todo-contract');
  assert.match(todo.readme, /Migration: `test:live` was removed/u);
  assert.doesNotMatch(todo.instructions, /Migration: `test:live` was removed/u);

  for (const name of ['react', 'crud-dashboard']) {
    const template = fixture(name);
    assert.equal(template.manifest.devDependencies['@types/node'], '^25.0.0');
    const tsconfig = JSON.parse(readFileSync(resolve(CLI_ROOT, 'templates', name, 'tsconfig.json'), 'utf8'));
    assert.deepEqual(tsconfig.compilerOptions.types, ['node']);
    assert.deepEqual(tsconfig.compilerOptions.lib, ['ESNext', 'DOM', 'DOM.Iterable']);
    assert.match(
      readFileSync(resolve(CLI_ROOT, 'templates', name, 'src', 'snapback-dev.d.ts'), 'utf8'),
      /<reference types="vite\/client" \/>/u,
    );
  }
  assert.match(
    readFileSync(resolve(CLI_ROOT, 'templates', 'crud-dashboard', 'acceptance.mjs'), 'utf8'),
    /adminClient\.liveQuery\(api\.projectDetail/u,
  );
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
  const compact = fixture('crud-dashboard');
  assert.throws(
    () => assertTemplateScriptSurface({
      ...compact,
      instructions: compact.instructions.replace('`carry:*`', '`carriers`'),
    }),
    /crud-dashboard start packet script glossary omits carry:headless/u,
  );
  const shortened = fixture('expo-chat');
  assert.throws(
    () => assertTemplateScriptSurface({
      ...shortened,
      instructions: shortened.instructions.replace('carry:native-simulator', 'native carrier'),
    }),
    /expo-chat start packet script glossary omits carry:native-simulator/u,
  );
});
