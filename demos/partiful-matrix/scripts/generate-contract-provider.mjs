#!/usr/bin/env bun
// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop — the Partitime
// Contract binding surface is generated from Exact's provider-native
// declaration boundary and checked across two independent producers.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '..');
const repoRoot = resolve(demoRoot, '..', '..');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const exactCheckout = resolve(
  option('exact-checkout')
    ?? process.env.EXACT_CHECKOUT
    ?? resolve(repoRoot, '..', 'exact'),
);
const declarationEntry = join(
  exactCheckout,
  'packages',
  'exact-contract',
  'src',
  'declaration',
  'index.ts',
);
const {
  generateFromDeclaration,
  produceConvexProviderDeclaration,
  produceSnapbackProviderDeclaration,
} = await import(pathToFileURL(declarationEntry).href);

const text = { kind: 'string' };
const number = { kind: 'float64' };
const convexInput = {
  deployment: 'partitime-production-shape',
  schemaVersion: 'partitime-provider-v1',
  tables: {
    events: {
      rowShape: 'EventRow',
      fields: {
        _id: text,
        accent: text,
        description: text,
        emoji: text,
        hostId: text,
        hostName: text,
        location: text,
        startsAt: number,
        title: text,
      },
    },
    posts: {
      rowShape: 'PostRow',
      fields: {
        _id: text,
        authorId: text,
        authorName: text,
        createdAt: number,
        eventId: text,
        message: text,
      },
    },
    rsvps: {
      rowShape: 'RsvpRow',
      fields: {
        _id: text,
        eventId: text,
        guestName: text,
        status: text,
        userId: text,
      },
    },
  },
  queries: {
    eventDetails: { args: { eventId: text }, returns: { kind: 'rows', table: 'events' }, receipts: 'none' },
    eventWall: { args: { eventId: text }, returns: { kind: 'rows', table: 'posts' }, receipts: 'none' },
    guestList: { args: { eventId: text }, returns: { kind: 'rows', table: 'rsvps' }, receipts: 'none' },
    listEvents: { args: {}, returns: { kind: 'rows', table: 'events' }, receipts: 'none' },
  },
  mutations: {
    createEvent: {
      args: {
        accent: text,
        description: text,
        emoji: text,
        hostName: text,
        location: text,
        startsAt: number,
        title: text,
      },
      writes: ['events', 'rsvps'],
      optimistic: false,
      receipts: 'none',
    },
    postMessage: {
      args: { authorName: text, eventId: text, message: text },
      writes: ['posts'],
      optimistic: false,
      receipts: 'none',
    },
    rsvp: {
      args: { eventId: text, guestName: text, status: text },
      writes: ['rsvps'],
      optimistic: false,
      receipts: 'none',
    },
  },
};

const snapbackColumn = (name, type = 'text') => ({ name, type });
const snapbackInput = {
  database: 'partitime',
  schemaVersion: 'partitime-provider-v1',
  replicaPath: '.snapback/partitime.db',
  tables: [
    {
      name: 'events',
      rowShape: 'EventRow',
      columns: [
        snapbackColumn('_id'), snapbackColumn('accent'), snapbackColumn('description'),
        snapbackColumn('emoji'), snapbackColumn('hostId'), snapbackColumn('hostName'),
        snapbackColumn('location'), snapbackColumn('startsAt', 'integer'), snapbackColumn('title'),
      ],
    },
    {
      name: 'posts',
      rowShape: 'PostRow',
      columns: [
        snapbackColumn('_id'), snapbackColumn('authorId'), snapbackColumn('authorName'),
        snapbackColumn('createdAt', 'integer'), snapbackColumn('eventId'), snapbackColumn('message'),
      ],
    },
    {
      name: 'rsvps',
      rowShape: 'RsvpRow',
      columns: [
        snapbackColumn('_id'), snapbackColumn('eventId'), snapbackColumn('guestName'),
        snapbackColumn('status'), snapbackColumn('userId'),
      ],
    },
  ],
  queries: [
    { name: 'eventDetails', args: [snapbackColumn('eventId')], returns: { table: 'events', cardinality: 'many' } },
    { name: 'eventWall', args: [snapbackColumn('eventId')], returns: { table: 'posts', cardinality: 'many' } },
    { name: 'guestList', args: [snapbackColumn('eventId')], returns: { table: 'rsvps', cardinality: 'many' } },
    { name: 'listEvents', args: [], returns: { table: 'events', cardinality: 'many' } },
  ],
  mutations: [
    {
      name: 'createEvent',
      args: [
        snapbackColumn('accent'), snapbackColumn('description'), snapbackColumn('emoji'),
        snapbackColumn('hostName'), snapbackColumn('location'),
        snapbackColumn('startsAt', 'integer'), snapbackColumn('title'),
      ],
      writes: ['events', 'rsvps'],
    },
    {
      name: 'postMessage',
      args: [snapbackColumn('authorName'), snapbackColumn('eventId'), snapbackColumn('message')],
      writes: ['posts'],
    },
    {
      name: 'rsvp',
      args: [snapbackColumn('eventId'), snapbackColumn('guestName'), snapbackColumn('status')],
      writes: ['rsvps'],
    },
  ],
};

const declarations = {
  convex: produceConvexProviderDeclaration(convexInput),
  snapback: produceSnapbackProviderDeclaration(snapbackInput),
};
const artifacts = Object.fromEntries(
  Object.entries(declarations).map(([provider, declaration]) => [
    provider,
    generateFromDeclaration(declaration, {
      contractModuleSpecifier: './provider.generated.ts',
    }),
  ]),
);

const viewProjection = (artifact) => ({
  queries: Object.fromEntries(Object.entries(artifact.manifest.queries).map(([name, query]) => [
    name,
    {
      args: query.args,
      argOrder: query.argOrder,
      result: query.result,
      compatibilityToken: query.compatibilityToken,
    },
  ])),
  mutations: Object.fromEntries(Object.entries(artifact.manifest.mutations).map(([name, mutation]) => [
    name,
    { args: mutation.args, argOrder: mutation.argOrder, writes: mutation.writes },
  ])),
});
const snapbackView = JSON.stringify(viewProjection(artifacts.snapback));
const convexView = JSON.stringify(viewProjection(artifacts.convex));
if (snapbackView !== convexView) {
  throw new Error('Snapback and Convex generated different Partitime view-facing bindings');
}
const viewTypeProjection = (source) => source
  .split('\n')
  .slice(3)
  .filter((line) => !/^export type \w+ReceiptsPosture = /.test(line))
  .join('\n');
if (viewTypeProjection(artifacts.snapback.types) !== viewTypeProjection(artifacts.convex.types)) {
  throw new Error('Snapback and Convex generated different Partitime row/result types');
}

const generatedRoot = join(demoRoot, 'surfaces', 'contract', 'data', 'generated');
mkdirSync(generatedRoot, { recursive: true });
for (const provider of ['snapback', 'convex']) {
  const declaration = declarations[provider];
  const artifact = artifacts[provider];
  writeJson(join(generatedRoot, `${provider}.declaration.json`), declaration);
  writeJson(join(generatedRoot, `${provider}.manifest.json`), artifact.manifest);
  writeJson(join(generatedRoot, `${provider}.fixtures.json`), artifact.conformanceFixtures);
  writeFileSync(join(generatedRoot, `${provider}.types.ts`), artifact.types);
  writeFileSync(join(generatedRoot, `${provider}.bindings.ts`), artifact.bindingModuleSource);
  writeFileSync(join(generatedRoot, `${provider}.bindings.contract-meta.ts`), artifact.contractMetaSource);
  writeFileSync(join(generatedRoot, `${provider}.md`), artifact.docsMarkdown);
}

// The Contract view imports one generated module. Convex is deliberately the
// canonical source for this follow-up so the runtime proof consumes the
// independently generated non-Snapback producer, while the projection check
// above proves that Snapback exposes the same view-facing contract.
const dataRoot = dirname(generatedRoot);
writeFileSync(join(dataRoot, 'provider.generated.ts'), artifacts.convex.bindingModuleSource);
writeFileSync(join(dataRoot, 'provider.generated.contract-meta.ts'), artifacts.convex.contractMetaSource);

const generatedFiles = [
  'provider.generated.ts',
  'provider.generated.contract-meta.ts',
  ...['snapback', 'convex'].flatMap((provider) => [
    `generated/${provider}.declaration.json`,
    `generated/${provider}.manifest.json`,
    `generated/${provider}.fixtures.json`,
    `generated/${provider}.types.ts`,
    `generated/${provider}.bindings.ts`,
    `generated/${provider}.bindings.contract-meta.ts`,
    `generated/${provider}.md`,
  ]),
];
const receipt = {
  schema: 'partitime.contract-provider-generation.v1',
  exactRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: exactCheckout, encoding: 'utf8' }).trim(),
  exactTreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: exactCheckout, encoding: 'utf8' }).trim().length > 0,
  generator: 'packages/exact-contract/src/declaration/generate.ts',
  generatorSha256: sha256(readFileSync(join(exactCheckout, 'packages', 'exact-contract', 'src', 'declaration', 'generate.ts'))),
  canonicalBindingProducer: 'convex',
  independentProducers: ['convex', 'snapback'],
  viewProjectionEqual: true,
  generatedTypesEqual: true,
  files: generatedFiles.map((path) => {
    const absolute = join(dataRoot, path);
    const bytes = readFileSync(absolute);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }),
};
writeJson(join(generatedRoot, 'generation.receipt.json'), receipt);
console.log(JSON.stringify(receipt, null, 2));

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
