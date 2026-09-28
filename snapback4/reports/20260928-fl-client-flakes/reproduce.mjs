import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
const baseline = 'ea7ecc896c166c31caf88f843e0c4dce4ea900b6';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/client-seams.test.mjs') || url.endsWith('/ephemeral-keep.test.mjs')) {
    const name = url.split('/').at(-1);
    result.source = execFileSync('git', ['show', `${baseline}:snapback4/packages/snapback4/test/${name}`], { encoding: 'utf8' });
  }
  if (url.endsWith('/client-seams.test.mjs')) {
    result.source = String(result.source).replace('drop = false; throw new TypeError("committed acknowledgement lost")', 'drop = false; await sleep(100); throw new TypeError("committed acknowledgement lost")');
  }
  if (url.endsWith('/ephemeral-keep.test.mjs')) {
    result.source = String(result.source)
      .replace('replies.push(json);', `replies.push(json); console.log('TYPING_REPLY', JSON.stringify({ wall: Date.now(), serverNow: response.headers.get('x-snapback-time'), nextExpiry: json.nextExpiry, data: json.data }));`)
      .replace('keptReads.push({ at: performance.now(), read: kept.getSnapshot() })', `keptReads.push({ at: performance.now(), read: kept.getSnapshot(), evidence: console.log('TYPING_PUBLICATION', JSON.stringify({ wall: Date.now(), clientNow: observer.now(), read: kept.getSnapshot() })) })`)
      .replace("assert.ok(keptReads.length > 0,", "await delay(2400); assert.ok(keptReads.length > 0,");
  }
  return result;
} });
