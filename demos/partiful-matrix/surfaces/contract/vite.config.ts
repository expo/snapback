import { exactContractWeb } from '@exact/devtools/contract-web';
import type { Plugin } from 'vite';

function costAttribution(): Plugin {
  return {
    name: 'partitime-cost-attribution',
    generateBundle(_options, bundle) {
      const modules = Object.values(bundle)
        .filter((item) => item.type === 'chunk')
        .flatMap((chunk) => Object.entries(chunk.modules).map(([id, value]) => ({
          id,
          renderedBytes: value.renderedLength,
          chunk: chunk.fileName,
        })))
        .sort((left, right) => right.renderedBytes - left.renderedBytes || left.id.localeCompare(right.id));
      this.emitFile({
        type: 'asset',
        fileName: 'partitime-cost-attribution.json',
        source: `${JSON.stringify({ schemaVersion: 'partitime.web-cost-attribution.v1', modules }, null, 2)}\n`,
      });
    },
  };
}

export default ({ mode, command }: { mode: string; command: 'serve' | 'build' }) => {
  const base = process.env.PARTITIME_BASE_PATH ?? (command === 'build' ? '/partitime/' : '/');
  return {
    root: __dirname,
    base,
    plugins: [exactContractWeb({ data: 'snapback', app: { entry: '/main.ts' } }), costAttribution()],
    define: {
      __MATRIX_BACKEND__: JSON.stringify(mode),
      __PARTITIME_BASE_PATH__: JSON.stringify(base),
      __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? ''),
      __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? ''),
      __PARTITIME_DISABLE_POLL_FALLBACK__: JSON.stringify(process.env.PARTITIME_DISABLE_POLL_FALLBACK === '1'),
      __CONVEX_URL__: JSON.stringify(process.env.CONVEX_URL ?? ''),
    },
    server: {
      host: '127.0.0.1', port: 5192, fs: { allow: ['../../../..'] },
      proxy: {
        '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/matrix-api/, '') },
        '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/snapback/, '') },
      },
    },
    preview: {
      host: '127.0.0.1',
      proxy: {
        '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/matrix-api/, '') },
        '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/snapback/, '') },
      },
    },
  };
};
