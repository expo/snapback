// @ref LLP 3000#disposable-proof-caches — packed proofs never retain unique tarballs in the user's npm cache.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function npmCacheEnv(directory, env = process.env) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // npm's lowercase lifecycle configuration takes precedence over uppercase.
  return { ...env, NPM_CONFIG_CACHE: directory, npm_config_cache: directory,
    SNAPBACK4_PRIVATE_NPM_CACHE: directory };
}

const inherited = process.env.SNAPBACK4_PRIVATE_NPM_CACHE;
if (!inherited || process.env.NPM_CONFIG_CACHE !== inherited || process.env.npm_config_cache !== inherited) {
  const directory = mkdtempSync(join(tmpdir(), `snapback4-npm-${process.pid}-`));
  Object.assign(process.env, npmCacheEnv(directory));
  // Only the creator removes this directory. Children inherit it; file runners
  // put theirs under a parent-owned root, also reclaimed after forced exits.
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
}
