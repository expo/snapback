// Private coordination for app's prepare/commit/activate lifecycle. Keeping it
// independent of either client tier avoids adding local code to online bundles.
type Start = () => void | Promise<void>;
const plans = new WeakMap<object, { start?: Start; commit?: Start }>();

export const startDeferred = (options: object): boolean => plans.has(options);

export function deferStart(options: object, start: Start): boolean {
  const plan = plans.get(options);
  if (!plan) return false;
  plan.start = start;
  return true;
}

/** Provisional device bookkeeping cannot become durable before App identity. */
export function deferCommit(options: object, commit: Start): boolean {
  const plan = plans.get(options);
  if (!plan) return false;
  plan.commit = commit;
  return true;
}

export async function prepareClient<T>(options: object, create: () => T | Promise<T>) {
  const plan: { start?: Start; commit?: Start } = {};
  plans.set(options, plan);
  try {
    const client = await create();
    return { client, commit: async () => { await plan.commit?.(); }, start: async () => { await plan.start?.(); } };
  } finally { plans.delete(options); }
}

// @ref LLP 3000.002.000#5.3 — app authority waits count as pending foreground reads before the raw watch exists.
const foreground = new WeakMap<object, () => () => void>();
export const trackForeground = (client: object, begin: () => () => void): void => { foreground.set(client, begin); };
export const beginForeground = (client: object): (() => void) => foreground.get(client)?.() ?? (() => {});

// Private lifecycle barrier: app logout-all must select the successor after
// an already-running rotation, without starting a fresh rotation itself.
const rotations = new WeakMap<object, () => Promise<unknown> | null>();
export const trackRotation = (client: object, pending: () => Promise<unknown> | null): void => { rotations.set(client, pending); };
export async function waitForRotation(client: object): Promise<void> {
  try { await rotations.get(client)?.(); } catch { /* The client retains the outcome and any successor. */ }
}
