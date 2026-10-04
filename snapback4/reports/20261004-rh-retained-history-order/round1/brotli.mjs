#!/usr/bin/env node
// Local CLI equivalent for measure-wasm.sh on eb1000 (no global install).
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
const [, , ...args] = process.argv;
if (args.length !== 4 || args[0] !== '-c' || args[1] !== '-q' || args[2] !== '11') throw Error('expected -c -q 11 FILE');
process.stdout.write(brotliCompressSync(readFileSync(args[3]), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
