#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const outDir = path.join(here, 'generated');
const appBundle = path.join(repoRoot, 'targets/cloudflare/app/notes.app.js');

const missingGetter = '  throw new Error("missing harness request getter: " + name);';
const stripKeepGuard = '  if (KEEP.has(name)) continue;';
const stripSurvivorGuard = '  if (!unreachable(name)) survivors.push(name);';
const celldRequestFallback = `  // celld 0.1.0 models these Request fields and AbortController.signal as
  // own data properties rather than Web-standard prototype getters. This
  // spike-only fallback preserves the harness's captured-access pattern while
  // making that divergence loud.
  if (
    (prototype === globalThis.Request.prototype &&
      (name === "body" || name === "headers" || name === "method" || name === "url")) ||
    (prototype === globalThis.AbortController.prototype && name === "signal")
  ) {
    return function celldOwnPlatformField() { return this[name]; };
  }
  throw new Error("missing harness request getter: " + name);`;

const celldRequestShapePlugin = {
  name: 'celld-request-own-property-shape',
  setup(esbuild) {
    esbuild.onLoad({ filter: /snapback-harness\/workerd\/strip\.mjs$/ }, async (args) => {
      const source = await fs.readFile(args.path, 'utf8');
      if (!source.includes(missingGetter)) {
        throw new Error(`could not find the handler request-getter guard in ${args.path}`);
      }
      if (!source.includes(stripKeepGuard)) {
        throw new Error(`could not find the global-strip keep guard in ${args.path}`);
      }
      if (!source.includes(stripSurvivorGuard)) {
        throw new Error(`could not find the global-strip survivor guard in ${args.path}`);
      }
      return {
        contents: source
          .replace(missingGetter, celldRequestFallback)
          .replace(
            stripKeepGuard,
            `${stripKeepGuard}\n  // Unsafe diagnostic adaptation: celld's runtime continues resolving a broad\n  // set of configurable globals after module evaluation. Preserve all of them\n  // so this run can probe DO storage/routing; it is not harness conformance.\n  continue;`,
          )
          .replace(
            stripSurvivorGuard,
            '  if (false && !unreachable(name)) survivors.push(name);',
          ),
        loader: 'js',
      };
    });
    esbuild.onLoad({ filter: /targets\/cloudflare\/app\/notes\.app\.js$/ }, async (args) => {
      const source = await fs.readFile(args.path, 'utf8');
      const tail = "      reach('HOST'),\n    ];";
      if (!source.includes(tail)) {
        throw new Error(`could not extend the ambient probe in ${args.path}`);
      }
      return {
        contents: source.replace(tail, "      reach('HOST'),\n      reach('__cell'),\n    ];"),
        loader: 'js',
      };
    });
  },
};

const celldGatewayBodyPlugin = {
  name: 'celld-do-fetch-header-tunnel',
  setup(esbuild) {
    esbuild.onLoad({ filter: /targets\/cloudflare\/src\/gateway\.js$/ }, async (args) => {
      const source = await fs.readFile(args.path, 'utf8');
      const hostCall = `      return stub.fetch('http://coordinator/_snapback/host-call', {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });`;
      const adaptedHostCall = `      return celldDoPost(stub, 'http://coordinator/_snapback/host-call', request, request.headers);`;
      const original = `async function forward(stub, target, request) {
  return stub.fetch(target, {
    method: 'POST',
    headers: { 'content-type': request.headers.get('content-type') || '' },
    body: request.body,
  });
}`;
      const adapted = `async function celldDoPost(stub, target, request, sourceHeaders) {
  // celld 0.1.0 throws in __makeIncomingRequest for a DO POST carrying a
  // body. This unsafe, bounded spike tunnel sends the small JSON body in a
  // base64 header on a GET; the coordinator rebuilds the intended POST.
  const headers = new Headers(sourceHeaders);
  headers.delete('content-length');
  const bytes = new TextEncoder().encode(await request.text());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  headers.set('x-snapback-celld-body-base64', btoa(binary));
  return stub.fetch(target, { headers });
}

async function forward(stub, target, request) {
  return celldDoPost(
    stub,
    target,
    request,
    { 'content-type': request.headers.get('content-type') || '' },
  );
}`;
      if (!source.includes(original) || !source.includes(hostCall)) {
        throw new Error(`could not find the gateway DO forwarding seams in ${args.path}`);
      }
      return {
        contents: source.replace(hostCall, adaptedHostCall).replace(original, adapted),
        loader: 'js',
      };
    });
    esbuild.onLoad({ filter: /targets\/cloudflare\/src\/coordinator\.js$/ }, async (args) => {
      const source = await fs.readFile(args.path, 'utf8');
      const original = `  async fetch(request) {
    const path = new URL(request.url).pathname;`;
      const adapted = `  async fetch(request) {
    const celldBody = request.headers.get('x-snapback-celld-body-base64');
    if (celldBody !== null) {
      const headers = new Headers(request.headers);
      headers.delete('x-snapback-celld-body-base64');
      const binary = atob(celldBody);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      request = new Request(request.url, {
        method: 'POST',
        headers,
        body: bytes,
      });
    }
    const path = new URL(request.url).pathname;`;
      if (!source.includes(original)) {
        throw new Error(`could not find the coordinator fetch seam in ${args.path}`);
      }
      return { contents: source.replace(original, adapted), loader: 'js' };
    });
  },
};

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2024',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*'],
  alias: { 'snapback-app': appBundle },
};

await fs.mkdir(outDir, { recursive: true });
await build({
  ...common,
  entryPoints: [path.join(repoRoot, 'targets/cloudflare/src/handler-worker.js')],
  outfile: path.join(outDir, 'handler-worker.js'),
  plugins: [celldRequestShapePlugin],
});
await build({
  ...common,
  entryPoints: [path.join(repoRoot, 'targets/cloudflare/src/gateway.js')],
  outfile: path.join(outDir, 'gateway.js'),
  plugins: [celldGatewayBodyPlugin],
});
