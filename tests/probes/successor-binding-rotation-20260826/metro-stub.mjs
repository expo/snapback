// Headless Metro stand-in for the LLP 0310 P19 / LLP 0310.000 A0 probe.
// Serves the published generated graph the way Metro would, and exits with the
// same code the real watcher does when a codegen staging directory vanishes
// under it (LLP 0310 P3), so the probe cannot silently pass through a Track C
// regression.
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const origin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
const backendOrigin = process.env.EXPO_PUBLIC_SNAPBACK_URL;
const generatedRoot = process.env.SNAPBACK_EXPO_TEST_GENERATED_ROOT;

function publishedGraph() {
  const aliasSource = readFileSync(join(generatedRoot, 'app.mjs'), 'utf8');
  const bindingMatch = /from "\.\/(app\.binding\.[0-9a-f]{64}\.mjs)"/u.exec(aliasSource);
  if (bindingMatch === null) throw new Error('generated app alias has no digest binding');
  const bindingPath = join(generatedRoot, bindingMatch[1]);
  if (!existsSync(bindingPath)) throw new Error('digest binding is not yet published');
  const bindingSource = readFileSync(bindingPath, 'utf8');
  const descriptorMatch = /from "\.\/(app\.descriptor\.[0-9a-f]{64}\.json)"/u.exec(bindingSource);
  if (descriptorMatch === null) throw new Error('digest binding has no digest descriptor');
  const descriptorPath = join(generatedRoot, descriptorMatch[1]);
  if (!existsSync(descriptorPath)) throw new Error('digest descriptor is not yet published');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  return Object.freeze({ descriptorIdentity: descriptor.identity.descriptor });
}

let servedGraph = publishedGraph();
let refreshTimer = null;
const refreshPublishedGraph = () => {
  try {
    servedGraph = publishedGraph();
  } catch {
    refreshTimer = setTimeout(refreshPublishedGraph, 10);
  }
};
const scheduleRefresh = () => {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshPublishedGraph, 10);
};
const generatedWatcher = watch(generatedRoot, scheduleRefresh);
const stagingWatcher = watch(join(generatedRoot, '..'), (_event, filename) => {
  const entry = String(filename ?? '').split(/[\\/]/u)[0];
  if (!/^(?:\.generated\.tmp-|generated\.tmp-|generated\.bak-)/u.test(entry)) return;
  console.error(`ENOENT: Metro observed disappearing codegen staging directory ${entry}`);
  process.exit(86);
});

writeFileSync(process.env.SNAPBACK_EXPO_TEST_ENV, JSON.stringify({
  ci: process.env.CI ?? null,
  backendOrigin: backendOrigin ?? null,
}));
writeFileSync(process.env.SNAPBACK_EXPO_TEST_BUNDLE, [
  '// probe Metro bundle fixture',
  `export const supervisedOrigin = ${JSON.stringify(origin)};`,
].join('\n') + '\n');
writeFileSync(process.env.SNAPBACK_EXPO_TEST_SOURCE_MAP, JSON.stringify({
  version: 3, sources: ['App.tsx'], sourcesContent: [''], names: [], mappings: '',
}));

const server = createServer((request, response) => {
  if (request.url === '/bundle') {
    response.setHeader('content-type', 'application/javascript');
    response.end(
      `globalThis.__SNAPBACK_DESCRIPTOR_IDENTITY__ = ${JSON.stringify(servedGraph.descriptorIdentity)};\n`,
    );
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true }));
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
const stop = () => {
  generatedWatcher.close();
  stagingWatcher.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
