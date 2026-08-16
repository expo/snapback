import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { enumerateAppDescriptorV1 } from './app-inspection.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const root = mkdtempSync(join(tmpdir(), 'snapback-app-inspection-'));
const backend = join(root, 'fixture', 'snapback');
mkdirSync(backend, { recursive: true });

try {
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ room: v.string(), body: v.string() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, bind, defineAssetUpload, defineCommand, defineMutation, defineSurface, input, insert, param, v } from '${defineUrl}';
export const imageUpload = defineAssetUpload({
  auth: 'authenticated',
  accept: { mediaTypes: ['application/octet-stream'], maxBytes: 1000 },
  delivery: { kind: 'private-strict' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
export const save = defineMutation({
  args: { room: v.string(), body: v.string(), image: v.optional(v.assetRef({ upload: 'imageUpload' })) },
  plan: insert('items', { room: arg('room'), body: arg('body') }),
});
export const send = defineCommand({ mutation: save, assets: {
  image: { intent: imageUpload, optional: true, mutationArg: 'image' },
} });
export const room = defineSurface({
  params: { room: v.string() },
  commands: { send: bind(send, { room: param('room'), body: input('body'), image: input('image') }) },
});
`);
  const result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  // @ref LLP 0179#inspection-and-other-consumers — enumeration starts from
  // parsed disk JSON, without importing the generated binding or evaluating
  // the application definition and handler modules it describes.
  const descriptor = JSON.parse(readFileSync(
    join(backend, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const inspection = enumerateAppDescriptorV1(descriptor);
  assert.deepEqual(inspection.capabilities.required, descriptor.capabilities.required);
  assert.deepEqual(Object.keys(inspection.api), [
    'queries', 'mutations', 'assets', 'ephemeral', 'queryGroups',
  ]);
  assert.deepEqual(inspection.api.mutations.map(({ name }) => name), ['save']);
  assert.deepEqual(inspection.api.assets.map(({ name }) => name), ['imageUpload']);

  const command = inspection.commands.find(({ name }) => name === 'send');
  assert(command);
  assert.deepEqual(Object.keys(command), [
    'name', 'kind', 'mutation', 'asset', 'passthroughArgs', 'requiredCapabilities',
  ]);
  assert.equal(command.kind, 'asset-bearing-command.v1');
  assert.equal(command.mutation.name, 'save');
  assert.equal(command.mutation.id, descriptor.commands.send.mutation.id);
  assert.equal(command.mutation.kind, 'Mutation');
  assert.equal(command.asset?.input, 'image');
  assert.equal(command.asset?.mutationArg, 'image');
  assert.equal(command.asset?.optional, true);
  assert.equal(command.asset?.intent.name, 'imageUpload');
  assert.deepEqual(command.passthroughArgs, ['room', 'body']);
  assert.deepEqual(command.requiredCapabilities, []);
  assert.equal(Object.hasOwn(command, 'id'), false);
  assert.equal(Object.hasOwn(command, 'sourceSpan'), false);
  assert.equal(Object.hasOwn(command, 'inputs'), false);

  // The optional image plus the body passthrough is the descriptor's admitted
  // text-only branch: callers can omit the asset and invoke the same mutation.
  assert.equal(command.asset.optional, true);
  assert(command.passthroughArgs.includes('body'));

  const surface = inspection.surfaces.find(({ name }) => name === 'room');
  const member = surface?.members.commands.find(({ name }) => name === 'send');
  assert(member);
  assert.equal(member.reference.kind, 'asset-bearing-command.v1');
  assert.equal(member.reference.name, 'send');
  assert.equal(Object.hasOwn(member.reference, 'id'), false);
  assert.deepEqual(member.bindings, descriptor.surfaces.room.commands.send.bindings);
  assert.deepEqual(member.inputs, descriptor.surfaces.room.commands.send.inputs);
  assert.deepEqual(member.reference.passthroughArgs, ['room', 'body']);
  assert.equal(member.reference.asset?.input, 'image');
  assert.deepEqual(member.requiredCapabilities, []);

  const capabilityDescriptor = structuredClone(descriptor);
  const mutationRequirements = ['mutation_read_set_validation', 'args_contract_v1'];
  const assetRequirements = ['asset_lifecycle_v1', 'args_contract_v1'];
  capabilityDescriptor.api.mutations.save.requiredCapabilities = mutationRequirements;
  capabilityDescriptor.api.assets.imageUpload.requiredCapabilities = assetRequirements;
  capabilityDescriptor.commands.send.mutation.requiredCapabilities = mutationRequirements;
  capabilityDescriptor.commands.send.asset.intent.requiredCapabilities = assetRequirements;
  const inlineSurfaceCommand = capabilityDescriptor.surfaces.room.commands.send.reference;
  inlineSurfaceCommand.mutation.requiredCapabilities = mutationRequirements;
  inlineSurfaceCommand.asset.intent.requiredCapabilities = assetRequirements;

  const capabilityInspection = enumerateAppDescriptorV1(capabilityDescriptor);
  const capabilityCommand = capabilityInspection.commands.find(({ name }) => name === 'send');
  const capabilityMember = capabilityInspection.surfaces
    .find(({ name }) => name === 'room')
    ?.members.commands.find(({ name }) => name === 'send');
  assert(capabilityCommand);
  assert(capabilityMember);
  assert.deepEqual(capabilityCommand.requiredCapabilities, [
    'args_contract_v1', 'asset_lifecycle_v1', 'mutation_read_set_validation',
  ]);
  assert.deepEqual(capabilityMember.requiredCapabilities, capabilityCommand.requiredCapabilities);
  assert.deepEqual(
    capabilityCommand.mutation.requiredCapabilities,
    capabilityInspection.api.mutations.find(({ name }) => name === 'save')?.requiredCapabilities,
  );
  assert.deepEqual(
    capabilityCommand.asset?.intent.requiredCapabilities,
    capabilityInspection.api.assets.find(({ name }) => name === 'imageUpload')?.requiredCapabilities,
  );

  capabilityDescriptor.api.mutations.save.requiredCapabilities = ['api-copy-diverged'];
  capabilityDescriptor.api.assets.imageUpload.requiredCapabilities = ['api-copy-diverged'];
  const inlineAuthorityInspection = enumerateAppDescriptorV1(capabilityDescriptor);
  assert.deepEqual(
    inlineAuthorityInspection.commands.find(({ name }) => name === 'send')?.requiredCapabilities,
    ['args_contract_v1', 'asset_lifecycle_v1', 'mutation_read_set_validation'],
  );
  assert.deepEqual(
    inlineAuthorityInspection.surfaces
      .find(({ name }) => name === 'room')
      ?.members.commands.find(({ name }) => name === 'send')?.requiredCapabilities,
    ['args_contract_v1', 'asset_lifecycle_v1', 'mutation_read_set_validation'],
  );

  const descriptorBeforeOutputMutation = structuredClone(descriptor);
  inspection.identity.app = 'mutated-output';
  inspection.capabilities.required.push('mutated-output');
  command.passthroughArgs.push('mutated-output');
  command.asset.intent.requiredCapabilities.push('mutated-output');
  member.bindings.room.name = 'mutated-output';
  member.inputs.body.optional = true;
  surface.params.room.kind = 'mutated-output';
  assert.deepEqual(descriptor, descriptorBeforeOutputMutation);

  const fixtureDescriptor = JSON.parse(readFileSync(join(
    repoRoot,
    'packages',
    'snapback-react',
    'fixtures',
    'conversation',
    'app',
    'snapback',
    'generated',
    'app.descriptor.json',
  ), 'utf8'));
  const fixtureInspection = enumerateAppDescriptorV1(fixtureDescriptor);
  const fixtureCommand = fixtureInspection.commands.find(({ name }) => name === 'send');
  const fixtureSurface = fixtureInspection.surfaces.find(({ name }) => name === 'conversation');
  assert(fixtureCommand);
  assert.equal(fixtureCommand.asset?.input, 'image');
  assert.equal(fixtureCommand.asset?.mutationArg, 'image');
  assert(fixtureSurface?.members.commands.some(({ name }) => name === 'send'));

  const mediaDescriptor = JSON.parse(readFileSync(join(
    repoRoot,
    'tests',
    'acceptance',
    'fixtures',
    'media-profile',
    'snapback',
    'generated',
    'app.descriptor.json',
  ), 'utf8'));
  const mediaInspection = enumerateAppDescriptorV1(mediaDescriptor);
  const mediaCommand = mediaInspection.commands.find(({ name }) => name === 'sendMessage');
  assert(mediaCommand);
  assert.equal(mediaCommand.kind, 'media-command.v1');
  assert.equal(mediaCommand.intent.name, 'sharedMediaUpload');
  assert.equal(mediaCommand.binding.format, 'snapback.media-command-binding.v1');
  assert.equal(mediaCommand.mutation.name, 'sendMessageMutation');

  const inspectionSource = readFileSync(join(packageRoot, 'app-inspection.mjs'), 'utf8');
  assert.doesNotMatch(
    inspectionSource,
    /(?:from\s+|import\s*\()["'](?:react|snapback-react|@expo\/snapback-react)["']/u,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('app-inspection.test.mjs: all cases passed');
