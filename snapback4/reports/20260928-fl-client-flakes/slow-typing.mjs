import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/ephemeral-keep.test.mjs')) {
    result.source = String(result.source).replace("'all typing replies held before expiry');", "'all typing replies held before expiry'); if (revision === 2) await delay(4500);");
  }
  return result;
} });
