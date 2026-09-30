// Use the main snapshot's compiled SDK without replacing the active build.
// QS_MAIN_DIST points to its dist directory; e.g. /tmp/qs-main-dist.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.env.QS_MAIN_DIST;
if (!root) throw Error('QS_MAIN_DIST must name the baseline compiled SDK');
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  const marker = '/packages/snapback4/dist/';
  if (!url.startsWith('file:') || !url.includes(marker) || !url.endsWith('.js')) return loaded;
  const relative = fileURLToPath(url).split(marker)[1];
  return { ...loaded, source: readFileSync(join(root, relative), 'utf8') };
} });
