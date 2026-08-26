// Resolves the one third-party specifier `app-state.web.mjs` reaches on web.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const stub = pathToFileURL(join(here, 'rnw-appstate-stub.mjs')).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'react-native-web/dist/exports/AppState/index.js') {
    return { url: stub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
