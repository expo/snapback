import { pathToFileURL } from 'node:url';

const localPlaywright = pathToFileURL(new URL('../node_modules/playwright/index.mjs', import.meta.url).pathname).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright') return { url: localPlaywright, shortCircuit: true };
  return nextResolve(specifier, context);
}
