import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, version as esbuildVersion } from '../node_modules/esbuild/lib/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(here, '..');
const allowedResidualBuiltins = new Set([
  'node:buffer', 'node:util', 'node:events', 'node:string_decoder', 'node:path', 'node:crypto',
]);

export async function buildBundle() {
  const outputDirectory = join(spikeRoot, 'artifacts', 'bundle');
  const outputPath = join(outputDirectory, 'vendor-action.bundle.mjs');
  mkdirSync(outputDirectory, { recursive: true });
  const result = await build({
    absWorkingDir: spikeRoot,
    entryPoints: ['fixtures/vendor-action.mjs'],
    outfile: outputPath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node24'],
    conditions: ['node', 'import', 'default'],
    nodePaths: [join(spikeRoot, 'sdk-project', 'node_modules')],
    sourcemap: 'linked',
    sourcesContent: true,
    metafile: true,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const source = readFileSync(outputPath, 'utf8');
  const mapPath = `${outputPath}.map`;
  const mapBytes = readFileSync(mapPath);
  const sourceMap = JSON.parse(mapBytes);
  const absoluteSources = sourceMap.sources.filter((sourcePath) => sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(sourcePath));
  const checkoutPathPresent = mapBytes.includes(Buffer.from(resolve(spikeRoot, '..')));
  if (absoluteSources.length > 0 || checkoutPathPresent) {
    throw new Error(`source map contains absolute paths: ${absoluteSources.join(', ') || 'checkout path in bytes'}`);
  }
  const residualImports = [...source.matchAll(/\b(?:from\s*|import\s*\()(["'])([^"']+)\1/gu)].map((match) => match[2]);
  const unsupportedImports = residualImports.filter((specifier) => (
    !allowedResidualBuiltins.has(specifier)
    && !specifier.startsWith('./')
    && !specifier.startsWith('../')
    && !specifier.startsWith('file:')
  ));
  if (unsupportedImports.length > 0) throw new Error(`bundle retains unsupported imports: ${unsupportedImports.join(', ')}`);
  for (const [code, pattern] of [
    ['SNAPBACK_ISOLATED_NODE_BUNDLE_REQUIRE_REFUSED', /\brequire\s*\(/u],
  ]) {
    if (pattern.test(source)) {
      const error = new Error(`${code}: final bundle contains ${pattern}`);
      error.code = code;
      throw error;
    }
  }
  const bytes = statSync(outputPath).size;
  if (bytes > 32 * 1024 * 1024) throw new Error(`bundle is ${bytes} bytes; maximum is 33554432`);
  return {
    outputPath,
    mapPath,
    bytes,
    mapBytes: statSync(mapPath).size,
    sha256: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    mapSha256: `sha256:${createHash('sha256').update(mapBytes).digest('hex')}`,
    sourceCount: sourceMap.sources.length,
    absoluteSourcePaths: absoluteSources,
    checkoutPathPresent,
    residualImports,
    esbuildVersion,
    inputCount: Object.keys(result.metafile.inputs).length,
    output: relative(spikeRoot, outputPath),
  };
}
