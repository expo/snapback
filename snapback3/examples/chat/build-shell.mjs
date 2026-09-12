import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Every release identifies the exact shell bytes, including the worker policy. */
export async function writeServiceWorker(output, files) {
  const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
  const assets = await Promise.all([...new Set(files)].sort().map(async file => {
    if (!/^[A-Za-z0-9_./-]+\.(?:html|js|css)$/.test(file) || file.includes('..') || file.startsWith('/')) {
      throw new Error(`The offline shell accepts only relative HTML, JS and CSS assets: ${file}`);
    }
    const bytes = await readFile(resolve(output, file));
    return { url: `/${file}`, integrity: `sha256-${createHash('sha256').update(bytes).digest('base64')}` };
  }));
  const version = createHash('sha256').update(template).update(JSON.stringify(assets)).digest('hex');
  await writeFile(resolve(output, 'service-worker.js'), template
    .replace('__SHELL_VERSION__', JSON.stringify(version))
    .replace('__SHELL_ASSETS__', JSON.stringify(assets)));
  return { version, assets };
}
