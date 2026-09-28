// Repeat the original tests byte-for-byte against the corrected client.
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const name = url.match(/\/packages\/snapback4\/test\/(ordinary-history|asset-lists)\.test\.mjs$/)?.[1];
  if (!name) return result;
  const source = execFileSync('git', ['show', `ede1f11773671436a1e9ce9ec09416500cd7e946:snapback4/packages/snapback4/test/${name}.test.mjs`], { encoding: 'utf8' });
  return { ...result, source };
} });
