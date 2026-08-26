import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./loader.mjs', pathToFileURL(import.meta.filename));
// `app-state.web.mjs` refuses to reach for react-native-web unless a DOM-shaped
// document is present, exactly as it does in a browser.
globalThis.document = globalThis.document ?? {
  addEventListener() {},
  removeEventListener() {},
};
