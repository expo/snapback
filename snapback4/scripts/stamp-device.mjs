// @ref LLP 3000.001.000#build-stamp — verify the crate's stamp survives bindgen and optimization.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { initSync, engine_info } from '../packages/snapback4/src/wasm/snapback4_device.js';
const file = process.argv[2];
const module = new WebAssembly.Module(readFileSync(file));
const sections = WebAssembly.Module.customSections(module, 'snapback4.engine');
if (sections.length !== 1) throw new Error('device must carry exactly one crate-owned snapback4.engine section');
const stamp = JSON.parse(Buffer.from(sections[0]).toString());
initSync({ module });
if (!isDeepStrictEqual(stamp, JSON.parse(engine_info()))) throw new Error('embedded identity differs from engine_info');
writeFileSync(file + '.engine.json', JSON.stringify(stamp, null, 2) + '\n');
