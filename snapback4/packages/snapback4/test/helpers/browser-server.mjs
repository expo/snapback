// @ref LLP 3000#publication-suite-under-contention — immutable fixtures must not invalidate mounted browser contexts.
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../../..');
const require = createRequire(resolve(root, 'packages/snapback4/package.json'));
const vite = () => import(pathToFileURL(createRequire(resolve(root, 'apps/chat/package.json')).resolve('vite')).href);
const dependencies = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

// Immutable browser fixtures have no package manifest in their temporary root.
// Prebundle all React entry points before serving: discovering another CJS entry
// later can invalidate already-served modules and request a full-page reload.
// HMR alone suppresses that message, but does not prevent the invalidation.
export async function createBrowserServer(config) {
  const { createServer } = await vite();
  return createServer({
    ...config,
    // A TMPDIR below a package must not inherit that package's shared cache:
    // another fixture can replace its optimized files while a page uses them.
    cacheDir: resolve(config.root, '.vite'),
    optimizeDeps: { noDiscovery: true, include: dependencies },
    server: { ...config.server, hmr: false, watch: null,
      // Darwin's tmpdir may spell /private/var as /var. Lazy modules do not
      // inherit the initial crawl's safe-module exemption from this allowlist.
      fs: { ...config.server?.fs, allow: config.server.fs.allow.map(path => realpathSync(path)) },
    },
    resolve: { ...config.resolve, alias: [
      ...(config.resolve?.alias ?? []),
      ...dependencies.map(name => ({ find: new RegExp('^' + name + '$'), replacement: require.resolve(name) })),
    ] },
  });
}

export async function browserLogger(trace) {
  const { createLogger } = await vite();
  const logger = createLogger('info');
  for (const level of ['info', 'warn', 'error']) logger[level] = message => trace('vite:' + level, message);
  return logger;
}
