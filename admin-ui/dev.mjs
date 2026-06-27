// Browser dev server for the Snapback admin Contract console.
//
// Snapback remains the API/runtime authority. This process serves only the UI
// with Vite hot updates and proxies /_snapback/api/* to a running Snapback
// server.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveSnapbackContractApp } from '../packages/snapback-contract/build-preset.mjs';
import { generateAdminContractBindings } from './generate-contract-bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const bindingInputs = [
  resolve(here, 'contract-bindings.mjs'),
  resolve(here, 'generate-contract-bindings.mjs'),
];

const initial = await generateAdminContractBindings({ root: here });
console.log(`admin-ui: generated Contract bindings -> ${initial.outDir}`);

const result = await serveSnapbackContractApp({
  root: here,
  exactRoot: process.env.SNAPBACK_EXACT_ROOT ?? resolve(here, '../../exact'),
  entry: '/src/main.ts',
  routeRegistry: 'src/app/routes.ts',
  apiTarget: process.env.SNAPBACK_ADMIN_DEV_API ?? null,
  host: process.env.SNAPBACK_ADMIN_DEV_HOST ?? null,
  port: process.env.SNAPBACK_ADMIN_DEV_PORT ?? null,
});

installBindingWatcher(result.server);

function installBindingWatcher(server) {
  const watched = new Set(bindingInputs);
  server.watcher.add(bindingInputs);
  server.watcher.on('change', async (path) => {
    if (!watched.has(resolve(path))) {
      return;
    }
    try {
      const regenerated = await generateAdminContractBindings({
        root: here,
        cacheBust: true,
      });
      console.log(`admin-ui: regenerated Contract bindings -> ${regenerated.outDir}`);
      server.ws.send({ type: 'full-reload' });
    } catch (error) {
      server.config.logger.error(
        `admin-ui: failed to regenerate Contract bindings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
