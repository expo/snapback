import { hangBudget } from '../../helpers/wait.mjs';
const categories = new Set([
  "custody-registration",
  "custody-revalidation",
  "custody-signal",
  "close-timeout",
  "client-error",
  "drain-timeout",
  "protocol",
  "request",
  "server",
]);

function bounded(promise, milliseconds) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), milliseconds);
    promise.then(() => finish(true));
  });
}

export const settlesWithin = bounded;

export function createProxyPhase(onFailure) {
  let phase = "proof";
  let nextRequest = 0;
  const activeProof = new Set();
  const waiters = new Set();
  const notifyDrained = () => {
    if (activeProof.size !== 0) return;
    for (const resolve of waiters) resolve(true);
    waiters.clear();
  };
  const fixedCategory = category => categories.has(category) ? category : "request";

  return {
    get phase() { return phase; },
    beginRequest() {
      const request = Object.freeze({ id: ++nextRequest, phase });
      if (phase === "proof") activeProof.add(request.id);
      return request;
    },
    finishRequest(request) {
      if (request.phase === "proof") activeProof.delete(request.id);
      notifyDrained();
    },
    failRequest(request, category) {
      if (request.phase === "proof") onFailure(`proxy-proof-${fixedCategory(category)}`);
    },
    failServer(category = "server") {
      onFailure(`proxy-${phase}-${fixedCategory(category)}`);
    },
    failProof(category) {
      onFailure(`proxy-proof-${fixedCategory(category)}`);
    },
    beginExpectedTeardown() {
      if (phase !== "proof") return false;
      phase = "expected-teardown";
      return true;
    },
    async waitForProofDrain(milliseconds) {
      if (activeProof.size === 0) return true;
      let resolveDrain;
      const drained = new Promise(resolve => { resolveDrain = resolve; waiters.add(resolve); });
      const result = await bounded(drained, milliseconds);
      waiters.delete(resolveDrain);
      return result;
    },
    close() { phase = "closed"; },
  };
}

export function trackProxyExchange(lifecycle, request, response, onComplete = () => {}) {
  const requestPhase = lifecycle.beginRequest();
  const upstream = new AbortController();
  let handlerDone = false;
  let responseTerminal = false;
  let intentionalCut = false;
  let complete = false;
  const finish = () => {
    if (complete || !handlerDone || !responseTerminal) return;
    complete = true;
    lifecycle.finishRequest(requestPhase);
    onComplete();
  };
  const premature = () => {
    if (!intentionalCut) lifecycle.failRequest(requestPhase, "request");
    responseTerminal = true;
    upstream.abort();
    finish();
  };
  request.once("aborted", premature);
  request.once("error", premature);
  response.once("error", premature);
  response.once("finish", () => { responseTerminal = true; finish(); });
  response.once("close", () => {
    if (!response.writableFinished && !intentionalCut) premature();
    else { responseTerminal = true; finish(); }
  });
  return {
    requestPhase,
    signal: upstream.signal,
    handlerDone() { handlerDone = true; finish(); },
    intentionalCut() {
      intentionalCut = true;
      responseTerminal = true;
      upstream.abort();
      finish();
    },
    abort() {
      upstream.abort();
      if (!response.destroyed) response.destroy();
      premature();
    },
  };
}

function beginServerClose(server) {
  return new Promise(resolve => {
    try { server.close(() => resolve(true)); }
    catch { resolve(false); }
  });
}

export async function abortProxyServer(server, exchanges, milliseconds) {
  const closed = beginServerClose(server);
  for (const exchange of [...exchanges]) exchange.abort();
  server.closeIdleConnections();
  server.closeAllConnections();
  return settlesWithin(closed, milliseconds);
}

export async function closeExpectedProxy({ server, lifecycle, exchanges, currentFailure, drainMilliseconds, closeMilliseconds }) {
  lifecycle.beginExpectedTeardown();
  if (!currentFailure() && !await lifecycle.waitForProofDrain(drainMilliseconds)) lifecycle.failProof("drain-timeout");
  if (currentFailure()) {
    await abortProxyServer(server, exchanges, closeMilliseconds);
    lifecycle.close();
    return currentFailure();
  }
  const closed = beginServerClose(server);
  server.closeIdleConnections();
  server.closeAllConnections();
  if (!await settlesWithin(closed, closeMilliseconds)) lifecycle.failServer("close-timeout");
  if (currentFailure()) await abortProxyServer(server, exchanges, closeMilliseconds);
  lifecycle.close();
  return currentFailure();
}

export async function stopOwnedChild(child, ownedChildren, milliseconds = hangBudget()) {
  if (!ownedChildren.has(child)) return;
  const terminal = () => child.exitCode !== null || child.signalCode !== null;
  if (terminal()) { ownedChildren.delete(child); return; }

  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; child.once("exit", resolve); });
  const wait = async () => bounded(exited, milliseconds);
  if (!terminal()) child.kill("SIGTERM");
  if (terminal() || await wait()) { ownedChildren.delete(child); return; }
  child.kill("SIGKILL");
  if (terminal() || await wait()) { ownedChildren.delete(child); return; }
  child.removeListener("exit", resolveExit);
  throw new Error("owned-child-stop-timeout");
}
