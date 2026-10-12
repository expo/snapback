// Test-only await census and instrumentation. No hooks enter the shipped client.
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
// These calls can return work created outside the caller's async context.
// Drain that work before evaluating the classified call, without yielding
// between the idle check and evaluation. The timer case needs a failed sync
// input; it therefore uses the same barrier at follow's preceding sync await.
export const sharedAwaits = new Map([
  ['local.ts:follow:network.once()#1', 'sync'],
  ['local.ts:flushOnce:network.once()#1', 'sync'],
  ['local-receipts.ts:syncSettledWrites:sync()#1', 'sync'],
  ['local.ts:syncRound:installNative(aborter.signal)#1', 'native'],
  ['local-query.ts:route:env.installNative(env.signal)#1', 'native'],
]);
export const followSync = 'local.ts:follow:network.once()#1';
export const followRetry = 'local.ts:follow:new Promise((r) => setTimeout(r, 1000))#1';
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
    if (file === 'local.ts') source = source.replace('  return client;\n  } catch (error)', '  globalThis.__rgClient = { get syncing() { return network.current; }, flush, flushOnce, syncOnce: network.once, probe, sendPost, installNative, nativeFixture() { backend = {...backend, programs: [...backend.programs, {native: true}]}; }, setOffline() { setLink("offline"); }, replayOnOpen, call, history, media, clock, listenForExit, waitForChange, captureStore, get retryMs() { return retryMs; }, get retry() { return retry; }, setReconcile() { reconcileNeeded = true; }, allowSending() { sendingAllowed = true; }, setExit(p) { exitDone = p; }, queryFixture(plan, native = false, missing = false, retention = false) { nativeReady = false; if(retention) backend = {...backend, schema: {...backend.schema, tables: {...backend.schema.tables, messages: {...backend.schema.tables.messages, leave: "delivered-history"}}}}; backend = {...backend, schema: {...backend.schema, operations: {...backend.schema.operations, matrixQuery: plan ? {search: plan} : {}}}, programs: [...backend.programs.filter(p => p.name !== "matrixQuery"), ...(missing ? [] : [{name: "matrixQuery", kind: "Query", args: {}, body: [{Return: {Literal: {String: "matrix"}}}], native}])]}; }, setCaughtUp(v) { caughtUp = v; }, setIdentity(v) { identityChecked = v; } };\n  return client;\n  } catch (error)');
    if (file === 'local-native.ts') source = source.replace('  return installNative;', '  globalThis.__rgNativePending = () => nativeInstall?.promise;\n  return installNative;');
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
// RO revision 4 removes read-session successor/rotation waits from app.ts,
// client.ts and read-only.ts. The remaining read scope probe is unchanged;
// app-revocations.ts only drops successor comparisons inside existing awaits.
// Read mode constructs no delivery owners. Full-session awaits and every
// classified delivery site/recipe are unchanged; no new delivery I/O is added.
// IT: syncRound's final queued() refreshes the pending predicate after every
// apply, including an unchanged page. It uses existing readQueued custody I/O;
// it cannot admit, dispatch or settle a new write. The ordinary delivery recipe
// injects transient/persistent read failure at this optional sync boundary.
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
// BG (LLP 3000.013 §6): app.authorized replaces three authority reads with
// readScope's one fresh, locked IndexedDB snapshot. Its open/commit awaits
// remain before facade approval or scoped HTTP dispatch, below the existing
// classified doFetch boundaries; they admit, settle and persist no delivery.
// Failure withholds the read/dispatch. web-session-authority covers successful
// gets followed by transaction abort, peer logout and stale mirror fencing.
// No outbox fault site, required/optional classification or recipe changes.
// BG round 1: committed IndexedDB authority calls queued before a read starts
// join one check. The batch clears before lock acquisition. Memory/native and
// preparing scopes keep their original awaited persistence path, preventing a
// held journal admission from overtaking the first request's check. The await
// now lives in checkAuthority; no outbox custody await or recipe changes.
// Lane B (LLP 3000.019 §3.3.1): pending-items/pending-writes and the online
// presentation readers await only existing outbox, history and authority reads.
// WriteHistory.presentationReceipts reads without keep/recovery or retention
// refresh. These paths have no dispatch, admission, settlement or persistence
// authority; pending-items tests cover read failure/retirement and scope races.
// Round 2: the existing app-online settle/change callback also synchronizes
// presentation references and admission order before copying terminal arguments.
// Those synchronous operations change the enclosing await's text, without adding
// I/O, custody writes or a new await. Delivery scopes/recipes remain unchanged.
// RH (LLP 3000.028 §3.2): pendingRoute reads the applied watermark before a
// whole query answer can replace current/retained device history. Its callers
// only route query candidates; none admits, dispatches, persists or settles a
// write. Rejection withholds the read and rechecks session/incarnation fences.
// retained-history-order tests cover success/rejection and publication races;
// real held-apply cases cover both device hosts. No delivery site/recipe changes.
// RH round 1: the additional search query await is optional read I/O, with a dedicated
// pending-leave recipe (161), and cannot acquire mutation delivery custody.
// FH round 2 (LLP 3000.026 §9.10): following/following-transport await only
// session authority, the read protocol and mounted-card refresh. Their server
// state is volatile read custody; they cannot admit, dispatch or settle an app
// mutation. The new client/local transport awaits are the same read-only path;
// local's pending wait reads existing own-edge custody before and after it.
// Failures withhold history and retry the same unit token. following-history
// covers a lost committed response, delayed reply across unfollow, bearer
// revocation, expiry, and own-post admission on both device hosts. The new
// historyWrite wrapper adds only a synchronous fence around the unchanged
// mutation path. No delivery I/O site, classification or fault recipe changes.
// FH round 4: bounded authorization/live refresh slices are the same read-only
// protocol; no mutation custody is acquired. A dropped-unit scheduling test
// covers jittered retries while online. No delivery recipe changes.
// UA (LLP 3000.008.002.000 §6): app-client's asset await forwards private
// progress through readAsset; assets/client/local append that observer to the
// existing download await. Counts and delivery sites are unchanged. These
// asset reads cannot admit, send or settle mutations. asset-progress has no
// awaits or storage; it names waits without cancelling/replaying them. Native
// Blob lifecycle and React asset tests cover conversion, session custody and
// late outcomes. No delivery scope, classification or fault recipe changes.
// UA round 1 adds hostBlob's await of the existing public response.blob() I/O
// to distinguish completed-body conversion from transport failure. The readBlob
// callback now forwards byte progress; no mutation or persistence I/O is added.
// UA round 2 keeps that same blob await, using a separate call receiver for
// sealed responses. No new await, mutation delivery scope or fault recipe.
// RO Round 7: read-token.ts is a synchronous prefix predicate with zero awaits.
// It adds no I/O or custody; delivery sites and fault recipes remain unchanged.
// RO (LLP 3000.033 §1.4): app owns both namespaces through one custody
// state machine; read policy awaits scope verification and serialized .read I/O.
// read-only's gate and cancelled-rotation cleanup probe before admitting any
// read or own-session logout. Neither module constructs delivery/write custody.
// auth adds scoped sign-in and narrow response I/O. The read branch in client
// gates existing query/asset/refresh I/O and fences late rotation successors;
// full-client delivery still reaches the unchanged classified transport sites.
// local's new device admission check is synchronous, before all host I/O.
// read-only.test covers held/rejected probes, rotation/cancellation, store races
// and local refusals; read-only-server covers real receipt invariance and HTTP
// barriers. RO Round 1's read-custody hook awaits only the .read slot; public
// session callbacks remain notifications. The new custody regression covers
// held storage, permanent facade withdrawal and retry of a private successor.
// No outbox await, classification or fault recipe changes.
// RO Round 2 removes the parallel app implementation. Shared app awaits now
// include a private successor receipt under the session lock and the scope gate
// before commit. Retirement probes read-namespace credentials before logout.
// These awaits cannot acquire delivery/outbox custody; full-session awaits and
// all delivery classifications/recipes retain their existing roles.
// RO Round 3: explicit logout reads the committed epoch under the custody lock;
// the other four new waits recover a peer's read-only successor before dispatch.
// They touch session storage and scope verification, never delivery/outbox I/O.
// Real-server peer-rotation tests cover delayed rejection and logout/replacement;
// app tests and full-count session models cover storage faults and deferred
// retirement. Existing delivery sites, classifications and recipes are unchanged.
// RO Round 4: rotation selection and successor commit each await the session
// lock, with the network awaited under a separate rotation lock. Logout removes
// its epoch ownership comparison. Sign-in captures principal sign-out watermarks;
// stale logout preserves another account while saving its caller's watermark.
// These are auth-only waits; read clients have
// no delivery/outbox owner. Held-response self/peer logout and full-session
// controls cover the split; delivery sites and fault recipes are unchanged.
// RO Round 5: rejected read peers wait for the rotation owner and recheck
// custody through the existing refresh gate. These waits have no write owner;
// the new held-response tests cover both dispatch orders and independent logout.
// Epoch-only watermark collection adds no I/O or delivery fault site.
// UA round 4 merge: retain RO's scope-verification waits and OA's originating
// arm across shared dispatch/retries. The asset reader also retains UA progress.
// client.ts still has 62 awaits; only the combined text seal changes. No new
// I/O, delivery fault site, classification or recipe is introduced by resolution.
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

// FH round 3 merge: the RO and FH await families above both remain classified.
// Read-only Following refusal and refusal-poll suppression are synchronous;
// neither adds I/O, write custody, a delivery site or a fault recipe. The merged
// boundary is regenerated from both families, not selected from either parent.

// OA: app-online-arm adds no await or delivery persistence. It projects guarded
// server reads/signals/actions and drains returned calls before private close.
// app.ts keeps every authority/save await unchanged; the transport checks arm
// identity synchronously after its existing authority await. The held-call,
// rotation/account/logout and late-read tests live in app-online-arm.test.mjs.
// Existing delivery sites, recipe mappings and outbox custody stay unchanged.
// OA round 1: client and ephemeral await expressions carry the private arm
// fence into existing requests/retries; their await counts are unchanged.
// online-arm-fence is synchronous, memory-only metadata (no wire or storage
// shape changes). Both-tier lifecycle tests and the three Astra reproductions
// exercise retirement before dispatch and preservation after dispatch. No
// delivery I/O site, classification or fault recipe changes.

// FH round 5 + OA merge: keep both classifications. Argument-aware slicing
// replaces existing read-only Following awaits; online custody forwards that
// read transport and probes pendingWrites before/after it. The app's synchronous
// admission fence only notifies readers and observes the original promise's
// settlement: it adds no persistence or delivery site and preserves browser
// refusal fields. Following/app-online-arm tests cover the composed lifetime.

// FT: SN moved FIFO/sync coordination to LocalNetwork. The same classified
// follow/flush/receipt awaits still own transport and host I/O. Its sole new
// await joins the active round before an explicit reservation; joined-follow
// controls exercise both rejection and transport-false outcomes. SN query
// custody/dependency/settlement waits only observe existing outbox state and
// cannot dispatch or settle mutations. The six changed delivery expressions
// preserve their recipes; receipt settlement now passes the dispatch store.
// Current client/following/mock changes are query-only; session-refusal adds
// no await. Retain the complete boundary seal and all 162 delivery sites.

// SN round 6 (LLP 3000.023 §11): local query now explicitly awaits the same
// QueryCustody.wait, then rereads its blocked predicate before reusing the
// candidate. That predicate reads the existing queued()/readQueued boundary;
// successful-receipt acquisition still uses the classified syncRound sites.
// The facade awaits the raw wait and repeats its existing refusal()/check()
// authority read. These four continuation awaits add no admission, dispatch,
// receipt persistence or delivery acknowledgement. Failure withholds/refuses
// this query; it cannot revoke an already committed mutation outcome. Keep
// all 162 delivery sites and recipes unchanged. one-shot-bounds and the full
// online model cover race/deadline exhaustion; one-shot-discovery-auth's
// unchanged-row wakeup control proves the repeated asynchronous approval.

// 0.4.17 (createApp persona, browser write warnings): app-persona.ts's twelve
// awaits open the tier's own client (createLocalClient, whose delivery sites
// above are unchanged), probe /probe for a refused persona before signed-in,
// read that refusal's body, and await close()/ready on retirement. None admits,
// dispatches, persists or settles a write: persona writes route to the opened
// client's mutate and reach the classified local/online delivery sites as any
// other app's do. app-persona.test.mjs covers the loopback/name/serve refusals,
// the device and online tiers, and refused writes after logout. app.ts's prepareClient
// await only wraps the same synchronous createClient in sdkOwned (a counter
// that suppresses the bare-client browser warning); its count is unchanged.
// bin-path.ts has no awaits. No delivery site, classification or recipe changes.

// LLP 3000.013.000 (the device-less browser write journal): app-online.ts gains
// thirteen awaits and online-capture.ts one; app.ts five. None is on the
// device's delivery path classified above, and none dispatches or settles: the
// raw online transport's send, receipt and retry awaits are unchanged.
// app-online.ts: the captured admission's commit (journal lock, then session
// lock: the locked authority read, the journal read, the awaited admission
// body, the journal save) and its outcome; the recovery gate before a captured
// admission; recovery (the journal and session locks, candidates' Web Locks
// query, the authority reads, the journal read and save); the runtime lock's
// grant before custody returns. online-capture.ts: navigator.locks.query in
// candidates(). app.ts: the scope's /schema request, its body, awaiting that
// read, the identity wait raced against one second, and closing the raw client
// when the opening was cancelled meanwhile. Admission refusals stay
// synchronous; a failed commit keeps the localStorage record and its call
// pending. online-capture.test.mjs covers capture, bounds, refusals, markers,
// failed commits, recovery, ordering and saturation; online-journal-browser
// covers page loss, held responses, live and closed tabs and a full
// localStorage in Chromium. No delivery site, classification or recipe changes.
