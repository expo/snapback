#!/usr/bin/env node
// @ref LLP 3000.021#3.3 — verify actual ELF headers, not a linker flag's promise
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export function checkElf(bytes) {
  const fail = (why) => { throw new Error(`ELF qualification: ${why}; rebuild x86_64-unknown-linux-musl with the musl C compiler and static CRT`); };
  const range = (off, len) => { if (!Number.isSafeInteger(off) || off < 0 || len < 0 || off + len > bytes.length) fail("truncated or invalid ELF"); };
  range(0, 64);
  if (!bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1 || bytes.readUInt16LE(18) !== 62 || ![2, 3].includes(bytes.readUInt16LE(16))) fail("expected executable ELF64 little-endian x86_64");
  const offset = Number(bytes.readBigUInt64LE(32)), size = bytes.readUInt16LE(54), count = bytes.readUInt16LE(56);
  if (size !== 56 || !count || count === 65535) fail("invalid program headers");
  range(offset, size * count);
  let load = false;
  for (let i = 0; i < count; i++) {
    const p = offset + i * size, type = bytes.readUInt32LE(p);
    const off = Number(bytes.readBigUInt64LE(p + 8)), len = Number(bytes.readBigUInt64LE(p + 32));
    range(off, len);
    if (type === 1) load = true;
    if (type === 3) fail("PT_INTERP interpreter present");
    if (type === 2) {
      if (len % 16) fail("invalid dynamic section");
      let terminated = false;
      for (let d = off; d < off + len; d += 16) {
        const tag = bytes.readBigUInt64LE(d);
        if (tag === 0n) { terminated = true; break; }
        if (tag === 1n) fail("DT_NEEDED shared-library dependency present");
      }
      if (!terminated) fail("unterminated dynamic section");
    }
  }
  if (!load) fail("no loadable segment");
  return { status: "passed", machine: "x86_64", interpreter: null, needed: [] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkElf(readFileSync(process.argv[2]))));
