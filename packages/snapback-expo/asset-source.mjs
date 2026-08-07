const SUPPORTED_PICKER_URI_SCHEMES = Object.freeze(new Set(['blob', 'content', 'file', 'ph']));

function sourceError(code, message, details = {}) {
  const error = new TypeError(message);
  error.code = code;
  error.diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    message,
    details: Object.freeze({ ...details }),
  });
  return error;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isBlobCompatible(value) {
  return value !== null
    && typeof value === 'object'
    && typeof value.size === 'number'
    && typeof value.slice === 'function'
    && (typeof value.arrayBuffer === 'function' || typeof value.bytes === 'function');
}

function validatePickerMetadata(source) {
  for (const field of ['fileName', 'mimeType']) {
    if (source[field] !== undefined && source[field] !== null
      && typeof source[field] !== 'string') {
      throw sourceError(
        'SNAPBACK_EXPO_ASSET_SOURCE_INVALID',
        `Expo picker ${field} must be a string when present.`,
        { field },
      );
    }
  }
}

function pickerSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw sourceError(
      'SNAPBACK_EXPO_ASSET_SOURCE_INVALID',
      'Expo command image input must be a web File/Blob or an ImagePicker asset with a URI or file.',
    );
  }
  if (isBlobCompatible(source.file)) {
    validatePickerMetadata(source);
    return { source, scheme: null };
  }
  if (!nonEmptyString(source.uri)) {
    throw sourceError(
      'SNAPBACK_EXPO_ASSET_SOURCE_INVALID',
      'Expo command image input must be a web File/Blob or an ImagePicker asset with a URI or file.',
    );
  }
  const match = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(source.uri);
  const scheme = match?.[1]?.toLowerCase()
    ?? (/^blob:/iu.test(source.uri) ? 'blob' : null);
  if (!SUPPORTED_PICKER_URI_SCHEMES.has(scheme)) {
    throw sourceError(
      'SNAPBACK_EXPO_ASSET_URI_UNSUPPORTED',
      'Expo command image input must be a web File/Blob or use a content://, ph://, file://, or blob: picker URI.',
      { scheme },
    );
  }
  validatePickerMetadata(source);
  return { source, scheme };
}

export async function resolveExpoFetch() {
  const module = await import('expo/fetch');
  if (typeof module.fetch !== 'function') {
    throw sourceError(
      'SNAPBACK_EXPO_FETCH_UNAVAILABLE',
      'The installed Expo runtime does not export expo/fetch.',
    );
  }
  return module.fetch;
}

export function expoAssetFetch(...args) {
  return resolveExpoFetch().then((fetch) => fetch(...args));
}

async function readExpoFileBytes(uri) {
  const module = await import('expo-file-system');
  if (typeof module.File !== 'function') {
    throw sourceError(
      'SNAPBACK_EXPO_FILE_SYSTEM_UNAVAILABLE',
      'The installed Expo runtime does not export expo-file-system File.',
    );
  }
  return new module.File(uri).bytes();
}

function sliceIndex(value, size, fallback) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(numeric)) return numeric < 0 ? 0 : size;
  const integer = Math.trunc(numeric);
  return integer < 0
    ? Math.max(size + integer, 0)
    : Math.min(integer, size);
}

// Expo's picker URI is process-local, while LLP 0044's canonical task needs
// a repeatably slice-readable source. Keep the selected bytes immutable and
// expose the structural Blob members that task consumes. This avoids handing
// byte custody to React Native's platform-divergent legacy Blob stores.
function byteBackedBlob(input, type = '') {
  const bytes = Uint8Array.from(input);
  const blob = {
    size: bytes.byteLength,
    type,
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
    async bytes() {
      return bytes.slice();
    },
    slice(start, end, contentType = '') {
      const from = sliceIndex(start, bytes.byteLength, 0);
      const to = Math.max(from, sliceIndex(end, bytes.byteLength, bytes.byteLength));
      return byteBackedBlob(bytes.slice(from, to), contentType);
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    get [Symbol.toStringTag]() {
      return 'Blob';
    },
  };
  return Object.freeze(blob);
}

// @ref LLP 0181#native-adapters — the Expo owner converts native picker URIs
// and keeps browser picker Files/Blobs as structural sources LLP 0044 already
// accepts, without entering React Native's legacy Blob stores. It records
// transient metadata for the existing task and creates no Expo upload state
// machine.
export function createExpoAssetSourceAdapter({
  fetch: fetchOverride = null,
  fallbackFetch: fallbackFetchOverride = null,
  readFileBytes: readFileBytesOverride = null,
} = {}) {
  let fetchPromise = null;
  return async function expoAssetSourceAdapter(input) {
    if (isBlobCompatible(input)) {
      return Object.freeze({
        file: input,
        declaredFilename: nonEmptyString(input.name) ? input.name : null,
        declaredContentType: nonEmptyString(input.type) ? input.type : null,
        previewUrl: null,
      });
    }
    const { source, scheme } = pickerSource(input);
    if (isBlobCompatible(source.file)) {
      return Object.freeze({
        file: source.file,
        declaredFilename: nonEmptyString(source.fileName)
          ? source.fileName
          : nonEmptyString(source.file.name) ? source.file.name : null,
        declaredContentType: nonEmptyString(source.mimeType)
          ? source.mimeType
          : nonEmptyString(source.file.type) ? source.file.type : null,
        previewUrl: nonEmptyString(source.uri) ? source.uri : null,
      });
    }
    let sourceFetch;
    if (scheme === 'blob') {
      sourceFetch = fetchOverride ?? globalThis.fetch;
      if (typeof sourceFetch !== 'function') {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected blob: image URI because browser fetch is unavailable.',
          { scheme },
        );
      }
    } else {
      sourceFetch = fetchOverride ?? await (fetchPromise ??= resolveExpoFetch());
    }
    let response;
    try {
      response = await sourceFetch(source.uri);
    } catch (cause) {
      throw sourceError(
        'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
        'Expo could not read the selected image URI in this live process.',
        { scheme, cause: cause?.message ?? String(cause) },
      );
    }
    if (scheme === 'blob' && Number(response?.status) >= 400) {
      throw sourceError(
        'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
        'Expo could not read the selected image URI in this live process.',
        { scheme, status: response.status },
      );
    }
    // Expo 57's Android file interceptor returns a real HTTP 404 with the
    // literal body "File not found" for some ImagePicker cache URIs that the
    // React Native resource loader can still read. Do not upload that body.
    // The fallback remains local-resource-only and never owns HTTP transport.
    if (Number(response?.status) >= 400 && scheme === 'file') {
      try {
        const bytes = await (readFileBytesOverride ?? readExpoFileBytes)(source.uri);
        response = { ok: false, status: 0, bytes: async () => bytes };
      } catch (cause) {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected image URI in this live process.',
          { scheme, status: response.status, cause: cause?.message ?? String(cause) },
        );
      }
    }
    if (scheme !== 'blob' && Number(response?.status) >= 400) {
      const fallbackFetch = fallbackFetchOverride
        ?? (fetchOverride === null ? globalThis.fetch : null);
      if (typeof fallbackFetch !== 'function' || fallbackFetch === sourceFetch) {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected image URI in this live process.',
          { scheme, status: response.status },
        );
      }
      try {
        response = await fallbackFetch(source.uri);
      } catch (cause) {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected image URI in this live process.',
          { scheme, status: response.status, cause: cause?.message ?? String(cause) },
        );
      }
    }
    // Native local-resource responses are not HTTP responses: expo/fetch can
    // report status 0 / ok false for file:// and content:// while still
    // exposing the selected bytes. Prefer bytes() and retain those bytes in a
    // structural Blob-compatible source: response.blob() can otherwise enter
    // React Native's platform-specific legacy Blob store.
    if (typeof response?.bytes !== 'function'
      && typeof response?.arrayBuffer !== 'function'
      && typeof response?.blob !== 'function') {
      throw sourceError(
        'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
        'Expo could not read the selected image URI in this live process.',
        { status: response?.status ?? null },
      );
    }
    let blob;
    if (typeof response.bytes === 'function' || typeof response.arrayBuffer === 'function') {
      let bytes;
      try {
        bytes = typeof response.bytes === 'function'
          ? await response.bytes()
          : new Uint8Array(await response.arrayBuffer());
      } catch (cause) {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected image URI in this live process.',
          { scheme, cause: cause?.message ?? String(cause) },
        );
      }
      blob = byteBackedBlob(bytes, source.mimeType ?? '');
    } else {
      try {
        blob = await response.blob();
      } catch (cause) {
        throw sourceError(
          'SNAPBACK_EXPO_ASSET_URI_UNREADABLE',
          'Expo could not read the selected image URI in this live process.',
          { scheme, cause: cause?.message ?? String(cause) },
        );
      }
    }
    if (!blob || typeof blob.size !== 'number' || typeof blob.slice !== 'function') {
      throw sourceError(
        'SNAPBACK_EXPO_ASSET_BLOB_INVALID',
        'expo/fetch did not return a Blob-compatible image source.',
      );
    }
    return Object.freeze({
      file: blob,
      declaredFilename: source.fileName ?? null,
      declaredContentType: source.mimeType ?? blob.type ?? null,
      previewUrl: source.uri,
    });
  };
}

export const adaptExpoAssetSource = createExpoAssetSourceAdapter();
