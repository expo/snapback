// LLP 0295 W4 vertical fixture: exercise the generated authority product
// projection from an npm-packed codegen package in both authoring profiles.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-authority-projection-packed-')));
const consumer = join(scratch, 'consumer');
const nodeModules = join(consumer, 'node_modules');
const expoModules = join(nodeModules, '@expo');
const packedPackage = join(expoModules, 'snapback-codegen');
const packedContract = join(expoModules, 'snapback-contract');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? consumer,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(
    result.status,
    options.status ?? 0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function schemaSource(entrypoint, provenance = 'full') {
  return `
import { defineSchema, defineTable, v } from ${JSON.stringify(entrypoint)};
export const events = defineTable({ title: v.string() }).visibility({ kind: 'public-read' });
export const eventMembers = defineTable({
  eventId: v.id('events'), userId: v.principal(), role: v.string(), auditLabel: v.optional(v.string()),
})
  .membership({
    id: 'eventMembers', principal: 'userId', resource: 'eventId', role: 'role',
    roles: ['owner', 'member'], pendingRoles: ['invited'], bootstrapRole: 'owner',
    lastHolder: { protect: 'owner' }, provenance: ${JSON.stringify(provenance)},
    transitions: [
      { op: 'insert', by: ['owner'], target: 'other', to: ['invited'] },
      { op: 'setRole', by: ['self'], target: 'self', from: ['invited'], to: ['member'] },
      { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['member'] },
      { op: 'remove', by: ['owner'], target: 'other', from: ['member', 'invited'] },
    ],
  })
  .authorityProfile({
    name: 'eventMembers', hierarchy: { owner: ['member'], member: [] },
    roster: { visible: ['userId', 'role'] },
    projection: { history: { visible: ['auditLabel'] }, recipients: { ceiling: 1024 } },
  })
  .visibility({ kind: 'owner', field: 'userId' });
export default defineSchema({ events, eventMembers }, { auth: { mode: 'sessions' } });
`;
}

try {
  mkdirSync(packedPackage, { recursive: true });
  const pack = run('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: packageRoot });
  const [{ filename }] = JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[')));
  run('tar', ['-xzf', join(scratch, filename), '-C', packedPackage, '--strip-components=1'], {
    cwd: scratch,
  });
  mkdirSync(packedContract, { recursive: true });
  const contractPack = run('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: join(repoRoot, 'packages', 'snapback-contract'),
  });
  const [{ filename: contractFilename }] = JSON.parse(
    contractPack.stdout.slice(contractPack.stdout.indexOf('[')),
  );
  run('tar', [
    '-xzf', join(scratch, contractFilename), '-C', packedContract, '--strip-components=1',
  ], { cwd: scratch });
  for (const dependency of ['acorn', 'ajv', 'esbuild', 'typescript']) {
    symlinkSync(join(packageRoot, 'node_modules', dependency), join(nodeModules, dependency));
  }
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  writeFileSync(join(consumer, 'generate.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '@expo/snapback-codegen';
for (const profile of ['explicit', 'familiar']) {
  const dir = join(process.cwd(), profile);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const schema = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
  const functions = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const authority = schema.tables.find((table) => table.name === 'eventMembers').authorityProfile;
  assert.equal(authority.projection.historyHorizon.carrier, 'operation-envelope');
  assert.equal(authority.projection.recipients.ceiling, 1024);
  const names = functions.functions.map((fn) => fn.name);
  assert(names.includes('eventMembers.history'));
  assert(names.includes('eventMembers.incarnations'));
  assert(names.includes('eventMembers.list'));
  const history = functions.functions.find((fn) => fn.name === 'eventMembers.history');
  assert.equal(history.resultContract.kind, 'value');
  assert.match(history.runtime.IbexModule.source, /ctx\\.authority/);
}
const negative = await generate(join(process.cwd(), 'negative'));
assert.equal(negative.ok, false);
assert(negative.diagnostics.some((diagnostic) => diagnostic.code === 'SNAPBACK_AUTHORITY_PROJECTION_FULL_PROVENANCE_REQUIRED'));
`);

  mkdirSync(join(consumer, 'explicit'));
  writeFileSync(
    join(consumer, 'explicit', 'schema.mjs'),
    schemaSource('@expo/snapback-codegen/define'),
  );
  writeFileSync(join(consumer, 'explicit', 'functions.mjs'), 'export {};\n');
  mkdirSync(join(consumer, 'familiar'));
  writeFileSync(join(consumer, 'familiar', 'schema.ts'), schemaSource('./generated/server'));
  writeFileSync(join(consumer, 'familiar', 'codegen.policy.json'), `${JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: ['normalized-definition.v1.json'],
    authoringProfile: 'snapback-familiar-ts-v1',
  }, null, 2)}\n`);
  mkdirSync(join(consumer, 'negative'));
  writeFileSync(
    join(consumer, 'negative', 'schema.mjs'),
    schemaSource('@expo/snapback-codegen/define', 'creation'),
  );
  writeFileSync(join(consumer, 'negative', 'functions.mjs'), 'export {};\n');
  run(process.execPath, ['generate.mjs']);

  writeFileSync(join(consumer, 'types.ts'), `
import type {
  AuthorityHistoryPageV1,
  FunctionResult,
  GeneratedApi,
  GeneratedAuthority,
  GeneratedMutationAuthority,
  Id,
} from './explicit/generated/api';
type History = FunctionResult<GeneratedApi['eventMembers.history']>;
declare const history: History;
history satisfies AuthorityHistoryPageV1<History['rows'][number]>;
history.cursor satisfies string | null;
history.horizon.earliestCoveredCommit satisfies number;
history.horizon.coverageClass satisfies 'full' | 'authorization-facts-only';
declare const authority: GeneratedAuthority;
declare const mutationAuthority: GeneratedMutationAuthority;
declare const eventId: Id<'events'>;
// @ts-expect-error recipient capture is a sending-mutation transaction helper
authority.eventMembers.snapshotRecipients(eventId);
mutationAuthority.eventMembers.snapshotRecipients(eventId) satisfies Promise<readonly string[]>;
async function clientNullability() {
  const next = await authority.eventMembers.history(eventId, history.cursor === null
    ? undefined
    : { after: history.cursor, limit: 50 });
  next.cursor satisfies string | null;
  return next;
}
void clientNullability;
`);
  run(join(repoRoot, 'node_modules', '.bin', 'tsc'), [
    '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', 'types.ts',
  ]);
  console.log('authority-projection-packed.test.mjs: packed Explicit/Familiar/runtime/type contract passes');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
