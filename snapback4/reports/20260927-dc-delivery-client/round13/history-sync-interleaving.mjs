import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
// Hold a real, already-rendered sync page across the leave commit. The original
// inbox assertion is unchanged; this only chooses an allowed request ordering.
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/test/ordinary-history.test.mjs')) return result;
  let source = String(result.source);
  function replace(before, after) {
    assert.equal(source.split(before).length, 2, `unique interleaving site: ${before}`);
    source = source.replace(before, after);
  }
  replace('return fetch(input, init);', `
    const response = await fetch(input, init);
    const probe = globalThis[Symbol.for('sb4.test.historySync')];
    if (path === '/sync' && probe?.armed) {
      probe.armed = false;
      const body = await response.text();
      probe.ready.resolve(); await probe.release.promise;
      return new Response(body, { status: response.status, headers: response.headers });
    }
    return response;`);
  replace('await assertScreen(); let unmount = await mount();', `
    await assertScreen(); let unmount = await mount(); await bob.sync();
    const probe = { armed: true, ready: Promise.withResolvers(), release: Promise.withResolvers() };
    globalThis[Symbol.for('sb4.test.historySync')] = probe;
    t.after(() => { probe.release.resolve(); delete globalThis[Symbol.for('sb4.test.historySync')]; });
    const preLeaveSync = bob.sync(); await probe.ready.promise;`);
  replace('await bob.sync();\n    // The guide memberships', `
    const joinedSync = bob.sync(); probe.release.resolve(); await joinedSync; await preLeaveSync;
    // The guide memberships`);
  return { ...result, source };
} });
