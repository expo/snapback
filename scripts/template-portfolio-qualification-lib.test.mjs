import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertTemplateScriptSurface,
  discoverRegisteredTemplates,
  qualifyOneTemplate,
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

test('template qualification runs generate, static acceptance, and prove in order', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-template-qualification-unit-'));
  const calls = [];
  try {
    const result = qualifyOneTemplate({
      name: 'stub-template',
      cli: '/stub/snapback',
      mode: 'registry',
      registry: 'https://registry.npmjs.org',
      tarballs: null,
      temporary,
      runCommand(command, args) {
        calls.push({ command, args: [...args] });
        if (args[0] === 'new') {
          mkdirSync(args[1], { recursive: true });
          writeFileSync(
            join(args[1], 'package.json'),
            `${JSON.stringify({ name: 'stub-template', version: '1.0.0' }, null, 2)}\n`,
          );
        }
      },
    });

    assert.equal(result.status, 'passed');
    assert.equal(result.proof, true);
    assert.deepEqual(
      calls.flatMap(({ command, args }) => {
        if (args[0] === 'generate') return ['generate'];
        if (command === 'npm' && args[0] === 'run' && args[1] === 'test:static') {
          return ['test:static'];
        }
        if (command === 'npm' && args[0] === 'run' && args[1] === 'prove') return ['prove'];
        return [];
      }),
      ['generate', 'test:static', 'prove'],
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('template qualification does not forward source-checkout package authority overrides', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-template-qualification-env-unit-'));
  const calls = [];
  try {
    const result = qualifyOneTemplate({
      name: 'stub-template',
      cli: '/stub/snapback',
      mode: 'registry',
      registry: 'https://registry.npmjs.org',
      tarballs: null,
      temporary,
      environment: {
        PATH: '/qualification/bin',
        SNAPBACK_RUNTIME_BINARY: '/source/target/release/snapback',
        SNAPBACK_SERVER_BINARY: '/source/target/debug/snapback',
        SNAPBACK_BINARY: '/source/target/debug/snapback',
        SNAPBACK_APP_BOUND_SERVER_BINARY: '/source/app-bound/snapback',
        SNAPBACK_ADMIN_DIST: '/source/admin-ui/dist',
        SNAPBACK_IBEX_CHECKOUT: '/source/vendor/ibex',
        SNAPBACK_IBEX_HERMES_FRAMEWORK: '/source/hermesvm.framework',
        SNAPBACK_PREPARED_RUNTIME_BINARY: '/source/prepared/snapback',
        SNAPBACK_RUNTIME_SOURCE_BINARY: '/source/runtime/snapback',
        SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY: '/source/runtime-linux/snapback',
        SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT: '/source/receipt.json',
        SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS: '1',
        DYLD_FRAMEWORK_PATH: '/source/frameworks',
        LD_LIBRARY_PATH: '/source/lib',
      },
      runCommand(command, args, options) {
        calls.push({ command, args: [...args], env: { ...options.env } });
        if (args[0] === 'new') {
          mkdirSync(args[1], { recursive: true });
          writeFileSync(
            join(args[1], 'package.json'),
            `${JSON.stringify({ name: 'stub-template', version: '1.0.0' }, null, 2)}\n`,
          );
        }
      },
    });

    assert.equal(result.status, 'passed');
    const prove = calls.find(({ command, args }) => (
      command === 'npm' && args[0] === 'run' && args[1] === 'prove'
    ));
    assert.ok(prove);
    assert.equal(prove.env.PATH, '/qualification/bin');
    assert.equal(prove.env.CI, '1');
    assert.equal(
      Object.keys(prove.env).some((key) => key.startsWith('SNAPBACK_')),
      false,
    );
    assert.equal(Object.hasOwn(prove.env, 'DYLD_FRAMEWORK_PATH'), false);
    assert.equal(Object.hasOwn(prove.env, 'LD_LIBRARY_PATH'), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
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
