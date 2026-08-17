import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const temporary = mkdtempSync(join(packageRoot, '.remote-service-test-'));
const backend = join(temporary, 'remote-test', 'snapback');
mkdirSync(backend, { recursive: true });

try {
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineMutation, insert, returnBinding, v } from '${defineUrl}';
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title') }, { bindIdAs: 'todoId' }),
  returns: returnBinding('todoId'),
});
`);
  writeFileSync(join(backend, 'remote-service.publication.json'), JSON.stringify({
    profileId: 'remote-service-sqlite-ibex',
    targetProfileId: 'remote-service-sqlite-ibex',
    authCapabilityId: 'snapback.auth.remote-test',
    dataCapabilityId: 'snapback.data.remote-test',
    operations: ['createTodo'],
  }));

  const result = await generate(backend, { targetProfile: 'remote-service-sqlite-ibex' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const output = join(backend, 'generated-remote-service');
  const profile = JSON.parse(readFileSync(join(output, 'remote-service.profile.json'), 'utf8'));
  const auth = JSON.parse(readFileSync(join(output, 'remote-auth-capability.manifest.json'), 'utf8'));
  const data = JSON.parse(readFileSync(join(output, 'remote-data-capability.manifest.json'), 'utf8'));
  assert.equal(profile.targetProfileId, 'remote-service-sqlite-ibex');
  assert.equal(profile.localServerLifecycle, false);
  assert.deepEqual(profile.endpointPolicy, {
    allowAmbientProxy: false,
    allowRedirects: false,
    authority: 'host-private',
    scheme: 'https',
    valueInArguments: false,
    valueInArtifacts: false,
    valueInEnvironment: false,
    valueInInfoPlist: false,
  });
  assert.equal(auth.credentialPolicy.authority, 'host-private');
  assert.equal(auth.credentialPolicy.supportsRotation, true);
  assert.deepEqual(data.operations.map((operation) => operation.functionId), ['remote-test:createTodo']);
  assert.equal(data.operations[0].argumentsSchema.path.endsWith('/operations/createTodo.args.schema.json'), true);
  assert.equal(Object.keys(data.wireSchemas).length, 14);
  assert(profile.dataTier.caseCount >= 29);

  const invalid = await generate(backend, { targetProfile: 'unpublished-target' });
  assert.equal(invalid.ok, false);
  assert(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_TARGET_PROFILE_UNSUPPORTED'));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('remote-service-publication.test.mjs: all cases passed');
