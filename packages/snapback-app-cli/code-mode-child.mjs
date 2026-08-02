// Untrusted-input script host for LLP 0062 §3. This process owns no client,
// target URL, bearer, credential profile, or inherited environment secret.

import vm from 'node:vm';
import { inspect } from 'node:util';
import ts from 'typescript';

const PROTOCOL = 1;
const pending = new Map();
let nextCallId = 1;
let nextSubscriptionId = 1;
let abortController;
let timers = new Set();
let teardown = false;
let runComplete = false;
const liveSubscriptions = new Map();

const send = (frame) => process.send?.({ protocolVersion: PROTOCOL, ...frame });
const fail = (code, exitCode) => Object.freeze({ code, exitCode });

class BrokerError extends Error {
  constructor(record) {
    super(record.code);
    this.name = 'SnapbackBrokerError';
    this.code = record.code;
    this.exitCode = record.exitCode;
    if (record.subsystem !== undefined) this.subsystem = record.subsystem;
    Object.freeze(this);
  }
}

const importsAreTypeOnly = (node) => node.importClause?.isTypeOnly === true
  || (node.importClause?.name === undefined
    && node.importClause?.namedBindings?.elements?.length > 0
    && node.importClause.namedBindings.elements.every((element) => element.isTypeOnly));

const strictWalk = (value, seen, path) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path}: number`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path}: ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`${path}: cycle`);
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${path}: symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${path}: hidden/accessor`);
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError(`${path}: sparse/named`);
    }
    value.forEach((item, index) => strictWalk(item, seen, `${path}[${index}]`));
  } else {
    const prototype = Object.getPrototypeOf(value);
    const plain = prototype === null
      || (prototype?.constructor?.name === 'Object' && Object.getPrototypeOf(prototype) === null);
    if (!plain || Object.hasOwn(value, 'toJSON')) throw new TypeError(`${path}: prototype`);
    for (const [key, item] of Object.entries(value)) strictWalk(item, seen, `${path}.${key}`);
  }
  seen.delete(value);
};

const prepareSource = (source, sourceName) => {
  const file = ts.createSourceFile(sourceName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) throw new BrokerError(fail('SNAPBACK_APP_CLI_SCRIPT_ERROR', 10));
  let defaultExport = null;
  const erasedRanges = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      if (!importsAreTypeOnly(node)) throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
      erasedRanges.push([node.getFullStart(), node.end]);
      return;
    }
    if (ts.isExportDeclaration(node) && node.isTypeOnly) {
      erasedRanges.push([node.getFullStart(), node.end]);
      return;
    }
    if (ts.isExportAssignment(node)) {
      if (node.parent !== file || node.isExportEquals || defaultExport !== null) {
        throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
      }
      defaultExport = node;
    }
    if ((ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) {
      throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
    }
    if (ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)
      || ts.isImportEqualsDeclaration(node) || ts.isJsxElement(node)
      || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
      || (ts.isParameter(node) && (ts.getModifiers(node) ?? []).some((modifier) => [
        ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword,
      ].includes(modifier.kind)))) {
      throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
    }
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const edits = [...erasedRanges];
  if (defaultExport !== null) {
    edits.push([
      defaultExport.getStart(file),
      defaultExport.end,
      `const __snapback_default = (${source.slice(defaultExport.expression.getStart(file), defaultExport.expression.end)});`,
    ]);
  }
  let rewritten = source;
  for (const [start, end, replacement = ''] of edits.sort((left, right) => right[0] - left[0])) {
    rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(end)}`;
  }
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      verbatimModuleSyntax: true,
      sourceMap: false,
      inlineSourceMap: false,
      removeComments: false,
    },
    fileName: sourceName,
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new BrokerError(fail('SNAPBACK_APP_CLI_SCRIPT_ERROR', 10));
  }
  const emitted = ts.createSourceFile('emitted.js', transpiled.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (emitted.statements.some((node) => ts.isImportDeclaration(node)
    || ts.isExportDeclaration(node) || ts.isExportAssignment(node))) {
    throw new BrokerError(fail('SNAPBACK_APP_CLI_USAGE', 2));
  }
  return Object.freeze({
    code: `${transpiled.outputText}\nreturn ${defaultExport === null ? 'undefined' : 'await __snapback_default'};`,
    hasDefault: defaultExport !== null,
  });
};

const call = (functionId, args = {}, options = {}) => {
  if (teardown) return Promise.reject(new BrokerError(fail('SNAPBACK_APP_CLI_SCRIPT_ERROR', 10)));
  const callId = nextCallId;
  nextCallId += 1;
  const promise = new Promise((resolve, reject) => pending.set(callId, { resolve, reject }));
  send({ type: 'call', callId, functionId, args, timeoutMs: options?.timeoutMs ?? null });
  return promise;
};

const liveIterable = (functionId, args, options) => Object.freeze({
  [Symbol.asyncIterator]() {
    const subscriptionId = nextSubscriptionId;
    nextSubscriptionId += 1;
    let opened = false;
    let closed = false;
    const state = {
      queue: [],
      waiters: [],
      opened: null,
      resolveOpened: null,
      rejectOpened: null,
      terminalError: null,
      close: null,
      resolveClose: null,
    };
    state.opened = new Promise((resolve, reject) => {
      state.resolveOpened = resolve;
      state.rejectOpened = reject;
    });
    liveSubscriptions.set(subscriptionId, state);
    const ensureOpen = async () => {
      if (!opened) {
        opened = true;
        send({ type: 'liveOpen', subscriptionId, functionId, args, timeoutMs: options?.timeoutMs ?? null });
      }
      await state.opened;
    };
    const close = async () => {
      if (closed) return;
      closed = true;
      if (!opened || teardown || state.terminalError !== null) {
        liveSubscriptions.delete(subscriptionId);
        return;
      }
      state.close = new Promise((resolve) => { state.resolveClose = resolve; });
      send({ type: 'liveClose', subscriptionId });
      await state.close;
      liveSubscriptions.delete(subscriptionId);
    };
    return Object.freeze({
      async next() {
        if (closed) return { done: true, value: undefined };
        await ensureOpen();
        if (state.terminalError !== null) throw state.terminalError;
        if (state.queue.length > 0) return { done: false, value: state.queue.shift() };
        return new Promise((resolve, reject) => state.waiters.push({ resolve, reject }));
      },
      async return() { await close(); return { done: true, value: undefined }; },
    });
  },
});

const apiFunction = (fn) => Object.freeze((args = {}, options = {}) => (
  fn.kind === 'liveQuery' ? liveIterable(fn.id, args, options) : call(fn.id, args, options)
));

const scriptConsole = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug'].map((level) => [level, Object.freeze((...values) => {
    send({ type: 'console', level, text: values.map((value) => (typeof value === 'string'
      ? value
      : inspect(value, { depth: 4, maxArrayLength: 100, maxStringLength: 16_384 }))).join(' ') });
  })]),
)));

const run = async (start) => {
  abortController = new AbortController();
  const functions = new Map(start.functions.map((fn) => [fn.id, fn]));
  const api = Object.create(null);
  for (const alias of start.aliases) api[alias.name] = apiFunction(functions.get(alias.id));
  Object.freeze(api);
  const snapback = Object.freeze(Object.assign(Object.create(null), {
    envelopeHash: start.envelopeHash,
    function(id) {
      const fn = functions.get(id);
      if (!fn) throw new BrokerError(fail('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 4));
      return apiFunction(fn);
    },
  }));
  const context = vm.createContext(Object.create(null), {
    name: 'snapback-code-mode',
    codeGeneration: { strings: false, wasm: false },
  });
  const trackedSetTimeout = (callback, delay, ...values) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(...values); }, delay);
    timers.add(timer);
    return timer;
  };
  const trackedClearTimeout = (timer) => { timers.delete(timer); clearTimeout(timer); };
  const prepared = prepareSource(start.script, start.scriptSource === 'stdin' ? 'stdin.ts' : 'script.ts');
  const wrapper = new vm.Script(`(async (api, snapback, args, signal, console, setTimeout, clearTimeout) => {\n${prepared.code}\n})`, {
    filename: start.scriptSource,
  });
  const execute = wrapper.runInContext(context, { timeout: Math.min(30_000, start.defaultCallTimeoutMs) });
  const value = await execute(api, snapback, Object.freeze([...start.args]), abortController.signal, scriptConsole, trackedSetTimeout, trackedClearTimeout);
  if (prepared.hasDefault) strictWalk(value, new Set(), 'result');
  const snapshot = structuredClone(value);
  send({ type: 'settled', hasValue: prepared.hasDefault, value: snapshot });
};

process.on('message', (frame) => {
  if (frame?.protocolVersion !== PROTOCOL) return;
  if (frame.type === 'callResult') {
    const continuation = pending.get(frame.callId);
    if (!continuation) return;
    pending.delete(frame.callId);
    if (frame.ok) continuation.resolve(frame.value);
    else continuation.reject(new BrokerError(frame.error));
    return;
  }
  if (frame.type === 'liveOpened') {
    const state = liveSubscriptions.get(frame.subscriptionId);
    if (!state) return;
    if (frame.ok) state.resolveOpened();
    else {
      const error = new BrokerError(frame.error);
      state.terminalError = error;
      state.rejectOpened(error);
      liveSubscriptions.delete(frame.subscriptionId);
    }
    return;
  }
  if (frame.type === 'liveValue') {
    const state = liveSubscriptions.get(frame.subscriptionId);
    if (!state) return;
    const waiter = state.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value: frame.value });
    else state.queue.splice(0, state.queue.length, frame.value);
    return;
  }
  if (frame.type === 'liveTerminal') {
    const state = liveSubscriptions.get(frame.subscriptionId);
    if (!state) return;
    const error = new BrokerError(frame.error);
    state.terminalError = error;
    state.queue = [];
    state.rejectOpened(error);
    for (const waiter of state.waiters) waiter.reject(error);
    state.waiters = [];
    liveSubscriptions.delete(frame.subscriptionId);
    return;
  }
  if (frame.type === 'liveClosed') {
    const state = liveSubscriptions.get(frame.subscriptionId);
    state?.resolveClose?.();
    return;
  }
  if (frame.type === 'abort') {
    teardown = true;
    abortController?.abort(frame.reason);
    for (const timer of timers) clearTimeout(timer);
    timers = new Set();
    for (const continuation of pending.values()) continuation.reject(new BrokerError(fail('SNAPBACK_APP_CLI_SCRIPT_ERROR', 10)));
    pending.clear();
    for (const state of liveSubscriptions.values()) {
      const error = new BrokerError(fail('SNAPBACK_APP_CLI_SCRIPT_ERROR', 10));
      state.rejectOpened(error);
      for (const waiter of state.waiters) waiter.reject(error);
      state.resolveClose?.();
    }
    liveSubscriptions.clear();
    if (runComplete) queueMicrotask(() => send({ type: 'done' }));
    return;
  }
  if (frame.type === 'start') {
    run(frame).catch((error) => {
      send({ type: 'failed', error: fail(error?.code ?? 'SNAPBACK_APP_CLI_SCRIPT_ERROR', error?.exitCode ?? 10) });
    }).finally(() => {
      runComplete = true;
      if (teardown) send({ type: 'done' });
    });
  }
});
