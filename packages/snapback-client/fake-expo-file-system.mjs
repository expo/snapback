// Node projection of the pinned Expo File/Directory API consumed by the
// adapter conformance tests. This intentionally models only that structural
// surface and uses a real temporary-directory filesystem underneath it.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const valueUri = (value) => value?.uri ?? String(value);

const toPath = (value) => {
  const uri = valueUri(value);
  return uri.startsWith('file:') ? fileURLToPath(uri) : uri;
};

const joinedUri = (parts) => {
  if (parts.length === 0) throw new Error('a File or Directory URI is required');
  const [first, ...rest] = parts;
  const path = rest.reduce((current, part) => join(current, toPath(part)), toPath(first));
  return pathToFileURL(path).href;
};

export function createFakeExpoFileSystem(rootDir) {
  const documentPath = join(rootDir, 'document');
  const cachePath = join(rootDir, 'cache');
  mkdirSync(documentPath, { recursive: true });
  mkdirSync(cachePath, { recursive: true });

  class File {
    constructor(...uris) {
      this.uri = joinedUri(uris);
    }

    get exists() {
      return existsSync(toPath(this));
    }

    get name() {
      return decodeURIComponent(this.uri.replace(/\/+$/u, '').split('/').at(-1));
    }

    create({ intermediates = false, overwrite = false } = {}) {
      const path = toPath(this);
      if (existsSync(path) && !overwrite) throw new Error('file already exists');
      if (intermediates) mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '', { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
    }

    write(content) {
      writeFileSync(toPath(this), content, 'utf8');
    }

    textSync() {
      return readFileSync(toPath(this), 'utf8');
    }

    async text() {
      return this.textSync();
    }

    delete() {
      const path = toPath(this);
      if (!existsSync(path)) throw new Error('file does not exist');
      rmSync(path);
    }

    moveSync(destination, { overwrite = false } = {}) {
      const from = toPath(this);
      const to = toPath(destination);
      if (!existsSync(from)) throw new Error('source file does not exist');
      if (existsSync(to)) {
        if (!overwrite) throw new Error('destination file already exists');
        rmSync(to, { recursive: true, force: true });
      }
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      this.uri = pathToFileURL(to).href;
    }
  }

  class Directory {
    constructor(...uris) {
      this.uri = joinedUri(uris);
    }

    get exists() {
      return existsSync(toPath(this));
    }

    get name() {
      return decodeURIComponent(this.uri.replace(/\/+$/u, '').split('/').at(-1));
    }

    create({ intermediates = false, idempotent = false } = {}) {
      const path = toPath(this);
      if (existsSync(path)) {
        if (idempotent) return;
        throw new Error('directory already exists');
      }
      mkdirSync(path, { recursive: intermediates });
    }

    list() {
      const path = toPath(this);
      if (!existsSync(path)) throw new Error('directory does not exist');
      return readdirSync(path, { withFileTypes: true }).map((entry) => (
        entry.isDirectory()
          ? new Directory(this, entry.name)
          : new File(this, entry.name)
      ));
    }

    delete() {
      const path = toPath(this);
      if (!existsSync(path)) throw new Error('directory does not exist');
      rmSync(path, { recursive: true });
    }
  }

  const Paths = {
    document: new Directory(pathToFileURL(documentPath).href),
    cache: new Directory(pathToFileURL(cachePath).href),
  };
  const module = { File, Directory, Paths };
  return { module, rootDir, documentPath, cachePath };
}
