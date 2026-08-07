function browserCacheArm() {
  try {
    const storage = globalThis.localStorage;
    if (
      typeof storage?.getItem !== 'function'
      || typeof storage?.setItem !== 'function'
      || typeof storage?.removeItem !== 'function'
    ) return null;
    return {
      async load(key) {
        const value = storage.getItem(key);
        return value === null ? null : JSON.parse(value);
      },
      async save(key, record) {
        storage.setItem(key, JSON.stringify(record));
      },
      async clear(key) {
        storage.removeItem(key);
      },
    };
  } catch {
    return null;
  }
}

function browserStorageCandidate() {
  try {
    return 'localStorage' in globalThis;
  } catch {
    return false;
  }
}

function reactNativeRuntime() {
  try {
    return globalThis.navigator?.product === 'ReactNative';
  } catch {
    return false;
  }
}

async function expoFileCacheArm() {
  if (!reactNativeRuntime()) return null;
  try {
    const fileSystem = await import('expo-file-system');
    if (typeof fileSystem.File !== 'function' || fileSystem.Paths?.document == null) return null;
    const file = new fileSystem.File(
      fileSystem.Paths.document,
      'snapback-expo',
      'supervised-binding.v1.json',
    );
    return {
      async load() {
        if (!file.exists) return null;
        const value = typeof file.text === 'function'
          ? await file.text()
          : file.textSync();
        return JSON.parse(value);
      },
      async save(_key, record) {
        try {
          file.create({ intermediates: true, overwrite: true });
        } catch (error) {
          if (!file.exists) throw error;
        }
        file.write(JSON.stringify(record));
      },
      async clear() {
        if (file.exists) file.delete();
      },
    };
  } catch {
    return null;
  }
}

async function resolveCacheArm() {
  // @ref LLP 0181#package-contract — supervised persistence is a development
  // carrier only; production exports prune both resolution arms and their
  // endpoint-adjacent vocabulary.
  if (process.env.NODE_ENV !== 'production') {
    return browserCacheArm() ?? await expoFileCacheArm();
  }
  return null;
}

function cacheKey() {
  if (process.env.NODE_ENV !== 'production') {
    return 'snapback.expo.supervised-binding.v1';
  }
  return '';
}

export function createDefaultSupervisedBindingCache() {
  if (process.env.NODE_ENV !== 'production') {
    // Capability probing is side-effect-free; the storage/module operations
    // remain lazy so provider-module evaluation never performs cache I/O.
    if (!browserStorageCandidate() && !reactNativeRuntime()) return null;
    return Object.freeze({
      async load() {
        try {
          return await (await resolveCacheArm())?.load(cacheKey()) ?? null;
        } catch {
          return null;
        }
      },
      async save(record) {
        try {
          await (await resolveCacheArm())?.save(cacheKey(), record);
        } catch {
          // Availability-only persistence never owns supervised boot.
        }
      },
      async clear() {
        try {
          await (await resolveCacheArm())?.clear(cacheKey());
        } catch {
          // Availability-only persistence never owns supervised boot.
        }
      },
    });
  }
  return null;
}
