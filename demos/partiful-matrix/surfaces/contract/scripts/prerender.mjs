#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { renderContractStaticDocument } from '../node_modules/@exact/devtools/src/contract-static-html.ts';
import { portablePartitimeArtifactProvenance } from '../../../shared/vite-cost-attribution.mjs';

const surfaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const mode = args.get('--mode') ?? 'snapback';
const outDir = resolve(surfaceRoot, args.get('--out-dir') ?? `dist/${mode}`);
const basePath = process.env.PARTITIME_BASE_PATH ?? '/partitime/';
const canonicalOrigin = process.env.PARTITIME_CANONICAL_ORIGIN ?? 'https://partitime.example';
const nowMs = Date.UTC(2026, 6, 20, 12, 0, 0);

function inlineJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pageHtml(shell, { document, routeId, title, description, canonicalPath }) {
  const portableManifest = portablePartitimeArtifactProvenance(document.manifest);
  const staticRoot = [
    `<div id="exact-root" data-partitime-static-route="${routeId}">`,
    document.schemeCss ? `<style data-exact-contract-scheme="">${document.schemeCss}</style>` : '',
    document.html,
    `<script id="__partitime-hydration" type="application/json" data-exact-contract-hydration="">${inlineJson(portableManifest)}</script>`,
    '</div>',
  ].join('');
  const firstPaintWitness = `<script>window.__partitimeStaticWitness={routeId:${JSON.stringify(routeId)},root:document.getElementById("exact-root"),initialText:document.getElementById("exact-root").innerText,rootReplacements:0,childListMutations:0};new MutationObserver(function(records){for(const record of records){if(record.type==="childList")window.__partitimeStaticWitness.childListMutations+=1;if(!document.documentElement.contains(window.__partitimeStaticWitness.root))window.__partitimeStaticWitness.rootReplacements+=1}}).observe(document.documentElement,{childList:true,subtree:true})</script>`;
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace('<head>', `<head><meta name="description" content="${description.replaceAll('"', '&quot;')}"/><link rel="canonical" href="${canonicalOrigin}${canonicalPath}"/>`)
    .replace('<div id="exact-root"></div>', `${staticRoot}${firstPaintWitness}`);
}

const server = await createServer({
  configFile: resolve(surfaceRoot, 'vite.config.ts'),
  root: surfaceRoot,
  mode,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});

try {
  const [feedModule, eventModule, generated, hydration, runtime, facet] = await Promise.all([
    server.ssrLoadModule('/feed.contract'),
    server.ssrLoadModule('/event.contract'),
    server.ssrLoadModule('/data/provider.generated.ts'),
    server.ssrLoadModule('/production-hydration.ts'),
    server.ssrLoadModule('@exact/contract/runtime'),
    server.ssrLoadModule('@exact/facet-core'),
  ]);
  const [shell, manifest, seed] = await Promise.all([
    readFile(resolve(outDir, 'index.html'), 'utf8'),
    readFile(resolve(surfaceRoot, '../../snapback/generated/contract-data.manifest.json'), 'utf8').then(JSON.parse),
    readFile(resolve(surfaceRoot, '../../snapback/seed.json'), 'utf8').then(JSON.parse),
  ]);
  const provider = hydration.createStaticPartitimeProvider(manifest, seed);
  generated.configureGeneratedProviderLinks(hydration.linksForProvider(provider));
  facet.setThemeViewportWidth(1024);
  facet.setThemeReducedMotion(false);

  const pages = [];
  const feed = await renderContractStaticDocument(server, feedModule.default, {
    rootId: 0x5054_0001,
    routeId: '/',
    buildId: `partitime-${mode}-feed-v1`,
    nowMs,
    props: { userName: 'Ada', backendName: mode, initialVariant: 'warm' },
  });
  const feedPath = resolve(outDir, 'index.html');
  const feedHtml = pageHtml(shell, {
    document: feed,
    routeId: '/',
    title: 'Partitime · plans worth leaving the chat for',
    description: 'Small gatherings, good people, and plans worth leaving the chat for.',
    canonicalPath: basePath,
  });
  await writeFile(feedPath, feedHtml);
  pages.push({ routeId: '/', path: feedPath.slice(outDir.length + 1), htmlSha256: digest(feedHtml), nodes: feed.manifest.nodes.length });

  for (const event of seed.tables.events) {
    const routeId = `/events/${encodeURIComponent(event._id)}/`;
    const rendered = await renderContractStaticDocument(server, eventModule.default, {
      rootId: 0x5054_1000 + pages.length,
      routeId,
      buildId: `partitime-${mode}-${event._id}-v1`,
      nowMs,
      props: {
        eventId: event._id,
        userId: 'user_ada',
        userName: 'Ada',
        backendName: mode,
        visualVariant: 'warm',
      },
    });
    const outputPath = resolve(outDir, 'events', event._id, 'index.html');
    const html = pageHtml(shell, {
      document: rendered,
      routeId,
      title: `${event.title} · Partitime`,
      description: event.description,
      canonicalPath: `${basePath}events/${encodeURIComponent(event._id)}/`,
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html);
    pages.push({ routeId, path: outputPath.slice(outDir.length + 1), htmlSha256: digest(html), nodes: rendered.manifest.nodes.length });
  }

  const receipt = {
    schemaVersion: 'partitime.contract-static-export.v1',
    mode,
    basePath,
    canonicalOrigin,
    nowMs,
    renderer: '@exact/devtools/contract-static-html',
    pages,
  };
  await writeFile(resolve(outDir, 'static-export.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`[partitime/prerender] wrote ${pages.length} authoritative Contract documents to ${outDir}`);
  runtime.reset();
  generated.resetGeneratedProviderLinks();
} finally {
  await server.close();
}
