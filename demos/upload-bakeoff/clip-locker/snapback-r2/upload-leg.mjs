// One instrumented upload leg, run as its own OS process so a "kill" is a
// real process death with a real aborted connection.
//
// Byte accounting: globalThis.fetch is wrapped BEFORE the asset client ever
// runs, and every request's body bytes are counted (TUS PATCH bodies are
// Uint8Array chunks; JSON bodies are strings). HTTP header overhead is NOT
// counted — the ledger records request counts so the fixed per-request
// overhead stays visible. The client is used at DEFAULTS: no chunkBytes, no
// timeouts. The only non-default construction input is a file-backed task
// store (an implementation of the documented AssetTaskStore interface, which
// the in-memory default cannot provide across a process kill).
//
// Config comes as one JSON argv:
//   { baseUrl, bearer, filePath, storePath, mode: 'start'|'resume',
//     killAtFraction?, assetId?, reportPath, uploadIntent?, declaredFilename? }
// Exit codes: 0 ready, 9 deliberate kill, 1 failed, 2 setup error.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(process.argv[2]);

// ---- transport instrumentation (before any client code runs) ----
const ledger = {
  mode: config.mode,
  requests: [],
  patchBodyBytesTotal: 0,
  totalBodyBytes: 0,
  createResponse: null,
  headOffset: null,
  tusResponseHeaders: null,
  startedAtMs: Date.now(),
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body;
  let bodyBytes = 0;
  if (body != null) {
    bodyBytes = typeof body === 'string'
      ? Buffer.byteLength(body)
      : (body.byteLength ?? body.length ?? 0);
  }
  const path = String(url).replace(config.baseUrl, '');
  const entry = { method, path: path.slice(0, 80), bodyBytes, status: null };
  ledger.requests.push(entry);
  ledger.totalBodyBytes += bodyBytes;
  if (method === 'PATCH') ledger.patchBodyBytesTotal += bodyBytes;
  const response = await realFetch(url, init);
  entry.status = response.status;
  if (method === 'POST' && path === '/assets/attempts' && response.ok) {
    const clone = response.clone();
    ledger.createResponse = await clone.json().catch(() => null);
  }
  if (method === 'HEAD') {
    ledger.headOffset = Number(response.headers.get('upload-offset') ?? 'NaN');
  }
  if (method === 'PATCH' && ledger.tusResponseHeaders === null) {
    ledger.tusResponseHeaders = {
      'tus-resumable': response.headers.get('tus-resumable'),
      'snapback-max-chunk-bytes': response.headers.get('snapback-max-chunk-bytes'),
      'upload-offset': response.headers.get('upload-offset'),
    };
  }
  return response;
};

const { createExternalSessionClient } = await import(
  join(here, '..', '..', '..', '..', 'packages', 'snapback-client', 'index.mjs')
);
const { createAssetClient } = await import(
  join(here, '..', '..', '..', '..', 'packages', 'snapback-client', 'assets.mjs')
);
// The generated upload reference. The documented "or its intent name" string
// form fails server-side (SNAPBACK_REQUEST_JSON_INVALID: intentPolicyHash
// null), so the generated reference is the working product path.
const { importGeneratedModule } = await import(
  join(here, '..', '..', '..', '_kit', 'generated-artifacts.mjs')
);
const { default: api } = await importGeneratedModule(join(here, 'snapback', 'generated'), 'api.mjs');

// File-backed AssetTaskStore (the documented interface, sync JSON file).
function createFileAssetTaskStore(path) {
  const load = () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  return {
    get: (key) => load()[key] ?? null,
    set: (key, value) => {
      const all = load();
      all[key] = value;
      writeFileSync(path, JSON.stringify(all));
    },
    delete: (key) => {
      const all = load();
      delete all[key];
      writeFileSync(path, JSON.stringify(all));
    },
    keys: () => Object.keys(load()),
  };
}

function fileOf(buffer, name) {
  return {
    name,
    size: buffer.length,
    type: 'video/mp4',
    slice: (start, end) => ({
      arrayBuffer: async () => buffer.subarray(start ?? 0, end ?? buffer.length),
    }),
  };
}

function report(extra) {
  ledger.endedAtMs = Date.now();
  writeFileSync(config.reportPath, JSON.stringify({ ...ledger, ...extra }, null, 2));
}

try {
  const buffer = readFileSync(config.filePath);
  const localDigest = createHash('sha256').update(buffer).digest('hex');
  const client = createExternalSessionClient(config.baseUrl, { bearerToken: config.bearer });
  const assets = createAssetClient(client, {
    taskStore: createFileAssetTaskStore(config.storePath),
  });
  const file = fileOf(buffer, config.declaredFilename ?? basename(config.filePath));

  const task = config.mode === 'resume'
    ? assets.resumePersisted({ assetId: config.assetId, file })
    : assets.start({
        upload: api[config.uploadIntent],
        file,
        declaredFilename: file.name,
        declaredContentType: 'video/mp4',
      });
  if (!task) {
    report({ status: 'no-persisted-fact', fileSize: buffer.length, localDigest });
    process.exit(2);
  }

  const killAt = config.killAtFraction ? Math.floor(buffer.length * config.killAtFraction) : null;
  task.subscribe((s) => {
    if (killAt !== null && s.status === 'uploading' && s.bytesTransferred >= killAt) {
      report({
        status: 'killed',
        killMethod:
          'process.exit(9) fired synchronously from the task subscribe callback '
          + 'the moment the server-acknowledged offset first reached >= 50% of '
          + 'the file — the process (and any connection) dies between the '
          + 'acknowledged chunk and the next PATCH',
        killedAtOffset: s.bytesTransferred,
        fileSize: buffer.length,
        assetId: s.assetId,
        attemptId: s.attemptId,
        localDigest,
      });
      process.exit(9);
    }
  });

  const finished = await task.done;
  report({
    status: finished.status,
    diagnostic: finished.diagnostic,
    assetId: finished.assetId,
    attemptId: finished.attemptId,
    bytesTransferred: finished.bytesTransferred,
    fileSize: buffer.length,
    localDigest,
  });
  process.exit(finished.status === 'ready' ? 0 : 1);
} catch (error) {
  report({ status: 'threw', error: String(error?.stack ?? error) });
  process.exit(2);
}
