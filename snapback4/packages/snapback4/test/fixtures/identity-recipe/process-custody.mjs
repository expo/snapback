import { readFile } from "node:fs/promises";

const sameIdentity = (left, right) => left.pid === right.pid
  && left.ppid === right.ppid && left.uid === right.uid && left.starttime === right.starttime;

async function processIdentity(pid, expectedUid) {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("custody-pid");
  const [statText, statusText] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8"),
    readFile(`/proc/${pid}/status`, "utf8"),
  ]);
  const close = statText.lastIndexOf(")");
  if (close < 2 || statText[0] < "0" || statText[0] > "9") throw new Error("custody-stat");
  const parsedPid = Number(statText.slice(0, statText.indexOf(" ")));
  const fields = statText.slice(close + 1).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const starttime = fields[19];
  const uidLine = statusText.split("\n").find(line => line.startsWith("Uid:"));
  const uids = uidLine?.slice(4).trim().split(/\s+/).map(Number);
  if (parsedPid !== pid || !Number.isInteger(ppid) || !starttime
    || !uids || uids.length !== 4 || uids.some(uid => uid !== expectedUid)) throw new Error("custody-identity");
  return Object.freeze({ pid, ppid, uid: expectedUid, starttime });
}

async function ancestry(worker, engine, expectedUid, maximumDepth = 16) {
  const chain = [worker];
  let current = worker;
  for (let depth = 0; depth < maximumDepth && current.pid !== engine.pid; depth++) {
    current = await processIdentity(current.ppid, expectedUid);
    chain.push(current);
  }
  if (!sameIdentity(chain.at(-1), engine)) throw new Error("custody-ancestry");
  return Object.freeze(chain);
}

export async function captureEngineCustody(pid, expectedUid) {
  return processIdentity(pid, expectedUid);
}

export async function registerWorkerCustody(pid, engine, expectedUid) {
  const worker = await processIdentity(pid, expectedUid);
  const chain = await ancestry(worker, engine, expectedUid);
  return Object.freeze({
    engine,
    worker,
    receipt: Object.freeze({
      engine: { pid: engine.pid, ppid: engine.ppid, uid: engine.uid, starttime: engine.starttime },
      worker: { pid: worker.pid, ppid: worker.ppid, uid: worker.uid, starttime: worker.starttime },
      parentChain: chain.map(identity => ({ pid: identity.pid, ppid: identity.ppid, uid: identity.uid, starttime: identity.starttime })),
    }),
  });
}

export async function verifyWorkerCustody(registered, currentEngine, expectedUid) {
  const engine = await processIdentity(currentEngine.pid, expectedUid);
  if (!sameIdentity(engine, currentEngine) || !sameIdentity(engine, registered.engine)) throw new Error("custody-engine-changed");
  const worker = await processIdentity(registered.worker.pid, expectedUid);
  if (!sameIdentity(worker, registered.worker)) throw new Error("custody-worker-changed");
  await ancestry(worker, engine, expectedUid);
  return registered.receipt;
}
