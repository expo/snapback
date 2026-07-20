import { exactContractWeb } from '@exact/devtools/contract-web';

export default ({ mode }: { mode: string }) => ({
  root: __dirname,
  plugins: [exactContractWeb({ data: 'snapback', app: { entry: '/main.ts' } })],
  define: {
    __MATRIX_BACKEND__: JSON.stringify(mode),
    __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433'),
    __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460'),
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
});
