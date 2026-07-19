// Shindig — Contract surface Vite config, following the todo-v2 shape
// (ENG-22487 paved-road preset; ENG-23899 registry packages): `exactContractWeb`
// composes the Contract compiler plugin and the Exact app plugin, with Exact
// consumed from the npm registry through the @exact/* aliases in package.json.
// The surface talks to Snapback DIRECTLY at the defined origin (loopback CORS;
// the bun-vite proxy cannot complete WebSocket upgrades), same default port as
// the React arm so both surfaces compare against one server.

import { realpathSync } from 'node:fs';

import { exactContractWeb } from '@exact/devtools/contract-web';

const snapbackTarget = process.env.SNAPBACK_SHINDIG_API ?? 'http://127.0.0.1:4431';

const sourceProvenanceProbe = {
  name: 'snapback-source-provenance',
  configureServer(server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          req: unknown,
          res: { setHeader: (k: string, v: string) => void; end: (body: string) => void },
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'shindig',
          surface: 'contract',
          root: realpathSync(__dirname),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default () => ({
  root: __dirname,
  plugins: [
    sourceProvenanceProbe,
    exactContractWeb({
      data: 'snapback',
      app: { entry: '/main.ts' },
    }),
  ],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: false,
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
