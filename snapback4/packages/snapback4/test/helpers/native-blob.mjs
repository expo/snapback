// Run the installed React Native Blob/BlobManager implementation, including its
// buffer-part refusal, in production mode. Only the native byte store is mocked.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
export function nativeBlobHost() {
  const root = join(dirname(require.resolve('react-native/package.json')), 'Libraries/Blob');
  const cache = new Map(), released = [], writes = [];
  const native = { createFromParts: (...args) => writes.push(args), release: id => released.push(id) };
  function load(name) {
    if (name === './NativeBlobModule') return { __esModule: true, default: native };
    if (name === 'invariant') return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} }; cache.set(name, module);
    const { code } = transformSync(readFileSync(join(root, name + '.js'), 'utf8'), {
      configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-flow-strip-types', '@babel/plugin-transform-modules-commonjs'],
    });
    const run = vm.runInThisContext(`(function(require,module,exports,__DEV__){${code}\n})`, { filename: name });
    run(load, module, module.exports, false);
    return module.exports;
  }
  const Blob = load('./Blob').default, manager = load('./BlobManager').default;
  return { Blob, released, writes, create: (id, size = 3) => manager.createFromOptions({ blobId: id, offset: 0, size, type: 'image/png' }) };
}
