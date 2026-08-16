import { parse, parseExpressionAt } from 'acorn';

export const N_PLUS_ONE_BATCH_READ_THRESHOLD = 3;

const FUNCTION_KINDS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
const ITERATION_METHODS = new Set(['flatMap', 'forEach', 'map']);

function literalString(node) {
  return node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

function memberName(member) {
  if (member?.type !== 'MemberExpression') return null;
  if (!member.computed && member.property?.type === 'Identifier') {
    return member.property.name;
  }
  return member.computed ? literalString(member.property) : null;
}

function propertyName(property) {
  if (property?.type !== 'Property') return null;
  if (!property.computed && property.key?.type === 'Identifier') return property.key.name;
  return literalString(property.key);
}

function dbAuthority(expression, ctxName) {
  if (expression?.type !== 'MemberExpression') return null;
  if (
    memberName(expression) === 'db'
    && expression.object?.type === 'Identifier'
    && expression.object.name === ctxName
  ) return 'ordinary';
  if (
    memberName(expression) === 'elevated'
    && dbAuthority(expression.object, ctxName) === 'ordinary'
  ) return 'elevated';
  return null;
}

function methodCall(node) {
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
  const name = memberName(node.callee);
  return name === null ? null : { name, receiver: node.callee.object, args: node.arguments };
}

function pointGetCandidate(node, ctxName) {
  const call = methodCall(node);
  if (!call || call.name !== 'get' || call.args.length !== 2) return null;
  const authority = dbAuthority(call.receiver, ctxName);
  const table = literalString(call.args[0]);
  if (authority === null || table === null) return null;
  return { lookup: 'get', authority, table, index: null, equalityFields: [] };
}

function completeUniqueCandidate(node, ctxName) {
  const terminal = methodCall(node);
  if (!terminal || terminal.name !== 'first' || terminal.args.length !== 0) return null;
  const methods = [];
  let cursor = terminal.receiver;
  while (cursor?.type === 'CallExpression') {
    const call = methodCall(cursor);
    if (!call) return null;
    methods.push(call);
    cursor = call.receiver;
  }
  const query = methods.at(-1);
  if (!query || query.name !== 'query' || query.args.length !== 1) return null;
  const authority = dbAuthority(query.receiver, ctxName);
  const table = literalString(query.args[0]);
  if (authority === null || table === null) return null;

  const chain = methods.slice(0, -1).toReversed();
  if (chain.some(({ name }) => name !== 'withIndex' && name !== 'eq')) return null;
  const indexes = chain.filter(({ name }) => name === 'withIndex');
  if (indexes.length !== 1 || indexes[0].args.length !== 1) return null;
  const index = literalString(indexes[0].args[0]);
  if (index === null) return null;
  const equalityFields = chain
    .filter(({ name }) => name === 'eq')
    .map(({ args }) => (args.length === 2 ? literalString(args[0]) : null));
  if (equalityFields.length === 0 || equalityFields.some((field) => field === null)) return null;
  if (new Set(equalityFields).size !== equalityFields.length) return null;
  return { lookup: 'unique', authority, table, index, equalityFields };
}

function exactIterationCount(expression) {
  if (expression?.type !== 'ArrayExpression') return null;
  return expression.elements.some((element) => element?.type === 'SpreadElement')
    ? null
    : expression.elements.length;
}

function integerLiteral(node) {
  if (
    node?.type === 'Literal'
    && typeof node.value === 'number'
    && Number.isSafeInteger(node.value)
  ) return node.value;
  if (
    node?.type === 'UnaryExpression'
    && (node.operator === '+' || node.operator === '-')
    && node.argument?.type === 'Literal'
    && typeof node.argument.value === 'number'
    && Number.isSafeInteger(node.argument.value)
  ) {
    const value = node.operator === '-' ? -node.argument.value : node.argument.value;
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

function identifierIs(node, name) {
  return node?.type === 'Identifier' && node.name === name;
}

function literalLoopStep(update, name) {
  if (update?.type === 'UpdateExpression' && identifierIs(update.argument, name)) {
    if (update.operator === '++') return 1;
    if (update.operator === '--') return -1;
  }
  if (update?.type !== 'AssignmentExpression' || !identifierIs(update.left, name)) {
    return null;
  }
  const amount = integerLiteral(update.right);
  if (amount === null) return null;
  if (update.operator === '+=') return amount;
  if (update.operator === '-=') return -amount;
  return null;
}

function exactForIterationCount(node) {
  if (
    node?.type !== 'ForStatement'
    || node.init?.type !== 'VariableDeclaration'
    || node.init.declarations.length !== 1
  ) return null;
  const declaration = node.init.declarations[0];
  if (declaration.id?.type !== 'Identifier') return null;
  const name = declaration.id.name;
  const initial = integerLiteral(declaration.init);
  const test = node.test;
  const bound = integerLiteral(test?.right);
  const step = literalLoopStep(node.update, name);
  if (
    initial === null
    || bound === null
    || step === null
    || step === 0
    || test?.type !== 'BinaryExpression'
    || !identifierIs(test.left, name)
  ) return null;

  let iterations;
  if (test.operator === '<' && step > 0) {
    iterations = initial < bound ? Math.ceil((bound - initial) / step) : 0;
  } else if (test.operator === '<=' && step > 0) {
    iterations = initial <= bound ? Math.floor((bound - initial) / step) + 1 : 0;
  } else if (test.operator === '>' && step < 0) {
    iterations = initial > bound ? Math.ceil((initial - bound) / -step) : 0;
  } else if (test.operator === '>=' && step < 0) {
    iterations = initial >= bound ? Math.floor((initial - bound) / -step) + 1 : 0;
  } else {
    return null;
  }
  return Number.isSafeInteger(iterations) ? iterations : null;
}

function loopContext(iterations) {
  return { iterations };
}

function repetitionEvidence(contexts) {
  if (contexts.length === 0) return null;
  if (contexts.some(({ iterations }) => iterations === 0)) return null;
  if (contexts.some(({ iterations }) => iterations === null)) {
    return { iterations: null };
  }
  const iterations = contexts.reduce((total, context) => total * context.iterations, 1);
  return iterations >= N_PLUS_ONE_BATCH_READ_THRESHOLD ? { iterations } : null;
}

function iterationCallback(node) {
  const call = methodCall(node);
  if (!call || !ITERATION_METHODS.has(call.name)) return null;
  const callback = call.args[0];
  if (!FUNCTION_KINDS.has(callback?.type)) return null;
  return {
    callback,
    receiver: call.receiver,
    iterations: exactIterationCount(call.receiver),
  };
}

function directHandler(source) {
  try {
    const expression = parseExpressionAt(source, 0, {
      ecmaVersion: 'latest',
      locations: true,
    });
    return FUNCTION_KINDS.has(expression.type) ? [expression] : [];
  } catch {
    return [];
  }
}

function exportedHandlers(source, exportName) {
  let program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
    });
  } catch {
    return [];
  }
  const handlers = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      node.type === 'FunctionDeclaration'
      && node.id?.name === exportName
    ) handlers.push(node);
    if (
      node.type === 'VariableDeclarator'
      && node.id?.name === exportName
      && FUNCTION_KINDS.has(node.init?.type)
    ) handlers.push(node.init);
    if (
      node.type === 'Property'
      && propertyName(node) === exportName
      && FUNCTION_KINDS.has(node.value?.type)
    ) handlers.push(node.value);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      } else if (value && typeof value === 'object') {
        walk(value);
      }
    }
  };
  walk(program);
  return handlers;
}

function analyzeHandler(handler) {
  const ctxName = handler.params?.[0]?.type === 'Identifier'
    ? handler.params[0].name
    : null;
  if (ctxName === null) return [];
  const candidates = [];
  const seen = new Set();
  const record = (node, contexts, conditional) => {
    if (conditional) return;
    const evidence = repetitionEvidence(contexts);
    if (!evidence) return;
    const candidate = pointGetCandidate(node, ctxName)
      ?? completeUniqueCandidate(node, ctxName);
    if (!candidate) return;
    const line = node.loc?.start.line ?? 1;
    const column = (node.loc?.start.column ?? 0) + 1;
    const identity = `${candidate.lookup}\0${candidate.table}\0${candidate.index ?? ''}\0${line}\0${column}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    candidates.push({
      ...candidate,
      line,
      column,
      loopIterations: evidence.iterations,
    });
  };
  const visit = (node, contexts, conditional = false, root = false) => {
    if (!node || typeof node !== 'object') return;
    if (!root && FUNCTION_KINDS.has(node.type)) return;
    if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
      visit(node.left, contexts, conditional);
      visit(node.right, contexts, conditional);
      visit(
        node.body,
        [...contexts, loopContext(exactIterationCount(node.right))],
        conditional,
      );
      return;
    }
    if (node.type === 'ForStatement') {
      visit(node.init, contexts, conditional);
      visit(node.test, contexts, conditional);
      visit(node.update, contexts, conditional);
      visit(node.body, [...contexts, loopContext(exactForIterationCount(node))], conditional);
      return;
    }
    if (node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
      visit(node.test, contexts, conditional);
      visit(node.body, [...contexts, loopContext(null)], conditional);
      return;
    }
    if (node.type === 'IfStatement') {
      visit(node.test, contexts, conditional);
      const guarded = conditional || contexts.length > 0;
      visit(node.consequent, contexts, guarded);
      visit(node.alternate, contexts, guarded);
      return;
    }
    if (node.type === 'SwitchStatement') {
      visit(node.discriminant, contexts, conditional);
      const guarded = conditional || contexts.length > 0;
      for (const branch of node.cases) {
        visit(branch.test, contexts, guarded);
        for (const statement of branch.consequent) visit(statement, contexts, guarded);
      }
      return;
    }
    if (node.type === 'ConditionalExpression') {
      visit(node.test, contexts, conditional);
      const guarded = conditional || contexts.length > 0;
      visit(node.consequent, contexts, guarded);
      visit(node.alternate, contexts, guarded);
      return;
    }
    if (node.type === 'LogicalExpression') {
      visit(node.left, contexts, conditional);
      visit(node.right, contexts, conditional || contexts.length > 0);
      return;
    }
    if (node.type === 'CallExpression') {
      record(node, contexts, conditional);
      const iteration = iterationCallback(node);
      if (iteration) {
        visit(iteration.receiver, contexts, conditional);
        for (const argument of node.arguments.slice(1)) visit(argument, contexts, conditional);
        visit(
          iteration.callback.body,
          [...contexts, loopContext(iteration.iterations)],
          conditional,
          true,
        );
        return;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) visit(child, contexts, conditional);
      } else if (value && typeof value === 'object') {
        visit(value, contexts, conditional);
      }
    }
  };
  visit(handler, [], false, true);
  return candidates;
}

function schemaProvesCandidate(candidate, tables) {
  if (candidate.lookup === 'get') return tables[candidate.table] ? candidate : null;
  const index = tables[candidate.table]?.indexes?.find(
    (entry) => entry.name === candidate.index
      && entry.unique === true
      && entry.whereApplicable === undefined,
  );
  if (!index || index.fields.length !== candidate.equalityFields.length) return null;
  const expected = [...index.fields].sort();
  const actual = [...candidate.equalityFields].sort();
  return expected.every((field, position) => field === actual[position]) ? candidate : null;
}

function mappedSourceSpan(candidate, sourceSpan, sourcePosition) {
  if (sourcePosition) return sourcePosition(candidate.line, candidate.column);
  if (!sourceSpan) return null;
  return {
    file: sourceSpan.file,
    line: sourceSpan.line + candidate.line - 1,
    column: candidate.line === 1
      ? sourceSpan.column + candidate.column - 1
      : candidate.column,
  };
}

// @ref LLP 0248#d4-dependency-and-cost-evidence-remain-conservative — this
// warning observes a repeated exact-lookup shape and points to the explicit
// batch surface; it never rewrites the handler or changes read admission.
// @ref LLP 0178#1-two-lanes — only an unconditional per-iteration lookup is
// eligible; unknown loop cardinality remains advisory rather than becoming a
// validation claim.
export function nPlusOneBatchReadAdvisories({
  source,
  exportName = null,
  direct = false,
  sourceSpan = null,
  sourcePosition = null,
  functionName,
  tables,
}) {
  if (!source) return [];
  const handlers = direct ? directHandler(source) : exportedHandlers(source, exportName);
  return handlers
    .flatMap(analyzeHandler)
    .map((candidate) => schemaProvesCandidate(candidate, tables))
    .filter(Boolean)
    .map((candidate) => {
      const batchMethod = candidate.lookup === 'get' ? 'getMany' : 'uniqueMany';
      const lookup = candidate.lookup === 'get'
        ? 'ctx.db.get'
        : `a complete unique lookup through ${candidate.table}.${candidate.index}`;
      const mapped = mappedSourceSpan(candidate, sourceSpan, sourcePosition);
      const precondition = {
        function: functionName,
        lookup: candidate.lookup,
        authority: candidate.authority,
        table: candidate.table,
        ...(candidate.index === null ? {} : { index: candidate.index }),
        threshold: N_PLUS_ONE_BATCH_READ_THRESHOLD,
      };
      return {
        code: 'SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ',
        severity: 'warning',
        subsystem: 'codegen',
        message: `${functionName}: ${lookup} appears unconditionally inside a loop that can perform at least ${N_PLUS_ONE_BATCH_READ_THRESHOLD} same-table point reads; collect the exact inputs and use ctx.db.${batchMethod} to make one bounded host call (guide/backend/queries.md#batch-exact-lookups-in-one-host-call).`,
        function: functionName,
        ...(mapped ? { sourceSpan: mapped } : {}),
        details: {
          analysis: 'static-loop-exact-lookup.v1',
          lookup: candidate.lookup,
          authority: candidate.authority,
          table: candidate.table,
          ...(candidate.index === null ? {} : { index: candidate.index }),
          threshold: N_PLUS_ONE_BATCH_READ_THRESHOLD,
          loopCardinality: candidate.loopIterations ?? 'unknown',
          suggestedMethod: batchMethod,
          proof: candidate.lookup === 'get'
            ? 'literal-table-point-get'
            : 'literal-table-complete-declared-unique-index',
          remediations: [{
            kind: 'guidePointer',
            pageId: 'backend.queries',
            path: 'guide/backend/queries.md',
            anchor: 'batch-exact-lookups-in-one-host-call',
            reason: 'Replace repeated same-table exact lookups with one bounded batch-read call.',
            riskClass: 'performance',
            machineApplicable: false,
            requiresApproval: false,
            authorityEffect: 'none',
            precondition,
            description: 'Collect the loop\'s exact inputs and issue one bounded batch-read call.',
          }],
        },
      };
    });
}
