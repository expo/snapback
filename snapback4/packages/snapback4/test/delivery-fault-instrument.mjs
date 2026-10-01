// Test-only await census and instrumentation. No hooks enter the shipped client.
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const scope = {
  'local.ts': ['flush', 'flushOnce', 'call', 'captureStore', 'refreshAcquired', 'sendPost', 'syncRound', 'probe', 'waitForChange', 'follow', 'replayOnOpen', 'listenForExit', 'commit', 'read', 'lookup', 'save'],
  'local-receipts.ts': '*',
  'writes.ts': ['keep', 'acknowledged', 'persistPending', 'read', 'lookup'],
  'local-exit.ts': '*',
  'local-exit-settlement.ts': '*',
  'local-assets.ts': ['call', 'home', 'save', 'drop', 'check'],
  'request-wait.ts': '*',
  'local-sync.ts': ['legacyInput', 'syncTransport'],
  'device-restore.ts': '*',
  'local-backend.ts': '*',
  'local-native.ts': '*',
  'pending-writes.ts': ['revision', 'record'],
  'clock.ts': ['wrapped', 'save'],
  'changes.ts': '*',
  'local-search.ts': '*',
  'local-query.ts': ['route'],
  // LLP 3000.031 boundary review: publish's new pending() wait is query-only;
  // LocalReads.readQueued awaits the existing local-receipts readQueued I/O
  // (instrumented above) before updating an in-memory existence cache. Neither
  // adds delivery I/O or absorbs failures. read-existence.test.mjs exercises
  // rejection and incarnation/revision fencing at both new continuation sites.
  // client.ts changes only erased generic arguments; read-existence is sync.
  // The shared decoder now owns both mutation-body I/O and optional query
  // decoding. Retry waits/send calls remain covered by their caller awaits.
  'http-response.ts': ['readResponse'],
};
function name(node) {
  if (node.name) return node.name.getText();
  if (ts.isBinaryExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.left)) return node.parent.left.name.getText();
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) return node.parent.name.getText();
}
export function census() {
  const sites = [], iterators = [], additional = [];
  for (const [file, functions] of Object.entries(scope)) {
    const source = readFileSync(join(packageRoot, 'src', file), 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const counts = new Map();
    function visit(node, owner = '') {
      if (ts.isFunctionLike(node)) owner = name(node) ?? owner;
      if (ts.isAwaitExpression(node) && (functions === '*' || functions.includes(owner) || (file === 'local-assets.ts' && owner === 'remove'))) {
        const expression = node.expression.getText(tree).replace(/\s+/g, ' ');
        const key = `${file}:${owner}:${expression}`;
        const n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
        (file === 'local-assets.ts' && owner === 'remove' ? additional : sites).push({ id: `${key}#${n}`, file, owner, expression, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, start: node.getStart(), end: node.end });
      }
      if (ts.isForOfStatement(node) && node.awaitModifier && (functions === '*' || functions.includes(owner))) { const expression = node.expression.getText(tree); iterators.push({id:`${file}:${owner}:for await ${expression}`,file,owner,expression,line:tree.getLineAndCharacterOfPosition(node.getStart()).line+1,start:node.getStart(),end:node.end,iterator:true}); }
      ts.forEachChild(node, child => visit(child, owner));
    }
    visit(tree);
  }
  return [...sites, ...iterators, ...additional];
}
export function instrument(destination) {
  mkdirSync(destination, { recursive: true });
  cpSync(join(packageRoot, 'dist'), join(destination, 'dist'), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(destination, 'package.json'));
  for (const [file] of Object.entries(scope)) {
    const sites = census().filter(site => site.file === file);
    let source = readFileSync(join(packageRoot, 'src', file), 'utf8');
    if (file === 'local.ts') source = source.replace('  return client;\n  } catch (error)', '  globalThis.__rgClient = { flush, flushOnce, syncOnce, probe, sendPost, installNative, nativeFixture() { backend = {...backend, programs: [...backend.programs, {native: true}]}; }, setOffline() { setLink("offline"); }, replayOnOpen, call, history, media, clock, listenForExit, waitForChange, captureStore, get retryMs() { return retryMs; }, get retry() { return retry; }, setReconcile() { reconcileNeeded = true; }, allowSending() { sendingAllowed = true; }, setExit(p) { exitDone = p; }, queryFixture(plan, native = false, missing = false) { nativeReady = false; backend = {...backend, schema: {...backend.schema, operations: {...backend.schema.operations, matrixQuery: plan ? {search: plan} : {}}}, programs: [...backend.programs.filter(p => p.name !== "matrixQuery"), ...(missing ? [] : [{name: "matrixQuery", kind: "Query", args: {}, body: [{Return: {Literal: {String: "matrix"}}}], native}])]}; }, setCaughtUp(v) { caughtUp = v; }, setIdentity(v) { identityChecked = v; } };\n  return client;\n  } catch (error)');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const byStart = new Map(sites.map(site => [site.start, site]));
    const transformer = context => root => {
      const visit = node => {
        const site = (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) && byStart.get(node.getStart(tree));
        if(site?.iterator) return ts.factory.updateForOfStatement(node,node.awaitModifier,node.initializer,ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'),'__rgIterate'),undefined,[ts.factory.createStringLiteral(site.id),node.expression]),ts.visitNode(node.statement,visit));
        if (site) return ts.factory.createAwaitExpression(ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'), '__rgAwait'), undefined,
          [ts.factory.createStringLiteral(site.id), ts.factory.createArrowFunction(undefined, undefined, [], undefined,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.visitNode(node.expression, visit))]));
        if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && (['json','arrayBuffer'].includes(node.expression.name.text) || ['reader.read','reader.cancel'].includes(node.expression.getText(tree)))) return ts.factory.createCallExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globalThis'),'__rgIO'),undefined,[ts.factory.createArrowFunction(undefined,undefined,[],undefined,ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),ts.visitEachChild(node,visit,context))]);
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit);
    };
    const result = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true }, transformers: { before: [transformer] } });
    writeFileSync(join(destination, 'dist', file.replace('.ts', '.js')), file === 'local.ts' ? result.outputText.replace('const sendOnExit = exitTransport(', 'const sendOnExit = globalThis.__rgExit = exitTransport(') : result.outputText);
  }
}

// identity-admission.ts waits before custody/transport. Its final read and FIFO
// wait are covered by admit-before-identity: replacement, rejection, deadline,
// remaining budget across predecessor identity/admission intervals, and late completion
// without custody. Browser transaction pins are tested after synchronous capture.
// Ordinary admission and delivery retain the required sites below.
// Conservative boundary seal: any new/changed await anywhere in the client must
// be reviewed for delivery reachability, even in a new module or helper owner.
// worker.ts and worker-ledger.ts perform server effects, outside device mutation
// delivery. Their new awaits are covered by supervised-workers/worker tests:
// lost acknowledgements, durable replay, failed handlers and process contention.
// local-following.pending and local-query.publish's followingPending await read
// existing outbox custody before query publication; neither admits, dispatches,
// settles nor observes a write. Failure withholds the read. The causal Following
// regression covers admission/settlement/apply, including zero-wait retirement;
// mutation delivery continues through the unchanged classified sites above.
// RX v2: delivery.ts adds one maintenance transport await after RUNS_FULL.
// It cannot acknowledge delivery: only the later report records coverage.
// delivery.test.mjs injects lost/refused/unaccepted maintenance and a stale
// incarnation reply; delivery-integrated exercises real fingerprint-bound
// dispatch. The existing outbox delivery matrix sites stay unchanged.
// QS (LLP 3000.023 §11): query-settlement awaits raw evaluation, facade
// authority and retry pauses. Local query's new queued() wait reads existing
// custody; it cannot admit, send or settle a write. Failure refuses the query.
// Raw publication and delivery acceptance run synchronously after these waits;
// one-shot/one-shot-bounds and delivery-publication cover stale/expired/closed
// continuations and ignored abort. No delivery fault site or recipe changed.
// node-fetch's two new awaits are below the classified doFetch boundaries.
// keepalive-retry exercises a committed mutation with a lost reply, identical
// ID/body/authority snapshots, exhausted retry, fresh failures and partial-response failure.
// No outbox admission, settlement, persistence or publication await is added.
// PR round 3: captureStore before an observation with a notified cut is a
// read-only watermark check. It does not admit, send, settle or persist writes;
// incarnation/publication/signal fences still qualify its subsequent evaluation.
// PRL (LLP 3000.023 §10): the existing online refresh await now captures
// batch eligibility in its synchronous accept callback before scheduleExpiry.
// The 58 client awaits and their I/O are unchanged. No delivery admission,
// dispatch, custody or settlement is added, and offerDelivery still runs
// synchronously before the optional subscriber notification batch. Per-row
// boundary tests cover both row deadlines and the retiring episode; the
// delivery matrix retains all existing sites, classifications and recipes.
export function awaitBoundary() {
  const root = join(packageRoot, 'src');
  return Object.fromEntries(readdirSync(root, { recursive: true }).filter(file => file.endsWith('.ts')).sort().map(file => {
    const tree = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true), awaits = [];
    function visit(node) {
      if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) awaits.push(node.getText(tree).replace(/\s+/g, ' '));
      ts.forEachChild(node, visit);
    }
    visit(tree);
    return [file, { count: awaits.length, sha256: createHash('sha256').update(JSON.stringify(awaits)).digest('hex') }];
  }));
}
