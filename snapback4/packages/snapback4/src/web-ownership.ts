import type { Persistence, PersistenceClaim } from "./web.ts";

export function lockManager(): LockManager | undefined {
  return (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
}

/** Hold the store's lock for this tab; when another tab holds it, take a
 * tab-scoped store instead. Durable IndexedDB refuses when Web Locks cannot
 * establish exclusive ownership. */
export async function claimWithWebLocks(name: string, alternate: boolean): Promise<PersistenceClaim | null> {
  const locks = lockManager();
  if (!locks) throw new Error("webDevice: durable IndexedDB requires the Web Locks API for exclusive store ownership");
  const held = await hold(locks, name);
  if (held) return { name, release: held };
  if (!alternate) return null;
  const own = `${name}:tab-${Math.random().toString(36).slice(2, 10)}`;
  const release = await hold(locks, own);
  if (!release) throw new Error("webDevice: could not claim an exclusive tab-scoped device store");
  return { name: own, release };
}

export async function claimStore(persist: Persistence, name: string, alternate: boolean): Promise<PersistenceClaim | null> {
  const claim = await persist.claim(name, alternate);
  if (!claim) return null;
  let problem: string | undefined;
  if (typeof claim.name !== "string" || typeof claim.release !== "function") {
    problem = "persistence returned an invalid exclusive claim";
  } else if (!alternate && claim.name !== name) {
    problem = `a non-alternate claim for ${name} must return that exact name`;
  } else if (claim.name !== name && (!claim.name.startsWith(`${name}:tab-`) || claim.name.length === `${name}:tab-`.length)) {
    problem = `an alternate claim for ${name} must use the ${name}:tab-* namespace`;
  } else if (claim.name !== name && (typeof persist.others !== "function" || typeof persist.remove !== "function")) {
    problem = "a persistence provider returning an alternate must implement others(prefix) and remove(name) for orphan adoption";
  }
  if (!problem) return claim;
  if (typeof claim.release === "function") await claim.release();
  throw new Error(`webDevice: ${problem}`);
}

/** Hold a lock until released; null when another holder has it. */
function hold(locks: LockManager, name: string): Promise<(() => Promise<void>) | null> {
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    const requested = locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      resolve(async () => {
        release();
        await requested;
      });
      await done;
    });
    void requested.catch(reject);
  });
}

