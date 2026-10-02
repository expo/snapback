// Mutation control: run the permanent regressions with the old context-only
// injection policy. Retain the final fixture's independent reachability fix.
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/delivery-fault-matrix.test.mjs')) return result;
  const needle = 'while (pending()) { quiesced++; try { await pending(); } catch {} }';
  if (!String(result.source).includes(needle)) throw Error('quiescence anchor missing');
  return { ...result, source: String(result.source).replace(needle, '') };
} });
