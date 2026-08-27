#!/usr/bin/env node
// Cold signature-task acceptance: every byte read by this test is fenced to
// guide/reference, so passing cannot depend on package source or binary text.
// @ref LLP 0194#acceptance — five representative authoring questions resolve from reference artifacts alone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const referenceRoot = join(root, 'guide/reference');
const reads = [];

function readReference(path) {
  const absolute = resolve(referenceRoot, path);
  const withinReference = absolute === referenceRoot || absolute.startsWith(`${referenceRoot}${sep}`);
  assert.equal(withinReference, true, `cold suite refused non-reference read: ${relative(root, absolute)}`);
  reads.push(relative(root, absolute));
  return readFileSync(absolute, 'utf8');
}

const registry = JSON.parse(readReference('registry.json'));
const byIdentity = new Map(registry.symbols.map((symbol) => [symbol.identity, symbol]));

function exact(name, module = null) {
  const symbols = (registry.lookup.exact[name] ?? []).map((identity) => byIdentity.get(identity));
  const match = module === null ? symbols[0] : symbols.find((symbol) => symbol.module === module);
  assert.ok(match, `registry must answer ${name}${module ? ` in ${module}` : ''}`);
  return match;
}

function member(symbol, name) {
  const match = symbol.members.find((candidate) => candidate.name === name);
  assert.ok(match, `${symbol.identity} must expose member ${name}`);
  return match;
}

const client = exact('SnapbackClient', '@expo/snapback-client');
const query = member(client, 'query').signature;
const liveQuery = member(client, 'liveQuery').signature;
assert.match(query, /options\?: \{ readonly args\?: FunctionArgs<Ref>; readonly userId\?: string \}/u);
assert.match(liveQuery, /readonly args\?: FunctionArgs<Ref>/u);
assert.doesNotMatch(query, /query\([^)]*,\s*args\s*:/u);

const options = exact('SnapbackClientOptions', '@expo/snapback-client');
assert.match(options.signature, /readonly custody\?: 'anonymous-public' \| null/u);
assert.match(options.signature, /readonly authClientProtocol\?: number \| null/u);

const verify = exact('VerifyConfig', '@expo/snapback-cli/verify');
for (const required of ['schemaVersion', 'backendDirectory', 'generatedDirectory', 'context', 'profiles']) {
  assert.ok(verify.members.some(({ name }) => name === required), `VerifyConfig must include ${required}`);
}
assert.match(verify.signature, /readonly profiles\?: readonly VerifyProfile\[\]/u);
const verifyProfile = exact('VerifyProfile', '@expo/snapback-cli/verify');
const verifyCommandProfile = exact('VerifyCommandProfile', '@expo/snapback-cli/verify');
assert.match(verifyProfile.signature, /readonly run: \(context: Readonly<Record<string, unknown>>\)/u);
assert.match(verifyProfile.signature, /readonly command: VerifyCommandProfile/u);
assert.match(verifyCommandProfile.signature, /readonly executable: string/u);
assert.match(verifyCommandProfile.signature, /readonly resultFile\?: string/u);

const hookFacts = ['QueryState', 'SnapbackOutboxState'].map((name) => exact(name, '@expo/snapback-react'));
for (const fact of hookFacts) assert.equal(fact.runtime.kind, 'type-only');
assert.match(hookFacts[0].signature, /freshness/u);
assert.match(hookFacts[1].signature, /pending/u);

const ctxModule = '@expo/snapback-codegen/ctx';
const queryBuilder = exact('QueryBuilder', ctxModule);
const queryDatabase = exact('QueryDatabase', ctxModule);
const mutationDatabase = exact('MutationDatabase', ctxModule);
const queryContext = exact('QueryContext', ctxModule);
const mutationContext = exact('MutationContext', ctxModule);
for (const verb of ['withIndex', 'eq', 'in', 'lt', 'lte', 'gt', 'gte', 'order', 'take', 'collect', 'first']) {
  member(queryBuilder, verb);
}
for (const verb of ['get', 'query']) member(queryDatabase, verb);
for (const verb of ['insert', 'patch', 'delete']) member(mutationDatabase, verb);
for (const symbol of [queryBuilder, queryDatabase, mutationDatabase, queryContext, mutationContext]) {
  assert.equal(symbol.runtime.kind, 'type-only');
}
assert.match(queryContext.signature, /readonly db: QueryDatabase<Schema>/u);
assert.match(mutationContext.signature, /readonly db: MutationDatabase<Schema>/u);
assert.equal(registry.scope.handlerContext.status, 'included-published-type-only-declaration');
assert.equal(registry.scope.handlerContext.module, ctxModule);

for (const symbol of [client, options, verify, verifyProfile, verifyCommandProfile, ...hookFacts, queryBuilder, queryDatabase, mutationDatabase, queryContext, mutationContext]) {
  const moduleRecord = registry.modules.find((candidate) => candidate.module === symbol.module);
  assert.ok(moduleRecord, `module page must exist for ${symbol.identity}`);
  const page = readReference(moduleRecord.page.split('/').at(-1));
  assert.match(page, new RegExp(`<a id="${symbol.anchor}"></a>`, 'u'));
}

const answers = {
  headlessArgs: 'Pass function arguments under options.args for query and liveQuery.',
  constructorCustody: "For a sessions target's anonymous-public headless client, set authClientProtocol: 1 and custody: 'anonymous-public'.",
  verifyConfig: 'VerifyConfig pins schemaVersion and optionally selects backend/generated directories, partial identity context, and readonly profiles that use either a named run function or a direct command contract.',
  hookFacts: 'QueryState and SnapbackOutboxState are explicit type-only hook fact surfaces.',
  ctxDbVerbs: 'Query: get/query; builder: withIndex/eq/in/lt/lte/gt/gte/order/take/collect/first; mutation adds insert/patch/delete.',
};

assert.ok(reads.every((path) => path.startsWith('guide/reference/')));
console.log(JSON.stringify({
  schemaVersion: 'snapback.generated-api-reference-cold-acceptance.v1',
  ok: true,
  identity: registry.buildIdentity,
  reads: [...new Set(reads)].sort(),
  answers,
}, null, 2));
