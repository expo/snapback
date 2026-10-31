import '../../../scripts/test-npm-cache.mjs';
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
// Integration 13: REL3 adds an awaited transport wrapper that preserves every
// existing doFetch rejection, plus catalog-only fetch/JSON awaits in release.ts.
// These do not originate or settle delivery work; existing transport fault sites
// still exercise delivery failures. KIT changes only proof-host awaits.
// STAGE account provisioning awaits signup/operator setup outside application
// delivery custody; proof host token/setup waits are likewise not delivery I/O.
// REL2 retains those ten account-driver awaits while fencing identity retries
// on roster ownership. The new synchronous roster-lock module has no awaits;
// neither path originates or settles application delivery. Roster contention,
// dead-holder recovery and renewal-fenced retries have separate integration tests.
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
  'local-backend.ts': ['loadBackend'],
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
  'uploads.ts': '*',
  'assets.ts': ['uploadAsset'],
  'app-uploads.ts': '*',
  'web-upload-admission.ts': '*',
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
        // A1: this branch only polls read invalidations before core readiness or
        // after a core failure. It cannot admit, send, settle or persist writes;
        // progressive-start covers its logout/store/rollback fences. The full
        // boundary seal below still includes it. Preserve all delivery recipes.
        if (file === 'local.ts' && owner === 'follow' && expression === 'waitOnlineChange()') return;
        // A1d: these progressive-only fences can persist a proved rollback via
        // observe_store or the host's existing restore queue. The refusal
        // retires reads/replay before I/O; no write is admitted or acknowledged.
        // progressive-start proves first-sync and acquired-device persistence;
        // web-start injects a failed restore RPC and proves transaction retry
        // and close drain survive refill/reopen. Existing delivery recipes stay
        // below; these dedicated tests cover the new restore custody boundary.
        if (file === 'local.ts' && (owner === 'sendPost' && expression === 'onlineEvidence(json, onlineCapture)'
          || owner === 'syncRound' && expression === 'witnessRestore(page.store_id, head, onlineCapture, onlineCapture.watermark)')) return;
        // A1 review rounds 3-4: the same progressive-only restore custody, now also
        // fenced on post-attachment /changes and /probe against the head witnessed
        // online, and a direct host's retained restore proof retried before the next
        // device transaction (a failed retry fails that transaction; close rejects).
        // progressive-start proves both fences; web-start injects one and two failed
        // restore saves on a direct host. No ordinary delivery recipe changes.
        if (file === 'local.ts' && ((owner === 'waitForChange' || owner === 'probe')
            && expression === 'witnessRestore(json.store_id, Number(json.seq), onlineCapture, onlineCapture.watermark)'
          || owner === 'call' && expression === 'persistPendingProof()')) return;
        // The same dedicated restore tests own the helper's current-guard reads,
        // initial identity binding and refusal commit. The complete boundary
        // seal still records all six awaits; no ordinary delivery site is removed.
        if (file === 'device-restore.ts' && (owner === 'persistRestoreObservation' || owner === 'capture'
          || owner === 'restoreWitness' && expression.startsWith('persistOnline?.('))) return;
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
    if (file === 'local.ts') source = source.replace('  return refuseWatchGuess(client);\n  } catch (error)', '  globalThis.__rgClient = { get syncing() { return network.current; }, flush, flushOnce, syncOnce: network.once, probe, sendPost, installNative, nativeFixture() { backend = {...backend, programs: [...backend.programs, {native: true}]}; }, setOffline() { setLink("offline"); }, replayOnOpen, call, history, media, clock, listenForExit, waitForChange, captureStore, get retryMs() { return retryMs; }, get retry() { return retry; }, setReconcile() { reconcileNeeded = true; }, allowSending() { sendingAllowed = true; }, setExit(p) { exitDone = p; }, queryFixture(plan, native = false, missing = false, retention = false) { nativeReady = false; if(retention) backend = {...backend, schema: {...backend.schema, tables: {...backend.schema.tables, messages: {...backend.schema.tables.messages, leave: "delivered-history"}}}}; backend = {...backend, schema: {...backend.schema, operations: {...backend.schema.operations, matrixQuery: plan ? {search: plan} : {}}}, programs: [...backend.programs.filter(p => p.name !== "matrixQuery"), ...(missing ? [] : [{name: "matrixQuery", kind: "Query", args: {}, body: [{Return: {Literal: {String: "matrix"}}}], native}])]}; }, setCaughtUp(v) { caughtUp = v; }, setIdentity(v) { identityChecked = v; } };\n  return refuseWatchGuess(client);\n  } catch (error)');
    if (file === 'local.ts' && !source.includes('globalThis.__rgClient =')) throw Error('delivery fixture must expose the current client before its watch guard wrapper');
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
// Integration 16 boundary review: app-online's existing awaited custody save
// also recognizes E_DEV_RESET alongside the same unknown-outcome store refusals.
// No await, I/O or delivery ownership changes there; online-store-terminal and
// the real online-journal-browser reset cases cover retirement and reopen.
// KIT4's two new proof.ts awaits install a browser diagnostic binding and read
// visible headings after an observation deadline. They own proof/browser work,
// never mutation admission, persistence, dispatch or settlement. proof-contract
// and the packed proof-kit cases exercise their errors. Existing delivery sites,
// required/optional classifications and fault recipes remain unchanged.
// Lane B round 3: readCoreQueue/readDeviceHistory and attachment-failure
// recovery inspect the existing outbox/history; they admit, dispatch and
// persist nothing. The journal's existing dispatch wait now holds unknown
// custody through engine failure. Progressive-writes covers failed open,
// handshake, delayed listing, orphan adoption/version refusal and same-id
// retries. Read notification inspection is fail-closed until a successful
// snapshot; browser-capture recovery has held/failed-inspection witnesses.
// All 215 classified delivery awaits, recipes and failure classes are unchanged.
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
// LLP 3000.013.000 round 3: app-online.ts's one added await is the captured
// call's store-refused path awaiting the existing refusedStore before it
// decides whether to cancel or keep its localStorage record; app.ts's await
// counts are unchanged (the /schema reply check is synchronous). No delivery
// site, classification or recipe changes.
// LLP 3000.013.000 round 4: recovery's known-capture removal moved after its
// commit and a receipt return clears replay ownership; the await set is the
// same (the hash moves because that body sits inside an awaited lock). No delivery
// site, classification or recipe changes.

// FILE + JR merge (0.4.23): file assets change only asset-upload awaits.
// assets.ts uploads with the declared content type and `?as=file` target;
// client.ts and local.ts pass the new upload `options` through to it (await
// counts unchanged). files.ts adds saveAsset's one await, `client.asset(id)`, a
// read that downloads bytes for a browser save. None of these admits, sends,
// stores or settles a write: no delivery site, classification or fault recipe
// changes. The boundary is regenerated over both families' sources.

// W8C (LLP 3000.013.000 §17): app-persona opening awaits dev probe/schema,
// store identification and the existing onlineCustody wrapper. These are
// online journal custody, outside this matrix's device delivery path; no
// device await or fault recipe changed. online-capture runs all common
// capture/marker/commit-failure/recovery races for sessions AND personas;
// online-journal-browser covers navigation, lost POST responses, schema
// refusal/unknown selection with older intent, principal isolation and reset.
// Persona authority is synchronous, with no session-credential I/O. app.ts
// construction validates configurations before its identity branch; its
// journal/session admission and the device dispatcher remain unchanged.
// W8C lifecycle correction: onlineCustody's opening read now has a cleanup
// catch (close capture/listeners/raw transport) before rethrowing. app-persona
// awaits closing the provisional client on every failed opening. These online
// awaits are outside device delivery. Both identity kinds test opening read
// failure with a surviving capture and no leaked runtime lock; Chromium
// exercises store replacement observed by a read and lock release.

// HAND: initialBackend is the former constructor-only schema/session fallback,
// before delivery owners exist; its extracted awaits cannot deliver mutations.
// Engine probes/wasm preparation likewise precede store opening. Runtime wasm
// worker restart remains covered by web-worker-control and artifact pin tests.
// Compatibility signal wrappers change the existing safe-read sites without
// adding delivery I/O; mutation settlement keeps its original transport await.
// The existing recipes exercise these exact sites; queued write custody and
// mutation dispatch/settlement classifications remain unchanged.
// MEDIA: uploads/assets add admission, dependency, transport and refusal-finalization
// boundaries. app-uploads adds the public session facade before the same device
// operations. upload-delivery-matrix exercises every selected await with transient
// and persistent failure; real upload/browser tests separately cover lost accepted
// replies, failed commits, restart/orphans and cancellation. The upload retry timer
// never rejects: its recipe faults the next real upload attempt after a genuine
// admission refusal. local-upload moves the unchanged connected-only helper out of
// local.ts to honor the source-size limit; it owns no upload/placing outbox custody.
// Immediate-upload/asset/blob tests cover its session and host failure paths.
// useUpload only awaits the classified public methods and state observations;
// upload-hooks tests cover retirement and a completion across provider replacement.

// MEDIA authority and identity recovery: web-upload-admission owns the session
// lock through the upload's strict commit and imports value-free shared identity.
// Its new waits receive admission fault recipes; the browser authority fixture
// also proves peer epoch replacement while admission is held. Quota deferral
// stops the entire source suffix, retaining source FIFO. No blob bytes enter
// the journal or shared terminal receipt window.

// Integration 7 DX: witness-web.ts awaits the existing app.mutate facade and
// observes the same write's terminal onWrite event. It adds no custody/storage
// or dispatch implementation; delivery stays under the existing app/local
// classified sites. DX's real-browser proof covers sent/refused/replay/timeout,
// ephemeral exclusion and cleanup. Its two awaits join the complete boundary
// seal, with no new device delivery site or fault recipe.

// Integration 11: proof.ts/proof-process.ts/proof-host.ts await only test-host,
// CLI and browser orchestration. They are a Node-only subpath, never imported by
// app/local/online delivery. proof.test.mjs owns occupied ports, process death,
// deadlines, group cleanup and browser failures; no delivery fault recipe changes.

// SURF3: proof-fixtures.ts awaits bounded catalog/dev-clock reads and local
// JSONL files; proof.ts adds caller-installed Playwright module loading. Both
// are Node-only proof orchestration, outside app/local/online write delivery.
// Fixture loader and proof usage/browser regressions own those failure paths;
// the actual delivery site census and all fault recipes remain unchanged.
// Worker settlement keeps the same await count: failed settlement payloads are
// redacted before the existing request; authority-loss callbacks are synchronous.
// These external-effect worker attempts do not enter device mutation delivery.
// Generated-effect-context/opt-in and worker tests cover retry and lease loss.

// Integration 15: fixture catalog credentials change five proof-only awaits;
// startDev adds persona discovery and current-clock sampling, and witnessForm
// awaits the explicit handler. These orchestration waits do not enter SDK
// delivery/recovery; the 213 delivery sites and their fault recipes are unchanged.

// Integration 18: the four additional proof.ts awaits fetch staging auth
// configuration, mint an operator token, perform clock control and decode its
// reply. These operator proof controls do not enter application write custody,
// offline delivery or settlement. The packed staging and clock cases exercise
// their refusal/production boundaries. Delivery sites and recipes are unchanged.

// Integration 19 boundary review: auth.ts moves sign-in fetch/body waits into
// identity-request.ts. Its fetch, decode and bounded pause retry only an explicit
// pre-admission auth E_RATE_LIMIT; ambiguous replies never replay. These waits
// create sessions before application custody, and identity-rate tests cover
// cancellation/deadlines/lost replies. proof-accounts uses the same setup helper.
// proof.ts adds native stop and read-only store-lock barrier waits, outside
// application delivery. Packed DX4 covers worker-held locks and rate retries.
// No delivery scope, required/optional recipe or custody site changes.

// DX5: proof.ts adds an await to project clockCall().now for the staging clock.
// It owns no client delivery, outbox or receipt work; existing fault sites and
// recipes are unchanged. The boundary census is regenerated from merged sources.

// Integration 22: DX6's app/session-timing waits reconcile credential custody
// before clock publication; request-wait captures a decoded response inside its
// decoder callback before scope retirement. The clock reconciliation and stream
// sample awaits enter the explicit matrix as required receipt and optional
// follow boundaries. All earlier recipes retain their semantic sites. Proof/text
// waits own browser/operator work only. The census is regenerated from source.

// DX8: proof-accounts waits for auth configuration, operator minting, schema
// diagnostics, signup and provisioning before an application client owns a
// write. proof-command/proof-process waits only bound the private process-group
// handshake, host shutdown and descendant cleanup. proof.ts adds those process
// bounds, authenticated operator clock/account orchestration and read-only proof
// paging/render waits. These Node proof paths never enter app/local/online
// delivery custody; identity-rate, proof process/contract and packed operator
// cases exercise their failures. Delivery sites and recipes remain unchanged.

// Integration 25: the new proof.ts waits hold/stop explicitly owned test hosts.
// proof-accounts adds bounded roster/setup reads before application write custody;
// proof-serve-check and its driver observe npm readiness/lifetime and group/store
// shutdown. These Node-only process/operator paths never originate or settle SDK
// delivery. Proof process/accounts/serve-check tests exercise their failure paths.
// Regenerate the complete await seal; delivery sites and fault recipes stay fixed.

// DX12: serve runner proof callbacks/commands, development account provisioning,
// and rendered-locator scrolling own test resources, not SDK delivery custody.
// Their added awaits are exercised by dx12-serve and proof-contract regressions;
// existing classified transport/settlement fault sites remain unchanged.

// Integration 27: REL2 roster lease fences and DX12 development accounts combine
// in proof-accounts; the merged proof export has one additional operator wait.
// Both are Node-only setup/proof custody, outside SDK delivery. Regenerate the
// complete await boundary from source; existing delivery fault sites stay fixed.

// Integration 28: observe-watch/proof-probe add synchronous guards; proof snapshotAll
// adds administrative host inspection only, outside application delivery custody.
// DX15 serve-check joins and proof-text observation retries also own proof-host
// work only. All 215 delivery await IDs, recipes and failure assertions are retained.

// Integration 33 / R1: proofResponse's three transport awaits cannot reject:
// disabled observation returns immediately; every enabled setup operation is
// inside its catch. The installed json wrapper retains the original decode's
// rejection at the existing caller await, while observation errors are caught.
// It adds no body read, I/O or write custody. proof-observation's own await is
// that deferred original json decode. proof-accounts' schema diagnostics and
// proof.ts' browser freshness/host waits are Node-only harness orchestration,
// outside SDK delivery. parent-lifetime and the other new proof helpers add no
// awaits. Regenerate awaitBoundary() only; retain all 215 classified fault sites,
// recipes and both matrix assertions without exceptions.

// Integration 34 boundary audit: upstream 148cb4d372..5913715c25 defers the
// local import in app/app-persona before client creation; web.ts now awaits
// its runtime module at engine/open entry, before existing device ownership.
// The former web implementation's awaits live in web-runtime.ts; synchronous
// persistence extraction adds no awaits. web-wasm retains its 13 awaits and
// content validation, awaiting a hash-validated compilation promise instead
// of compiling identical bytes again. These are startup/representation sites,
// not new durable-write, receipt, FIFO, grant or outbox transitions. Existing
// delivery sites/recipes stay pinned and their full fault matrix still runs.
// STARTER2 adds nine proof-browser UI/auth waits and one proof.ts rendered-selector
// registration wait; these operate on proof pages, outside client delivery custody. Browser
// restore/account-switch and startup/offline regressions exercise these paths.
// @ref LLP 3000.002#browser-startup-loading — deferred runtime opening retains the existing persistence and identity lifecycle.

// A1 (LLP 3000.002.000 sections 5.2, 5.3 and 6): custody reads precede
// core opening; late attach moves the existing startup I/O behind activation,
// with a fence after each await. Neither originates an online mutation: the
// existing identity/admission wait owns mutations until the real core is ready.
// The only new await in a classified helper is follow's read-only online poll,
// explicitly classified above outside delivery. sendPost retains its exact
// fault recipe while selecting a core-only version fence in progressive mode.
// All 215 delivery sites, required/optional classifications and recipes remain.
// The regenerated boundary also reconciles inherited app/persona factory waits
// and the existing web runtime/persistence split: these preserve authority and
// engine-opening custody above the same classified delivery I/O. Generated
// WASM declarations and local-status contain no awaits. App/browser tests and
// the unchanged complete delivery matrix cover those existing boundaries.

// Lane B (LLP 3000.002.000 section 7.2): one dispatcher per document. The new
// awaits live in progressive-writes.ts (the open-time owner decision under the
// journal then session lock, the merged pending/receipt views and the private
// read-less online transport for journal dispatch), in app-persona.ts (the same
// decision for persona apps) and in local.ts outside every classified helper
// (the decision call, the journal-aware queued view, and the transport's
// credential/evidence fences). The census finds no new delivery site: the
// journal's own dispatch I/O is the shipped online journal (app-online.ts), whose
// recipes are unchanged, and the outbox keeps its sites. progressive-writes,
// progressive-start and web-start (captured-before-WASM, same-id replay after
// navigation and a lost response, two tabs, late receipt across attachment,
// journal refusal once the outbox owns the document) cover the new boundary.

// Lane B round 2: recovered/adopted outbox writes use the unchanged flush and
// exit delivery sites. Journal dispatch now waits on that existing queue before
// private transport I/O; capture is already durable. ProgressiveWrites refreshes
// one pending/receipt snapshot on notifications, not on query evaluations. The
// cached-engine fallback adds schema retry/open handling; the ordinary persona
// path again awaits its full open. app-online.inspect shares its pending read.
// These change four complete await seals (app-online, app-persona, local and
// progressive-writes), with no added or removed classified delivery site:
// census remains 215/215. progressive-writes proves prefix ordering, orphan
// adoption, engine/storage failure, receipt cuts, provisional restore recovery
// and the public close cutoff; online-capture/app-persona cover default paths.

// Lane B round 4: settleMutation preserves the facade's fresh-id marker across
// its existing mutate await. ProgressiveWrites' pending-intent merge retains
// its two existing reads while overlaying a held reason; inspection retry and
// capture uncertainty reuse the existing inspect await. local.ts seeds journal
// capture from authenticated schema identity and matches its existing dispatch
// wait relative to the backend base path. No await was added or removed:
// write-settlement (2), progressive-writes (15), local (228). Only local and
// write-settlement change their await-expression text hashes. The complete
// text seal is regenerated; all 215 classified delivery sites, failure classes
// and recipes remain unchanged. B4 progressive/browser/retained-history tests
// cover these custody and publication changes.

// Lane E round 1: custody fixes retain local.ts's 228 and progressive-writes.ts's
// 15 awaits; only their expression-text seals change. The journal response now
// checks dispatch incarnation/store around existing authority I/O; inspection
// completion and recovery reuse the existing inspect await and timer. Queue
// completeness, evaluation watermark coverage, explicit-id routing and parked
// watch tracking add no I/O. All 215 classified delivery sites, classifications
// and recipes remain unchanged. Progressive-writes and the held-sync two-owner
// browser witness cover these paths, including negative controls for each fix.

// Lane E round 3: local.ts retains 228 awaits; its transport now separates
// credential revocation and metadata adoption from store-bound settlement.
// progressive-writes.ts grows from 15 to 16 awaits: uncertain capture inspection
// retries await the existing app-online locked recovery after session publication.
// This can admit/replay a dead peer's capture through the existing journal path;
// it adds no new persistence or transport primitive and preserves liveness and
// authority checks. Progressive-writes E3 tests cover live-to-dead recovery,
// transient refresh, generation revocation, and a receipt save held across store
// adoption; online-capture/app-online cover recovery storage faults. Regenerate
// the complete seal; all 215 classified device delivery sites/recipes are intact.

// Lane E round 4: app-online grows 39→40 awaits and online-capture 1→2 to
// expose the existing liveness-filtered capture scan to progressive inspection.
// progressive-writes grows 16→26: opening-failure recovery reads/quarantines
// through the existing journal/session locks, reinstalls custody and drains
// recovery on close; ordinary inspection checks capture state before and after
// its existing journal read. Recovery keeps the same admission/authority path.
// E4 covers held own captures, live/dead peers, failed removal, failed quarantine,
// first-inspect failure and bounded retry; online-capture/app-online cover the
// underlying storage faults. All 215 classified device delivery sites and their
// recipes remain unchanged; regenerate the complete await boundary seal.

// Lane E round 5: local.ts retains 228 awaits; its awaited journal install
// expression now carries receipt incarnation/store stamps and the intersecting
// watch wake after a skipped cut. onlineEvidence returns its adopted epoch at
// its existing completion; there is no new I/O. app-online retains 40 awaits:
// inspected terminal-id reservation and the stale-recovery backoff guard are
// synchronous. Progressive-writes retains 26 awaits and changes only its erased
// evidence type. E5 regressions cover exhausted capture storage, recovery retry
// counts, awaited replacement, generation retirement, mid-adoption settlement
// and watch wakeup. All 215 classified delivery sites and recipes are unchanged;
// regenerate only the complete await-expression seal.

// Lane E round 6: progressive-writes retains 26 awaits; its onlineCustody call
// supplies the existing failure-streak reporter for capture recovery. Stable
// pending-intent/custody delegates, opening operation tracking, notification
// provenance and capped live-capture polling are synchronous. app-online keeps
// 40 awaits and routes recovery errors to that reporter. Held/coalesced journal
// inspections, replay-cut, hook/retention, recovery/backoff and app-lifetime
// regressions cover these paths. Regenerate the complete expression seal;
// all 215 classified delivery sites, recipes and failure classes are unchanged.

// Lane E round 7: local retains 228 awaits, progressive-writes 26 and app-online
// 40. Opening recovery keeps its admission/close fences through nested install,
// passes the device method snapshot and reports quarantine at the existing read.
// Receipt cuts now require generation-qualified footprints; peer inspections
// retain store/incarnation evidence, and concurrent recovery shares one promise.
// These reuse the existing installation, journal, transport and save boundaries.
// E7 holds nested installation, receipt delivery and a failing recovery save;
// it covers replacement-store peer receipts and failed/successful preservation.
// Regenerate the expression seal; all 215 classified sites/recipes are unchanged.

// Lane E round 8: local retains 228 awaits. Its existing journal-install
// expression now accepts same-store cuts across program adoption and wakes
// foreign-store settlement with unknown preserved scopes. Sync advances online
// store/head observations in both startup modes. These are synchronous
// evidence changes at existing boundaries; all 215 classified delivery sites,
// failure classes and recipes remain unchanged. Regenerate the expression seal.

// Lane E round 9: progressive-writes drops 26→23 awaits by combining retained
// close/sign-out cleanup in one Promise.all. The original client's fence runs
// synchronously before that wait; nested custody inherits its paused lifetime.
// app-online retains 40 awaits: its live capture now carries the original
// store into inspection, allowing a peer receipt to install the same-store cut
// before the capturing response arrives. E9 regressions and isolated controls
// cover both races. No delivery I/O/site, failure class or recipe changes;
// regenerate the expression seal with all 215 classified sites intact.

// Lane E round 10: local keeps 228 awaits and progressive-writes keeps 23.
// Existing journal installation now retains typed admission failure through
// nested preparation and clears recovery even after a closed installation fails.
// The recovery reader persists its quarantine warning streak. Same-generation
// peer cuts retain footprints; failed writes stay scoped, unknown preservation
// does not revoke, and store refusals qualify against the request binding.
// Sync advances generation in both startup modes. Public pending writes strip
// internal store bindings. E10 regressions cover these synchronous changes at
// existing I/O boundaries; all 215 classified delivery sites/recipes are unchanged.

// Lane E round 11: local/progressive-writes/app-online retain 228/23/40 awaits.
// The opening-failure lifecycle waits for original cleanup and nested recovery
// with allSettled, holding response custody through both; this does not await
// the network or acquire delivery custody. The pre-transport retired-viewer
// guard, identity-wait binding repair and bounded receipt evidence are sync.
// Removing the unread receipt stamp changes the existing install expression,
// not delivery I/O. E11 and the strengthened E1/E5/E9 regressions cover these
// boundaries. All 215 classified delivery sites and recipes remain unchanged.

// Lane E round 12: local/progressive-writes/app-online retain 228/23/40 awaits.
// The existing journal-install expression now treats inspected success as an
// unknown execution generation, preserves a current known certificate's bound
// on generation mismatch, and fences replacement by the refusing store. These
// are synchronous evidence decisions, with no new delivery I/O or custody wait.
// E12 regressions and isolated controls cover each decision; E10 keeps failed
// peer settlement scoped. Regenerate the expression seal; all 215 classified
// delivery sites, failure classes and recipes remain unchanged.

// Lane E round 13: progressive-writes adds two retirement-only cleanup awaits
// (23→25): close a prepared transport or newly opened custody before exposing
// either to a retired lifetime. Rechecks after preparation/opening and failure
// reporting suppression preserve the original refusal wrappers; clearing a live
// dispatcher's admission refusal before refresh is synchronous. E13 holds both
// opening boundaries and the first inspection, including a retired open failure.
// No new admission/delivery I/O or fault recipe: all 215 classified sites remain.

// Lane E round 14: local/progressive-writes/app-online retain 228/25/40 awaits.
// The journal-install expression separates refusal metadata from observation,
// recovers an already-adopted store's dispatcher, applies live preservation
// independently of settlement, and bounds known obsolete preservation. Pause
// versus close, deferred start, outstanding-response pins and admitted receipt
// eviction are synchronous;
// held-read revocation starts at the already-running attempt. No admission or
// delivery I/O is added. E14's nine witnesses cover these decisions; all 215
// classified sites, failure classes and recipes remain unchanged. Regenerate
// the complete await-expression seal.

// Lane E round 16: local adds one onlineEvidence await in the journal response
// (228→229); an already-adopted store's refusal now takes the existing durable
// shrink witness and program boundary. Current-dispatch fences still guard
// metadata; dispatcher recovery, live preservation, selective store retirement,
// pause resumption and receipt pins are synchronous decisions. E16 holds the
// response/opening boundaries and peer settlement, including obsolete authority.
// progressive-writes/app-online/app-journal retain 25/40/3 awaits. Regenerate the
// complete expression seal; all 215 delivery site identities and recipes remain.

// Lane E round 17: progressive-writes adds one await (25→26) delegating a
// retained denial-frame close to installed custody while holding response
// custody. Both close expressions now await the already-started device fence;
// the dispatcher flag precedes the device's own synchronous notifications,
// and the device fence precedes custody pause notifications.
// no admission or delivery I/O is added. E17 holds the opening gate, re-enters
// from pause notifications, releases responses after close, and faults nested
// quarantine across retirement/pause. app-online's retirement guard and the
// preservation-report flag are synchronous; its 40 awaits remain unchanged.
// Regenerate the full expression seal; all 215 delivery sites/recipes remain.

// Lane S1: settlement-extract, settlement-reducer and refusal-decision are pure
// additive modules with zero awaits; no executor imports them yet. receiptOf
// whitelists storeId/generation/op inside app-online's existing settlement
// transaction. That changes its await-expression seal, not its 40 awaits or
// the 215 classified delivery sites/recipes. settlement-receipt witnesses old
// reads, additive round trips and disclosure; regenerate the complete seal.

// Lane S2b step 1: the journal wrapper executes extract/decideRefusal and takes
// selective retirement before online evidence. Two conditional onlineEvidence
// awaits become one effect executor (local 229→228). app-online retains its 40
// awaits; raw refusal execution and kept-intent caller projection are synchronous.
// Rounds 12/14/16 and progressive-writes-s2b exercise fences, shrink, recovery,
// lagging online metadata and kept callers. All 215 delivery sites/recipes stay.

// Lane S2b step 2: reducer effects replace the wrapper's receipt/live rules and
// callback qualification plus progressive's four rings. Arrival starts the
// existing watch episode; pending exit publishes the in-memory cut. app-online
// forwards known pending exits synchronously around its existing persistence
// and notifications. Transport bindings use a WeakMap, including close delivery.
// These paths add no I/O await: local/progressive/app-online/app-journal remain
// 228/26/40/3. The complete expression seal changes for existing inline bodies;
// all 215 classified delivery sites/recipes stay. Pure pin/eviction, generation,
// held-save, unadmitted-response, peer and close witnesses cover the new effects.

// Lane S2c: every fetch now releases its pin in the existing wrapper finally,
// after processing; no new await. Extraction distinguishes replay serving from
// execution generation and validates refusal bodies; the raw send/close paths
// share that pure validator. before() keeps private receipt metadata, learned
// receipt insertion leaves projection to the public boundary, and the reducer
// exposes arrival refusal effects already executed by the wrapper. No delivery
// site or recipe changes: 215; local/progressive/app-online/app-journal await
// counts stay 228/26/40/3. Regenerate the complete expression seal; S2c witnesses
// cover retries/errors, malformed replies, replay, metadata and projection.

// Lane S3a: tracked-only receipt reduction, retained-snapshot eviction pins,
// arrival read acquisition, wake-only foreign publication, store-bound capture,
// and raw settlement execution add no await. The reducer's response ordering
// remains pure. app-online emits persisted only after an actual pending exit;
// a no-op failed-save retry still reports observed. Existing inline executor
// bodies change the complete expression seal, not delivery I/O or recipes.
// local/progressive-writes/app-online/app-journal stay at 228/26/40/3 awaits;
// all 215 classified sites/recipes remain. S3a, rounds 14/16 and receipt tests
// cover these paths; regenerate the complete seal.
