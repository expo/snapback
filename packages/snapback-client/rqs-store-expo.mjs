// Channel B persisted RQS resume store — React Native/Expo files adapter.
//
// This is the Expo carrier for the same native/DK-9 file store implemented
// by createFileRqsResumeStore, not a parallel persistence stack. The app
// hands its expo-file-system module namespace in explicitly because Metro
// resolves every literal import specifier reachable from the client root,
// including lazy dynamic imports.
//
// @ref LLP 0090#d3-channel-b--persisted-device-snapshot — the adapter rides
//   the DK-9 store-agnostic interface and inherits its fail-closed durable
//   state contract.
// @ref LLP 0129#phases — extend option A's default durable carrier to React
//   Native while preserving explicit, reported in-memory degradation.

import { registerNativeRqsFiles } from './rqs-store-default.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';

function storeError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const unavailable = (message) => storeError('SNAPBACK_RQS_STORE_UNAVAILABLE', message);

const randomBytesFromCrypto = (crypto) => {
  if (crypto === undefined) return undefined;
  if (typeof crypto?.getRandomValues !== 'function') {
    throw unavailable('the Expo RQS resume store crypto module requires getRandomValues()');
  }
  return (length) => crypto.getRandomValues(new Uint8Array(length));
};

const assertFileSystem = (fileSystem) => {
  if (typeof fileSystem?.File !== 'function' || typeof fileSystem?.Directory !== 'function') {
    throw unavailable(
      'the Expo RQS resume store requires a file-system module with File and Directory constructors',
    );
  }
};

const defaultDirectory = (fileSystem) => {
  assertFileSystem(fileSystem);
  if (fileSystem?.Paths?.document === undefined || fileSystem.Paths.document === null) {
    throw unavailable(
      'the Expo RQS resume store requires fileSystem.Paths.document when directory is omitted',
    );
  }
  return new fileSystem.Directory(fileSystem.Paths.document, 'snapback-rqs').uri;
};

const basenameFromUri = (uri) => {
  const withoutTrailingSlash = String(uri).replace(/\/+$/u, '');
  const slash = withoutTrailingSlash.lastIndexOf('/');
  return decodeURIComponent(withoutTrailingSlash.slice(slash + 1));
};

const makeLaunchId = () => {
  const values = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(values);
  } else {
    values[0] = Math.floor(Math.random() * 0x1_0000_0000);
  }
  return values[0] === 0 ? 1 : values[0];
};

// A stable, positive integer identifies this one app launch. It deliberately
// is not a device or OS process identifier: predecessor launches must always
// be reclaimable after the mobile host kills them.
const launchId = makeLaunchId();

/** Build the createFileRqsResumeStore adapter over Expo's File/Directory API. */
export function createExpoFilesAdapter(fileSystem) {
  assertFileSystem(fileSystem);
  const openFile = (...args) => new fileSystem.File(...args);
  const openDirectory = (...args) => new fileSystem.Directory(...args);

  return {
    // Expo's current File/Directory projection has no file or directory sync
    // primitive and its compatibility replacement can be non-atomic. It is
    // useful persistence, but cannot claim LLP 0043's publication boundary.
    powerLossDurable: false,
    async mkdir(path) {
      const directory = openDirectory(path);
      try {
        directory.create({ intermediates: true, idempotent: true });
      } catch (error) {
        // Expo versions/platforms may omit idempotent handling. State, never
        // a platform-specific error message, classifies the successful race.
        if (openDirectory(path).exists) return;
        throw error;
      }
    },

    async readFile(path) {
      const file = openFile(path);
      if (!file.exists) return null;
      try {
        return file.textSync();
      } catch (error) {
        if (!file.exists) return null;
        throw error;
      }
    },

    async writeFile(path, data) {
      const file = openFile(path);
      try {
        file.create({ intermediates: true, overwrite: true });
      } catch (error) {
        // Some platform projections refuse create-overwrite but still permit
        // File.write to replace an existing file.
        if (!file.exists) throw error;
      }
      file.write(data);
    },

    async writeFileExclusive(path, data) {
      const file = openFile(path);
      try {
        file.create({ intermediates: true });
      } catch (error) {
        if (file.exists) return false;
        throw error;
      }
      file.write(data);
      return true;
    },

    async rename(from, to) {
      const source = openFile(from);
      const destination = openFile(to);
      try {
        source.moveSync(destination, { overwrite: true });
      } catch (error) {
        if (!destination.exists) throw error;
        destination.delete();
        // This compatibility fallback is not atomic. This carrier has one
        // process writer, so there is no concurrent reader in the window; a
        // crash loses the blob to the fail-safe fresh-subscribe path, never
        // to a partially combined or corrupt state.
        source.moveSync(openFile(to), { overwrite: true });
      }
    },

    async unlink(path) {
      const file = openFile(path);
      if (!file.exists) return false;
      try {
        file.delete();
        return true;
      } catch (error) {
        if (!file.exists) return false;
        throw error;
      }
    },

    async readdir(path) {
      const directory = openDirectory(path);
      if (!directory.exists) return [];
      try {
        return directory.list().map((entry) => basenameFromUri(entry.uri));
      } catch (error) {
        if (!directory.exists) return [];
        throw error;
      }
    },

    // Expo's synchronous File/Directory API exposes no separate directory
    // descriptor. Completion of moveSync is its strongest publication cut;
    // adapters for platforms with an fsync primitive must perform it here.
    async syncDirectory() {},

    processId() {
      return launchId;
    },

    processAlive(pid) {
      // Mobile app containers are single-process. Only this launch is alive;
      // any other id is a killed/crashed predecessor. Constrained
      // widget/extension processes must not construct writers per LLP 0091's
      // step-5 native amendment.
      return pid === launchId;
    },
  };
}

/** Convenience constructor for an app-injected expo-file-system module. */
export function createExpoRqsResumeStore({
  fileSystem,
  crypto,
  directory,
  identity,
  randomBytes = randomBytesFromCrypto(crypto),
  ...rest
} = {}) {
  assertFileSystem(fileSystem);
  return createFileRqsResumeStore({
    ...rest,
    directory: directory ?? defaultDirectory(fileSystem),
    files: createExpoFilesAdapter(fileSystem),
    identity,
    randomBytes,
  });
}

/** Register Expo files once at the app root for the default resolver ladder. */
export function registerExpoFileSystemRqsFiles(fileSystem, { directory, crypto } = {}) {
  assertFileSystem(fileSystem);
  return registerNativeRqsFiles({
    files: createExpoFilesAdapter(fileSystem),
    directory: directory ?? defaultDirectory(fileSystem),
    implementation: 'expo-file-system',
    randomBytes: randomBytesFromCrypto(crypto),
  });
}
