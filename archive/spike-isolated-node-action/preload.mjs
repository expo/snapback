import { Buffer } from 'node:buffer';
import { EventEmitter, addAbortListener, getEventListeners, on, once } from 'node:events';
import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomFillSync,
  randomInt,
  randomUUID,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  TextDecoder,
  TextEncoder,
  format,
  inherits,
  inspect,
  parseArgs,
  promisify,
  types,
} from 'node:util';

const processRef = globalThis.process;
const preloadStartedAt = performance.now();
const brokerRequests = [];

const deepFreeze = (value) => {
  if (value && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const brokeredFetch = async (input, init = undefined) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port !== '') {
    const error = new Error(`isolated action destination ${url.origin} is not granted; declare exact https host api.github.com:443`);
    error.code = 'SNAPBACK_ISOLATED_NODE_DESTINATION_REFUSED';
    throw error;
  }
  brokerRequests.push({ method: request.method, url: url.href, admittedAddress: 'broker-stub:no-network' });
  return new Response(JSON.stringify({ id: 10249, login: 'spike-user' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-snapback-spike-broker': 'github-fixture-v1',
    },
  });
};

const powerTable = deepFreeze({
  buffer: { Buffer },
  util: { TextDecoder, TextEncoder, format, inherits, inspect, parseArgs, promisify, types },
  events: { EventEmitter, addAbortListener, getEventListeners, on, once },
  string_decoder: { StringDecoder },
  path: { ...path.posix, posix: path.posix },
  crypto: {
    compute: { createHash, createHmac, hkdfSync, scrypt, scryptSync, timingSafeEqual },
    entropy: { randomBytes, randomFillSync, randomInt, randomUUID },
  },
  fetch: brokeredFetch,
});

const facadeSources = new Map([
  ['node:buffer', `const p=globalThis.__snapbackPowerTable.buffer;export const Buffer=p.Buffer;export default p;`],
  ['node:util', `const p=globalThis.__snapbackPowerTable.util;export const TextDecoder=p.TextDecoder,TextEncoder=p.TextEncoder,format=p.format,inherits=p.inherits,inspect=p.inspect,parseArgs=p.parseArgs,promisify=p.promisify,types=p.types;export default p;`],
  ['node:events', `const p=globalThis.__snapbackPowerTable.events;export const EventEmitter=p.EventEmitter,addAbortListener=p.addAbortListener,getEventListeners=p.getEventListeners,on=p.on,once=p.once;export default p;`],
  ['node:string_decoder', `const p=globalThis.__snapbackPowerTable.string_decoder;export const StringDecoder=p.StringDecoder;export default p;`],
  ['node:path', `const p=globalThis.__snapbackPowerTable.path;export const basename=p.basename,delimiter=p.delimiter,dirname=p.dirname,extname=p.extname,format=p.format,isAbsolute=p.isAbsolute,join=p.join,normalize=p.normalize,parse=p.parse,posix=p.posix,relative=p.relative,resolve=p.resolve,sep=p.sep,toNamespacedPath=p.toNamespacedPath;export default p;`],
  ['node:crypto', `const c=globalThis.__snapbackPowerTable.crypto.compute,e=globalThis.__snapbackPowerTable.crypto.entropy;export const createHash=c.createHash,createHmac=c.createHmac,hkdfSync=c.hkdfSync,scrypt=c.scrypt,scryptSync=c.scryptSync,timingSafeEqual=c.timingSafeEqual,randomBytes=e.randomBytes,randomFillSync=e.randomFillSync,randomInt=e.randomInt,randomUUID=e.randomUUID;export default Object.freeze({...c,...e});`],
]);
const facadeUrls = new Map([...facadeSources].map(([specifier, source]) => (
  [specifier, `data:text/javascript,${encodeURIComponent(source)}`]
)));

Object.defineProperty(globalThis, '__snapbackPowerTable', {
  value: powerTable,
  configurable: false,
  enumerable: false,
  writable: false,
});
Object.defineProperty(globalThis, 'fetch', {
  value: brokeredFetch,
  configurable: false,
  enumerable: true,
  writable: false,
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (facadeUrls.has(specifier)) {
      return { url: facadeUrls.get(specifier), shortCircuit: true };
    }
    if (specifier.startsWith('node:') || /^[A-Za-z@][^:]*$/u.test(specifier)) {
      const error = new Error(`isolated-node-action-v1 refuses runtime import ${specifier}; bundle an admitted ESM package or request a reviewed facade/grant`);
      error.code = 'SNAPBACK_ISOLATED_NODE_BUILTIN_REFUSED';
      throw error;
    }
    return nextResolve(specifier, context);
  },
});

const deniedImport = async (specifier) => {
  try {
    await import(specifier);
    return { absent: false, code: null };
  } catch (error) {
    return { absent: true, code: error?.code ?? error?.name ?? 'ERROR', message: error?.message ?? String(error) };
  }
};

Object.defineProperty(globalThis, '__snapbackCalibration', {
  value: Object.freeze({
    deniedImport,
    snapshot: () => Object.freeze({
      preloadStartedAt,
      brokerRequests: brokerRequests.map((request) => Object.freeze({ ...request })),
      rssBytes: processRef.memoryUsage().rss,
    }),
  }),
  configurable: false,
  enumerable: false,
  writable: false,
});

delete globalThis.process;
delete globalThis.require;
delete globalThis.module;
delete globalThis.WebAssembly;
