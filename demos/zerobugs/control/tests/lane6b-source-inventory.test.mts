import {expect, test} from 'bun:test';
import {readdir, readFile, stat} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

type Inventory = Readonly<{
  format: string;
  pinnedRoot: string;
  replacements: readonly Readonly<{source: string; target: string; reason: string}>[];
}>;

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(join(controlRoot, 'source-inventory.v1.json'), 'utf8')) as Inventory;
const pinnedRoot = process.env.ZBUGS_PINNED_SRC ?? inventory.pinnedRoot;

async function files(root: string, current = root): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(current, {withFileTypes: true})) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) output.push(...await files(root, absolute));
    else if (entry.isFile()) output.push(relative(root, absolute));
  }
  return output.sort();
}

test('ZB0: every pinned source file is ported or explicitly replaced', async () => {
  expect(inventory.format).toBe('zerobugs-source-inventory.v1');
  expect((await stat(pinnedRoot)).isDirectory()).toBe(true);
  const pinned = await files(pinnedRoot);
  const ported = new Set(await files(join(controlRoot, 'src')));
  const replacements = new Map(inventory.replacements.map(entry => [entry.source, entry]));
  const unexplained: string[] = [];
  for (const source of pinned) {
    if (ported.has(source)) continue;
    const replacement = replacements.get(source);
    if (!replacement || !ported.has(replacement.target) || replacement.reason.trim() === '') {
      unexplained.push(source);
    }
  }
  expect(unexplained).toEqual([]);
  expect(pinned.length).toBeGreaterThan(100);
});

test('ZB0: byte-designated assets remain exactly pinned', async () => {
  const pinnedAssets = (await files(join(pinnedRoot, 'assets'))).map(path => `assets/${path}`);
  for (const asset of pinnedAssets) {
    expect(await readFile(join(controlRoot, 'src', asset))).toEqual(await readFile(join(pinnedRoot, asset)));
  }
});

test('ZB0: UI sources cannot bypass the Lane 6a adapter or resurrect readable JWT custody', async () => {
  const sourceFiles = (await files(join(controlRoot, 'src'))).filter(path => /\.(?:ts|tsx)$/.test(path));
  const forbidden: string[] = [];
  for (const path of sourceFiles) {
    const text = await readFile(join(controlRoot, 'src', path), 'utf8');
    if (/@rocicorp\/zero|shared\/queries|shared\/mutators|Authorization\s*:\s*[`'"]Bearer/.test(text)) {
      forbidden.push(path);
    }
  }
  expect(forbidden).toEqual([]);
  await expect(stat(join(controlRoot, 'src', 'jwt.ts'))).rejects.toThrow();
});
