// Diagnostic preload; captures synthetic device requests into ignored target only.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.NA_CAPTURE;
if (dir) {
  mkdirSync(dir, { recursive: true });
  const spawn = childProcess.spawn;
  childProcess.spawn = function(command, args, options) {
    const device = args?.[0] === 'device';
    const child = spawn.call(this, command, args, device ? { ...options, stdio: ['pipe','pipe','pipe'] } : options);
    if (!device) return child;
    const prefix = join(dir, String(child.pid));
    if (args[2]) copyFileSync(args[2], `${prefix}.backend.json`);
    let pending, buffer = '', seq = 0;
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = function(text, ...rest) {
      // Capture is outside the IPC timing; it is instrumentation overhead.
      appendFileSync(`${prefix}.requests.jsonl`, text);
      pending = { seq: seq++, op: JSON.parse(text).op, bytes: Buffer.byteLength(text), at: performance.now() };
      return write(text, ...rest);
    };
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        if (pending) {
          appendFileSync(`${prefix}.ipc.jsonl`, JSON.stringify({ ...pending, ms: performance.now()-pending.at, replyBytes: at+1 })+'\n');
          pending = undefined;
        }
        buffer = buffer.slice(at+1);
      }
    });
    child.stderr.on('data', chunk => appendFileSync(`${prefix}.core.jsonl`, chunk));
    return child;
  };
  syncBuiltinESMExports();
  const parse = JSON.parse, stringify = JSON.stringify;
  const metrics = { parse: { count: 0, ms: 0 }, stringify: { count: 0, ms: 0 }, http: [] };
  for (const [name, original] of [['parse',parse],['stringify',stringify]]) JSON[name] = function(...args) {
    const start = performance.now();
    try { return original.apply(this,args); }
    finally { metrics[name].count++; metrics[name].ms += performance.now()-start; }
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = async function(input, init) {
    const start = performance.now(), response = await fetch(input, init);
    if (new URL(String(input)).pathname !== '/sync') return response;
    const item = { headersMs: performance.now()-start, serverTiming: response.headers.get('server-timing'), bodies: [] };
    metrics.http.push(item);
    const wrap = r => {
      const clone = r.clone.bind(r);
      r.clone = () => wrap(clone());
      r.json = async () => {
        const begin = performance.now(), text = await r.text(), received = performance.now();
        const result = parse(text), end = performance.now();
        item.bodies.push({ readMs: received-begin, decodeMs: end-received, bytes: Buffer.byteLength(text) });
        return result;
      };
      return r;
    };
    return wrap(response);
  };
  process.on('exit', () => writeFileSync(join(dir, `${process.pid}.js.json`), stringify(metrics)));
}
