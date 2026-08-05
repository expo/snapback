#!/usr/bin/env node
// A transparent TCP tee in front of the Snapback dev server, so the exact
// subscribe request/response can be compared between carriers.
//
// The client derives SNAPBACK_RETENTION_NOT_RQS_ELIGIBLE from the subscribe
// response carrying no resume token. That leaves two possibilities the client
// facts cannot distinguish: the server declined to mint, or the client dropped
// it. This captures the wire so the question is answered rather than argued.
//
//   node demos/warble/scripts/wire-tee.mjs --listen 4430 --target 4420
//
// Point a carrier at http://<lan-ip>:4430 and read the capture.

import { createServer, connect } from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
};

const LISTEN = Number(argOf('--listen', 4430));
const TARGET = Number(argOf('--target', 4420));
const LABEL = argOf('--label', 'capture');
const OUT = resolve(argOf('--out', `demos/warble/.dev/wire-${LABEL}.log`));

writeFileSync(OUT, `# wire capture ${LABEL} :${LISTEN} -> :${TARGET}\n`);
let connectionSeq = 0;

// WebSocket text frames from the client are masked, so a raw grep misses them.
// Decode enough of RFC 6455 to recover text payloads in both directions.
function decodeFrames(buffer) {
  const out = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor); cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor)); cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4); cursor += 4;
    }
    if (cursor + length > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 0x1 || opcode === 0x0) out.push(payload.toString('utf8'));
    offset = cursor + length;
  }
  return { frames: out, consumed: offset };
}

const record = (id, direction, text) => {
  appendFileSync(OUT, `\n=== [${id}] ${direction} ===\n${text}\n`);
};

createServer((client) => {
  const id = ++connectionSeq;
  const upstream = connect(TARGET, '127.0.0.1');
  const state = {
    client: { upgraded: false, buffer: Buffer.alloc(0) },
    server: { upgraded: false, buffer: Buffer.alloc(0) },
  };

  const pump = (chunk, side, direction, sink) => {
    const s = state[side];
    if (!s.upgraded) {
      const text = chunk.toString('utf8');
      // Everything before the upgrade is plaintext HTTP: log it whole.
      record(id, direction, text.slice(0, 20_000));
      if (/HTTP\/1\.1 101|Upgrade:\s*websocket/i.test(text)) {
        s.upgraded = true;
        const split = text.indexOf('\r\n\r\n');
        if (split !== -1) s.buffer = chunk.subarray(split + 4);
      }
    } else {
      s.buffer = Buffer.concat([s.buffer, chunk]);
      const { frames, consumed } = decodeFrames(s.buffer);
      if (consumed > 0) s.buffer = s.buffer.subarray(consumed);
      for (const frame of frames) record(id, `${direction} ws`, frame.slice(0, 20_000));
    }
    sink.write(chunk);
  };

  client.on('data', (chunk) => pump(chunk, 'client', 'client->server', upstream));
  upstream.on('data', (chunk) => pump(chunk, 'server', 'server->client', client));

  const shut = () => { client.destroy(); upstream.destroy(); };
  client.on('error', shut); upstream.on('error', shut);
  client.on('close', shut); upstream.on('close', shut);
}).listen(LISTEN, '0.0.0.0', () => {
  console.log(`wire tee listening on 0.0.0.0:${LISTEN} -> 127.0.0.1:${TARGET}`);
  console.log(`capture: ${OUT}`);
});
