// Remap SDK imports for existing test files without replacing build artifacts.
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const from = pathToFileURL(resolve('packages/snapback4/dist') + '/').href;
const to = pathToFileURL(resolve(process.env.PR_CONTROL_SDK ?? 'packages/snapback4/dist') + '/').href;
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    return result.url.startsWith(from) ? { ...result, url: to + result.url.slice(from.length) } : result;
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/unread-range.test.mjs')) result.source = String(result.source).replace('assert.equal(remote.data, 6)', 't.diagnostic(JSON.stringify({ remote })); assert.equal(remote.data, 6)');
    if (url.endsWith('/ordinary-history.test.mjs')) result.source = String(result.source).replace('assert.deepEqual((await bob.query(query("inbox"), {})).data, [])', '{ const inbox = await bob.query(query("inbox"), {}); t.diagnostic(JSON.stringify({ inbox })); assert.deepEqual(inbox.data, []); }');
    return result;
  },
});
