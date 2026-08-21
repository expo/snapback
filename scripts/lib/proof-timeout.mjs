#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The runner converts seconds to quarter-second poll counts in Bash arithmetic.
// Keeping the canonical ceiling below INT32_MAX / 4 makes that conversion safe
// even on a Bash 3.2 build whose arithmetic word is only 32 bits.
export const PROOF_TIMEOUT_MAX_SECONDS = 536_870_911;

export function parseProofTimeoutSeconds(value, {
  allowZero = false,
  label = 'timeout',
} = {}) {
  const source = typeof value === 'string' ? value : String(value);
  const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
  const kind = allowZero ? 'non-negative' : 'positive';
  if (!pattern.test(source)) {
    throw new TypeError(
      `${label} must be a canonical ${kind} decimal integer `
      + `(no sign or leading zeros), got ${JSON.stringify(source)}`,
    );
  }
  const maximum = String(PROOF_TIMEOUT_MAX_SECONDS);
  if (source.length > maximum.length
    || (source.length === maximum.length && source > maximum)) {
    throw new RangeError(
      `${label} must be a canonical ${kind} decimal integer no greater than `
      + `${maximum}, got ${JSON.stringify(source)}`,
    );
  }
  return Number(source);
}

function main(args) {
  let allowZero = false;
  let label = 'timeout';
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--allow-zero') {
      allowZero = true;
    } else if (argument === '--label') {
      index += 1;
      if (index >= args.length) throw new TypeError('--label requires a value');
      label = args[index];
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    throw new TypeError('usage: proof-timeout.mjs [--allow-zero] [--label LABEL] VALUE');
  }
  process.stdout.write(`${parseProofTimeoutSeconds(positional[0], { allowZero, label })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[snapback-proof] ${error.message}\n`);
    process.exitCode = 2;
  }
}
