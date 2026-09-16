import { createHash, timingSafeEqual } from 'node:crypto';
import { open, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const line = (value) => JSON.stringify(value) + '\n';
export function insist(ok, code, message = code) {
  if (!ok) throw Object.assign(new Error(message), { code });
}
export function equalSecret(a, b) {
  const x = Buffer.from(a ?? ''), y = Buffer.from(b ?? '');
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function* readLines(path) {
  const source = createReadStream(path);
  const input = path.endsWith('.gz') ? createGunzip() : source;
  if (input !== source) { source.on('error', error => input.destroy(error)); source.pipe(input); }
  for await (const value of createInterface({ input, crlfDelay: Infinity })) {
    if (value) yield JSON.parse(value);
  }
}

// One writer owns a journal. Each acknowledged record has reached fsync.
// A crash may leave a torn final line: truncate only that unacknowledged tail.
export class Journal {
  static async open(path) {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'a+');
    const bytes = await handle.readFile();
    const end = bytes.lastIndexOf(10) + 1;
    if (end !== bytes.length) await handle.truncate(end);
    const records = bytes.subarray(0, end).toString().split('\n').filter(Boolean).map(JSON.parse);
    const journal = new Journal(handle, records);
    await handle.sync();
    // Persist directory creation/file entry as well as the content.
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return journal;
  }
  constructor(handle, records) { this.handle = handle; this.records = records; this.tail = Promise.resolve(); }
  append(record) {
    const task = this.tail.then(async () => {
      await this.handle.writeFile(line(record));
      await this.handle.sync();
      this.records.push(record);
    });
    this.tail = task; // A failed durable write poisons the writer: never acknowledge later records.
    return task;
  }
  async close() { await this.tail.catch(() => {}); await this.handle.close(); }
}

export async function body(request, max = 10 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    insist(size <= max, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
export function loopbackUrl(value) {
  const url = new URL(value);
  insist(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password, 'LOOPBACK_URL_REQUIRED');
  return url;
}
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function exists(path) { try { await stat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
