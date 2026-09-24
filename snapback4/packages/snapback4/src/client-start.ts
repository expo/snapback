// Private coordination for app's prepare/commit/activate lifecycle. Keeping it
// independent of either client tier avoids adding local code to online bundles.
type Start = () => void | Promise<void>;
const plans = new WeakMap<object, { start?: Start }>();

export const startDeferred = (options: object): boolean => plans.has(options);

export function deferStart(options: object, start: Start): boolean {
  const plan = plans.get(options);
  if (!plan) return false;
  plan.start = start;
  return true;
}

export async function prepareClient<T>(options: object, create: () => T | Promise<T>) {
  const plan: { start?: Start } = {};
  plans.set(options, plan);
  try {
    const client = await create();
    return { client, start: async () => { await plan.start?.(); } };
  } finally { plans.delete(options); }
}

// Private lifecycle barrier: app logout-all must select the successor after
// an already-running rotation, without starting a fresh rotation itself.
const rotations = new WeakMap<object, () => Promise<unknown> | null>();
export const trackRotation = (client: object, pending: () => Promise<unknown> | null): void => { rotations.set(client, pending); };
export async function waitForRotation(client: object): Promise<void> {
  try { await rotations.get(client)?.(); } catch { /* The client retains the outcome and any successor. */ }
}
