import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { snapbackDev } from '@expo/snapback-vite';

export default defineConfig({
  plugins: [
    svgr(),
    react(),
    snapbackDev({
      server: snapbackRelayOrigin()
        ? {mode: 'external', url: snapbackRelayOrigin()!}
        : {mode: 'attach'},
      generatedRoots: ['snapback/generated'],
    }),
  ],
  server: gatewayProxy(),
  preview: gatewayProxy(),
});

function gatewayProxy() {
  const gateway = (globalThis as {process?: {env?: Record<string, string | undefined>}})
    .process?.env?.ZERBUGS_GATEWAY_ORIGIN;
  if (!gateway) {
    return {};
  }
  return {
    proxy: {
      ...(gateway ? {
        '/api': {target: gateway, changeOrigin: false},
        '/assets': {target: gateway, changeOrigin: false},
      } : {}),
    },
  };
}

function snapbackRelayOrigin() {
  return (globalThis as {process?: {env?: Record<string, string | undefined>}})
    .process?.env?.SNAPBACK_RELAY_ORIGIN;
}
