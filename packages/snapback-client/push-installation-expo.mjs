const INSTALLATION_PATTERN = /^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u;
const ARTIFACT_KIND = 'snapback.push-installation.v1';
const DEFAULT_DIRECTORY = 'snapback-push';
const FILENAME = 'installation.v1.json';

const storageCache = new WeakMap();

const custodyError = (code, message) => {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  return error;
};

const custodyCorrupt = () => custodyError(
  'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT',
  'stored installation identity is invalid',
);

const custodyUnavailable = () => custodyError(
  'SNAPBACK_PUSH_INSTALLATION_CUSTODY_UNAVAILABLE',
  'the Expo installation-identity store is unavailable',
);

const assertFileSystem = (fileSystem) => {
  if (
    !fileSystem
    || typeof fileSystem !== 'object'
    || typeof fileSystem.File !== 'function'
    || typeof fileSystem.Directory !== 'function'
    || fileSystem.Paths?.document === undefined
    || fileSystem.Paths.document === null
  ) {
    throw new TypeError(
      'fileSystem must provide File, Directory, and Paths.document',
    );
  }
};

/**
 * Create LLP 0143's conventional Expo installation-identity store. The app
 * injects expo-file-system so importing the optional push registry never
 * closes over an undeclared native module. The file is device-scoped and
 * deliberately separate from RQS state.
 *
 * @ref LLP 0143#d1-device-token-custody — logout/account switch preserve the
 * dedicated device identity; app-data reset/reinstall replace it.
 */
export function createExpoPushInstallationStorage({ fileSystem, directory } = {}) {
  assertFileSystem(fileSystem);
  let directoryRef;
  try {
    directoryRef = directory === undefined
      ? new fileSystem.Directory(fileSystem.Paths.document, DEFAULT_DIRECTORY)
      : new fileSystem.Directory(directory);
  } catch {
    throw custodyUnavailable();
  }
  if (typeof directoryRef?.uri !== 'string' || directoryRef.uri.length === 0) {
    throw custodyUnavailable();
  }

  let stores = storageCache.get(fileSystem);
  if (stores === undefined) {
    stores = new Map();
    storageCache.set(fileSystem, stores);
  }
  const cached = stores.get(directoryRef.uri);
  if (cached !== undefined) return cached;

  const installationFile = () => new fileSystem.File(
    new fileSystem.Directory(directoryRef.uri),
    FILENAME,
  );
  const storage = Object.freeze({
    async read() {
      const file = installationFile();
      if (!file.exists) return null;
      let encoded;
      try {
        encoded = file.textSync();
      } catch {
        if (!file.exists) return null;
        throw custodyUnavailable();
      }
      let artifact;
      try {
        artifact = JSON.parse(encoded);
      } catch {
        throw custodyCorrupt();
      }
      if (
        !artifact
        || typeof artifact !== 'object'
        || Array.isArray(artifact)
        || artifact.artifactKind !== ARTIFACT_KIND
        || typeof artifact.installationId !== 'string'
        || !INSTALLATION_PATTERN.test(artifact.installationId)
        || Object.keys(artifact).length !== 2
      ) throw custodyCorrupt();
      return artifact.installationId;
    },

    async write(installationId) {
      if (typeof installationId !== 'string' || !INSTALLATION_PATTERN.test(installationId)) {
        throw custodyCorrupt();
      }
      try {
        const targetDirectory = new fileSystem.Directory(directoryRef.uri);
        if (!targetDirectory.exists) {
          targetDirectory.create({ intermediates: true, idempotent: true });
        }
        const file = installationFile();
        if (file.exists) return;
        try {
          file.create({ intermediates: true });
        } catch (error) {
          if (file.exists) return;
          throw error;
        }
        file.write(JSON.stringify({
          artifactKind: ARTIFACT_KIND,
          installationId,
        }));
      } catch (error) {
        if (error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT') throw error;
        throw custodyUnavailable();
      }
    },

    async clear() {
      try {
        const file = installationFile();
        if (file.exists) file.delete();
      } catch {
        throw custodyUnavailable();
      }
    },
  });
  stores.set(directoryRef.uri, storage);
  return storage;
}
