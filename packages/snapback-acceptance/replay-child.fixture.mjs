import { readFileSync } from 'node:fs';

import { defineReplay, runReplay } from './replay.mjs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = await runReplay(defineReplay(config.definition), {
  resume: config.resume ?? false,
});
process.exitCode = result.exitCode;
