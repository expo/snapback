// Static transaction extraction, NormalizedDataTransactionCoreV1 compilation,
// and synthesized ordinary HostPlan mutation lowering.
//
// @ref LLP 0255#s44-datatransactionv1
// @ref LLP 0255#s71-chunk-grammar
// @ref LLP 0255#s71b-transaction-resolution--one-replayable-function-identity

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import ts from 'typescript';

import {
  arg,
  bindingRef,
  defineMutation,
  get,
  lit,
  record,
  results,
  returnExpr,
  v,
} from './define.mjs';
import {
  effectiveResultContract,
  resultContractHash,
} from './result-contracts.mjs';
import { dataQueryDomainHash } from './data-query.mjs';

export const DATA_TRANSACTION_FORMAT = 'snapback.normalized-data-transaction.v1';
export const DATA_TRANSACTION_SCHEMA_VERSION = 'snapback.data-transaction.v1';
export const DATA_TRANSACTION_GUIDE_ANCHOR = 'guide/data/transactions';
export const DATA_TRANSACTION_CEILINGS = Object.freeze({
  maxChunks: 16,
  maxResources: 8,
  maxDeclaredReadRows: 32,
  maxDeclaredWriteRows: 16,
  maxDescriptorBytes: 65_536,
  maxDurableRecordBytes: 262_144,
  maxResultBytes: 65_536,
});
export const DATA_TRANSACTION_REFUSAL_VOCABULARY = Object.freeze([
  ['SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED', 'admission'],
  ['SNAPBACK_DATA_TRANSACTION_INVALID', 'admission'],
  ['SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED', 'generation'],
  ['SNAPBACK_DATA_CUSTODY_UNAVAILABLE', 'dispatch'],
].map(([code, phase]) => Object.freeze({
  code,
  phase,
  guideAnchor: DATA_TRANSACTION_GUIDE_ANCHOR,
})));

const MAX_PLAN_STEPS = 64;
const MAX_PLAN_SERIALIZED_BYTES = 65_536;
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set([
  '.git', '.snapback', '_generated', 'generated', 'node_modules', 'runtime-artifacts',
]);
const WRITE_OPERATIONS = new Set(['create', 'update', 'delete']);

const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const dataTransactionError = (code, message, details = {}) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  error.details = { guideAnchor: DATA_TRANSACTION_GUIDE_ANCHOR, ...details };
  return error;
};

const sourceSpan = (root, path, node, sourceFile) => {
  const at = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    path: relative(root, path).split(sep).join('/'),
    line: at.line + 1,
    column: at.character + 1,
  };
};

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort(codeUnitCompare)) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      const path = join(directory, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(name))) files.push(path);
    }
  };
  visit(root);
  return files;
}

function chunkShape(node, resourceNames) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
  const operation = node.expression.name.text;
  const resourceAccess = node.expression.expression;
  if (!WRITE_OPERATIONS.has(operation) || !ts.isPropertyAccessExpression(resourceAccess)) return null;
  const resource = resourceAccess.name.text;
  const txAccess = resourceAccess.expression;
  if (
    !resourceNames.has(resource)
    || !ts.isPropertyAccessExpression(txAccess)
    || txAccess.name.text !== 'tx'
    || !ts.isIdentifier(txAccess.expression)
    || txAccess.expression.text !== 'db'
  ) return null;
  if (node.arguments.length !== 1) {
    throw dataTransactionError(
      'SNAPBACK_DATA_TRANSACTION_INVALID',
      `db.tx.${resource}.${operation}(...) requires exactly one argument object`,
    );
  }
  return { resource, operation };
}

function transactionShape(root, path, node, sourceFile, resourceNames) {
  if (
    !ts.isPropertyAccessExpression(node.expression)
    || node.expression.name.text !== 'transact'
    || !ts.isIdentifier(node.expression.expression)
    || node.expression.expression.text !== 'db'
  ) return null;
  if (node.arguments.length < 1) {
    throw dataTransactionError(
      'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
      'db.transact(...) requires at least one chunk',
      { ceiling: 'minChunks', observed: 0 },
    );
  }
  if (node.arguments.length > DATA_TRANSACTION_CEILINGS.maxChunks) {
    throw dataTransactionError(
      'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
      `db.transact(...) has ${node.arguments.length} chunks; maxChunks is ${DATA_TRANSACTION_CEILINGS.maxChunks}`,
      { ceiling: 'maxChunks', observed: node.arguments.length },
    );
  }
  const chunks = node.arguments.map((argument, position) => {
    const chunk = chunkShape(argument, resourceNames);
    if (!chunk) {
      throw dataTransactionError(
        'SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED',
        `db.transact(...) chunk ${position} must be a static db.tx.<resource>.<create|update|delete>(...) call`,
        { position },
      );
    }
    return { position, ...chunk };
  });
  return { chunks, sourceSpan: sourceSpan(root, path, node, sourceFile) };
}

export function extractDataTransactionTemplates({ root, resourceNames }) {
  const resources = new Set(resourceNames);
  const templates = [];
  for (const path of sourceFiles(root)) {
    const source = readFileSync(path, 'utf8');
    const kind = /\.[cm]?tsx?$/u.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, kind);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const template = transactionShape(root, path, node, sourceFile, resources);
        if (template) templates.push(template);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const distinct = new Map();
  for (const template of templates) {
    const key = JSON.stringify(template.chunks.map(({ resource, operation }) => ({ resource, operation })));
    if (!distinct.has(key)) distinct.set(key, template);
  }
  return [...distinct.values()];
}

const renameExpression = (value, position) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => renameExpression(entry, position));
  if (value.__expr === true && Object.hasOwn(value, 'Arg')) {
    return arg(`c${position}_${value.Arg}`);
  }
  if (value.__expr === true && Object.hasOwn(value, 'Binding')) {
    return bindingRef(`__dataTx${position}_${value.Binding}`);
  }
  const renamed = Object.create(Object.getPrototypeOf(value));
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'bind_as' || key === 'bind_id_as' || key === 'item_as' || key === 'into') {
      renamed[key] = entry === null ? null : `__dataTx${position}_${entry}`;
    } else {
      renamed[key] = renameExpression(entry, position);
    }
  }
  return renamed;
};

function synthesizeBatchDefinition(template, resources, functionsModule) {
  const args = {};
  const steps = [];
  const resultFields = Object.create(null);
  const resultValidators = Object.create(null);
  const chunkArgumentNames = [];
  for (const chunk of template.chunks) {
    const resource = resources.get(chunk.resource);
    const exportedName = `${chunk.resource}.${chunk.operation}`;
    const definition = functionsModule[exportedName];
    if (!resource || !definition || definition.__kind !== 'Mutation' || !definition.plan) {
      throw dataTransactionError(
        'SNAPBACK_DATA_TRANSACTION_INVALID',
        `chunk ${chunk.position} does not resolve to generated mutation ${exportedName}`,
        { position: chunk.position, exportedName },
      );
    }
    const names = Object.keys(definition.args ?? {});
    chunkArgumentNames.push(names);
    for (const name of names) args[`c${chunk.position}_${name}`] = definition.args[name];
    for (const step of definition.plan.steps) {
      steps.push(renameExpression(step, chunk.position));
    }
    const resultName = `c${chunk.position}`;
    if (chunk.operation === 'delete') {
      resultFields[resultName] = lit(null);
      resultValidators[resultName] = v.null();
    } else {
      const resultBinding = `__dataTx${chunk.position}_result`;
      const returnedId = definition.plan.return_value?.Document?.id;
      if (!returnedId) {
        throw dataTransactionError(
          'SNAPBACK_DATA_TRANSACTION_INVALID',
          `chunk ${chunk.position} ${exportedName} has no exact post-write document result`,
          { position: chunk.position, exportedName },
        );
      }
      steps.push(get(
        resource.core.table,
        renameExpression(returnedId, chunk.position),
        resultBinding,
        { elseError: 'SNAPBACK_ROW_NOT_FOUND' },
      ));
      resultFields[resultName] = bindingRef(resultBinding);
      resultValidators[resultName] = v.doc(resource.core.table);
    }
  }
  const definition = defineMutation({
    args,
    auth: 'authenticated',
    plan: steps,
    returns: returnExpr(record(resultFields)),
    result: results.value(v.object(resultValidators)),
    standardPattern: { helper: 'data-transaction.v1', profile: 'atomic-batch.v1' },
  });
  return { definition, chunkArgumentNames };
}

function firstViolatedCeiling(template, core, serializedPlan = null) {
  const resources = new Set(template.chunks.map(({ resource }) => resource));
  const descriptorBytes = Buffer.byteLength(JSON.stringify(core), 'utf8');
  const declaredReadRows = serializedPlan?.steps.filter((step) => Object.hasOwn(step, 'Get')).length
    ?? template.chunks.reduce((count, chunk) => count + (chunk.operation === 'create' ? 0 : 1), 0);
  const checks = [
    ['maxChunks', template.chunks.length, DATA_TRANSACTION_CEILINGS.maxChunks],
    ['maxResources', resources.size, DATA_TRANSACTION_CEILINGS.maxResources],
    ['maxDeclaredReadRows', declaredReadRows, DATA_TRANSACTION_CEILINGS.maxDeclaredReadRows],
    ['maxDeclaredWriteRows', template.chunks.length, DATA_TRANSACTION_CEILINGS.maxDeclaredWriteRows],
    ['maxDescriptorBytes', descriptorBytes, DATA_TRANSACTION_CEILINGS.maxDescriptorBytes],
  ];
  if (serializedPlan !== null) {
    checks.push(
      ['MAX_PLAN_STEPS', serializedPlan.steps.length, MAX_PLAN_STEPS],
      [
        'MAX_PLAN_SERIALIZED_BYTES',
        Buffer.byteLength(JSON.stringify(serializedPlan), 'utf8'),
        MAX_PLAN_SERIALIZED_BYTES,
      ],
    );
  }
  return checks.find(([, observed, limit]) => observed > limit) ?? null;
}

export function compileDataTransactionCatalog({
  templates,
  normalizedResources,
  decoratedByName,
  functionsModule,
  hash,
  existingNames,
  serializePlan,
  tables,
}) {
  const resources = new Map(normalizedResources.map((resource) => [resource.core.resource, resource]));
  const catalog = [];
  const synthesized = [];
  const reserved = new Map();
  for (const template of templates) {
    const chunks = template.chunks.map((chunk) => {
      const resource = resources.get(chunk.resource);
      const exportedName = `${chunk.resource}.${chunk.operation}`;
      const operation = resource?.core.operations.find(({ name }) => name === chunk.operation);
      const decorated = decoratedByName.get(exportedName);
      if (!resource || !operation || !decorated || decorated.kind !== 'Mutation') {
        throw dataTransactionError(
          'SNAPBACK_DATA_TRANSACTION_INVALID',
          `chunk ${chunk.position} cannot resolve exact generated mutation ${exportedName}`,
          { position: chunk.position, exportedName },
        );
      }
      return {
        position: chunk.position,
        resourceId: resource.id,
        operation: chunk.operation,
        exportedName,
        planHash: operation.planHash,
        argsContractHash: operation.argsContractHash,
        resultContractHash: operation.resultContractHash,
        policyId: operation.policyId,
        readTables: [...operation.readTables],
        writeTables: [...operation.writeTables],
        prediction: operation.prediction,
        custody: { ...operation.custody },
      };
    });
    const reasons = [...new Set(chunks.flatMap(({ custody }) => (
      custody.class === 'online-only' && custody.reason !== null ? [custody.reason] : []
    )))].sort(codeUnitCompare);
    const custodyClass = chunks.every(({ custody }) => custody.class === 'queue-eligible')
      ? 'queue-eligible'
      : 'online-only';
    const prediction = chunks.every((chunk) => chunk.prediction === 'generated-exact')
      ? 'generated-exact'
      : 'none';
    const reads = [...new Set(chunks.flatMap((chunk) => chunk.readTables))].sort(codeUnitCompare);
    const writes = [...new Set(chunks.flatMap((chunk) => chunk.writeTables))].sort(codeUnitCompare);
    const synthesizedBatch = template.chunks.length > 1
      ? synthesizeBatchDefinition(template, resources, functionsModule)
      : null;
    const synthesizedResultContract = synthesizedBatch === null ? null : effectiveResultContract({
      def: synthesizedBatch.definition,
      functionKind: 'Mutation',
      runtime: { HostPlan: { Mutation: serializePlan(synthesizedBatch.definition.plan, null, null) } },
      tables,
    });
    const effectiveResultHash = synthesizedBatch === null
      ? chunks[0].resultContractHash
      : resultContractHash(synthesizedResultContract);
    const core = {
      format: DATA_TRANSACTION_FORMAT,
      surfaceProfile: 'snapback.data-surface.v1',
      chunks,
      atomicity: 'single-authoritative-transaction',
      authorityPartition: 'one-principal-partition',
      prediction,
      custody: { class: custodyClass, reasons },
      resultContractHash: effectiveResultHash,
      reach: { reads, writes },
      ceilings: { ...DATA_TRANSACTION_CEILINGS },
      refusalVocabulary: [...DATA_TRANSACTION_REFUSAL_VOCABULARY],
      guideAnchor: DATA_TRANSACTION_GUIDE_ANCHOR,
    };
    const normalizedDataTransactionId = hash('snapback:normalized-data-transaction:v1', core);
    let resolution;
    let argumentNames;
    if (synthesizedBatch === null) {
      resolution = { kind: 'chunk-mutation', exportedName: chunks[0].exportedName };
      argumentNames = [decoratedByName.get(chunks[0].exportedName).argsContract.fields.map(({ name }) => name)];
    } else {
      const exportedName = `data.tx_${normalizedDataTransactionId.slice('sha256:'.length, 'sha256:'.length + 16)}`;
      const previous = reserved.get(exportedName);
      if ((previous && previous !== normalizedDataTransactionId) || existingNames.has(exportedName)) {
        throw dataTransactionError(
          'SNAPBACK_DATA_OPERATION_NAME_COLLISION',
          `synthesized transaction name ${exportedName} collides with another function or witness`,
          { exportedName, normalizedDataTransactionId, previous: previous ?? null },
        );
      }
      reserved.set(exportedName, normalizedDataTransactionId);
      resolution = { kind: 'synthesized-batch', exportedName };
      argumentNames = synthesizedBatch.chunkArgumentNames;
      synthesized.push({
        exportedName,
        definition: synthesizedBatch.definition,
        resultContract: synthesizedResultContract,
        sourceSpan: template.sourceSpan,
      });
    }
    const violation = firstViolatedCeiling(
      template,
      core,
      synthesizedBatch === null ? null : serializePlan(synthesizedBatch.definition.plan, null, null),
    );
    if (violation) {
      const [ceiling, observed, limit] = violation;
      throw dataTransactionError(
        'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
        `transaction violates ${ceiling}: observed ${observed}, maximum ${limit}`,
        { ceiling, observed, limit },
      );
    }
    catalog.push({
      id: normalizedDataTransactionId,
      normalizedDataTransactionId,
      core,
      resolution,
      argumentNames,
      shape: template.chunks.map(({ resource, operation }) => ({ resource, operation })),
      sourceSpan: template.sourceSpan,
    });
  }
  catalog.sort((left, right) => codeUnitCompare(left.id, right.id));
  return { catalog, synthesized };
}

export function createDataTransactionEnvelopeV1({
  catalogEntry,
  generation,
  functionReference,
  chunkFunctionReferences,
  intentId,
  canonicalArguments,
  namedArguments,
  authority,
  targetCustody,
  predictionClaims = null,
  createdAtClaim,
}) {
  if (typeof intentId !== 'string' || intentId.length === 0) {
    throw dataTransactionError('SNAPBACK_DATA_TRANSACTION_INVALID', 'transaction intentId is required');
  }
  return {
    artifactKind: 'dataTransaction',
    schemaVersion: DATA_TRANSACTION_SCHEMA_VERSION,
    normalizedDataTransactionId: catalogEntry.normalizedDataTransactionId,
    core: catalogEntry.core,
    resolution: {
      ...catalogEntry.resolution,
      functionId: functionReference.id,
    },
    generation,
    functionReference,
    chunkFunctionReferences,
    intentId,
    canonicalArguments: [...canonicalArguments],
    canonicalArgsDigest: dataQueryDomainHash('snapback:data-canonical-args:v1', namedArguments),
    authority,
    targetCustody,
    replayKey: {
      intentId,
      generationId: generation.generationId,
      normalizedDataTransactionId: catalogEntry.normalizedDataTransactionId,
    },
    predictionClaims,
    createdAtClaim,
  };
}

export function renderDataTransactionRuntime(catalog, resources) {
  const runtimeCatalog = catalog.map((entry) => ({ ...entry }));
  const operations = Object.fromEntries(resources.map((resource) => [
    resource.core.resource,
    Object.fromEntries(resource.functionReferences
      .filter(({ kind }) => kind === 'Mutation')
      .map((reference) => [reference.name.slice(reference.name.lastIndexOf('.') + 1), reference])),
  ]));
  return `\nexport const dataTransactionCatalog = Object.freeze(${JSON.stringify(runtimeCatalog, null, 2)});\n`
    + `const __dataTransactionOperations = Object.freeze(${JSON.stringify(operations, null, 2)});\n`
    + `Object.defineProperty(__dataObject, '__snapbackDataBinding', { value: Object.freeze({ dataResources, dataQueryCatalog, dataTransactionCatalog, operations: __dataTransactionOperations }), enumerable: false });\n`
    + `export const data = Object.freeze(__dataObject);\n`;
}

function transactionContractType(value) {
  if (!value || typeof value !== 'object') return 'unknown';
  if (value.kind === 'null') return 'null';
  if (value.kind === 'boolean') return 'boolean';
  if (value.kind === 'string' || value.kind === 'assetRef') return 'string';
  if (value.kind === 'principal') return 'Principal';
  if (value.kind === 'id') return `Id<${JSON.stringify(value.table)}>`;
  if (value.kind === 'integer' || value.kind === 'finiteReal') return 'number';
  if (value.kind === 'literal') return JSON.stringify(value.value);
  if (value.kind === 'json') return 'unknown';
  if (value.kind === 'array') return `ReadonlyArray<${transactionContractType(value.element)}>`;
  if (value.kind === 'tuple') {
    return `readonly [${(value.elements ?? []).map(transactionContractType).join(', ')}]`;
  }
  if (value.kind === 'vector') {
    return `ReadonlyArray<number> & { readonly length: ${value.dimensions} }`;
  }
  if (value.kind === 'union') {
    return (value.variants ?? []).map(transactionContractType).join(' | ');
  }
  if (value.kind === 'object') {
    const fields = (value.fields ?? []).map((field) => (
      `readonly ${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${transactionContractType(field.value)}`
    ));
    return fields.length === 0 ? 'Readonly<Record<string, never>>' : `Readonly<{ ${fields.join('; ')} }>`;
  }
  return 'unknown';
}

function transactionArgsType(contract) {
  const fields = (contract?.fields ?? []).map((field) => (
    `readonly ${JSON.stringify(field.name)}${field.required ? '' : '?'}: ${transactionContractType(field.value)}`
  ));
  return fields.length === 0 ? 'Readonly<Record<string, never>>' : `Readonly<{ ${fields.join('; ')} }>`;
}

function transactionResultType(contract) {
  if (contract?.kind === 'document' || contract?.kind === 'documents') {
    const item = transactionContractType(contract.document);
    return contract.kind === 'document' ? item : `ReadonlyArray<${item}>`;
  }
  if (contract?.kind === 'records') return `ReadonlyArray<${transactionContractType(contract.record)}>`;
  if (contract?.kind === 'value') return transactionContractType(contract.value);
  return 'unknown';
}

export function renderDataTransactionTypes(resources) {
  const members = resources.filter(({ core }) => core.capabilities.write).map(({ core, functionReferences }) => {
    const operations = functionReferences.filter(({ kind, name }) => (
      kind === 'Mutation' && ['create', 'update', 'delete'].includes(name.slice(name.lastIndexOf('.') + 1))
    )).map((reference) => {
      const operation = reference.name.slice(reference.name.lastIndexOf('.') + 1);
      const args = transactionArgsType(reference.argsContract);
      const result = transactionResultType(reference.resultContract);
      return `readonly ${JSON.stringify(operation)}: (args: ${args}) => DataTransactionChunkV1<${JSON.stringify(core.resource)}, ${JSON.stringify(operation)}, ${args}, ${result}>;`;
    }).join(' ');
    return `readonly ${JSON.stringify(core.resource)}: Readonly<{ ${operations} }>;`;
  }).join(' ');
  return `export interface DataTransactionChunkV1<Resource extends string = string, Operation extends 'create' | 'update' | 'delete' = 'create' | 'update' | 'delete', Args extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>, Result = unknown> { readonly artifactKind: 'dataTransactionChunk'; readonly resource: Resource; readonly operation: Operation; readonly args: Args; readonly __result?: Result; }\n`
    + `export type DataTransactionResultV1<Chunk> = Chunk extends DataTransactionChunkV1<string, 'create' | 'update' | 'delete', Readonly<Record<string, unknown>>, infer Result> ? Result : never;\n`
    + `export type DataTransactionResultTupleV1<Chunks extends readonly DataTransactionChunkV1[]> = { readonly [Position in keyof Chunks]: DataTransactionResultV1<Chunks[Position]> };\n`
    + `export declare const dataTransactionCatalog: readonly Readonly<Record<string, unknown>>[];\n`
    + `export type DataTransactionBuilderV1 = Readonly<{ ${members} }>;\n`;
}
