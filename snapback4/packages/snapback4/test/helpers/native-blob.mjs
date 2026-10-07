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

// Execute Expo's real public blob()/arrayBuffer()/createBlob code. Only native
// network I/O and the native byte store are injected, as they cannot run in Node.
// A second RN module instance exercises Expo's actual constructor fallback.
export function expoBlobResponse(host, { duplicate = false, read = async () => Uint8Array.of(1, 2, 3).buffer,
  convert = async () => 'expo-image', status = 206 } = {}) {
  const root = join(dirname(require.resolve('expo/package.json')), 'src/winter/fetch');
  const ts = require('typescript'), cache = new Map(), counts = { reads: 0, conversions: 0 };
  const importedBlob = duplicate ? nativeBlobHost().Blob : host.Blob;
  const ExpoFetchModule = {
    NativeResponse: class {
      addListener() {}
      get _rawHeaders() { return [['content-type', 'image/png'], ['content-length', '3']]; }
      get status() { return status; }
      async arrayBuffer() { counts.reads++; return read(); }
    },
    async unstable_createBlobData(bytes) { counts.conversions++; return convert(bytes); },
  };
  function load(name) {
    if (name === './ExpoFetchModule') return { ExpoFetchModule };
    if (name === 'react-native/Libraries/Blob/Blob') return { default: importedBlob };
    if (name === 'react-native/Libraries/Blob/BlobManager') return { default: { createFromOptions: options => host.create(options.blobId, options.size) } };
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} }; cache.set(name, module);
    const { outputText } = ts.transpileModule(readFileSync(join(root, name + '.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    vm.runInThisContext(`(function(require,module,exports,__DEV__){${outputText}\n})`, { filename: name })(load, module, module.exports, false);
    return module.exports;
  }
  const { FetchResponse } = load('./FetchResponse');
  return { counts, response: () => new FetchResponse(() => {}) };
}
