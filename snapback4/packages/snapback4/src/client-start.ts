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
