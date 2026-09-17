const categories = new Set([
  "custody-registration",
  "custody-revalidation",
  "custody-signal",
  "close-timeout",
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

export async function stopOwnedChild(child, ownedChildren, milliseconds = 4_000) {
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
