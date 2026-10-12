// @ref LLP 3000.001.000#build-stamp — stamp the optimized artifact using its own exported engine identity.
import { readFileSync, writeFileSync } from 'node:fs';
import { initSync, engine_info } from '../packages/snapback4/src/wasm/snapback4_device.js';
const file = process.argv[2];
const bytes = readFileSync(file);
const module = new WebAssembly.Module(bytes);
if (WebAssembly.Module.customSections(module, "snapback4.engine").length) throw new Error("device stamp already present; rebuild from the unstamped optimized artifact");
initSync({ module });
const stamp = JSON.parse(engine_info());
const leb = n => { const bytes = []; do { let b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(bytes); };
const name = Buffer.from('snapback4.engine');
const body = Buffer.concat([leb(name.length), name, Buffer.from(JSON.stringify(stamp))]);
writeFileSync(file, Buffer.concat([bytes, Buffer.from([0]), leb(body.length), body]));
const written = new WebAssembly.Module(readFileSync(file));
const stamps = WebAssembly.Module.customSections(written, 'snapback4.engine');
if (stamps.length !== 1 || Buffer.compare(Buffer.from(stamps[0]), Buffer.from(JSON.stringify(stamp)))) throw new Error('device stamp readback differs');
writeFileSync(file + '.engine.json', JSON.stringify(stamp, null, 2) + '\n');
