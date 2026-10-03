// Astra's review control, applied in memory to the unchanged baseline harness.
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/delivery-fault-matrix.test.mjs')) return result;
  const needle = 'if (enabled) seen.add(id);';
  if (!String(result.source).includes(needle)) throw Error('baseline hook anchor missing');
  return { ...result, source: String(result.source).replace(needle, `${needle}
    if (enabled && id === target && id === 'local.ts:follow:syncOnce()#1') {
      stack.run([], () => globalThis.__rgClient.syncOnce().catch(() => {}));
    }`) };
} });
