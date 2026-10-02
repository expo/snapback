// Astra's negative control: mutate only the instrumented temporary client.
// The shared operation and every new-operation branch retain their real result.
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!/\/.rg-matrix-[^/]+\/dist\/local\.js$/.test(url)) return result;
  const source = String(result.source);
  const join = /if \(syncing && !reserve\)\s*return syncing;/g;
  if ([...source.matchAll(join)].length !== 1) throw Error('sync join branch anchor missing or ambiguous');
  return { ...result, source: source.replace(join, 'if (syncing && !reserve) return syncing.then(() => true, () => true);') };
} });
