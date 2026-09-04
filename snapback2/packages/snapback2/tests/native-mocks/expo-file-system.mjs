export class FileSystemFile {
  constructor(uri) {
    this.uri = uri;
    this.type = "application/octet-stream";
    this._bytes = globalThis.__snapbackNative.fileBodies.get(uri) ?? new Uint8Array();
    globalThis.__snapbackNative.fileUris.push(uri);
  }

  get size() {
    return this._bytes.byteLength;
  }

  async arrayBuffer() {
    return this._bytes.slice().buffer;
  }

  async bytes() {
    return this._bytes.slice();
  }

  slice(start, end, contentType) {
    return new Blob([this._bytes.slice(start, end)], { type: contentType });
  }

  stream() {
    return new Blob([this._bytes]).stream();
  }

  async text() {
    return new TextDecoder().decode(this._bytes);
  }
}

export let File = class File extends FileSystemFile {
  get [Symbol.toStringTag]() {
    return "File";
  }
};

export function setFileConstructorForTest(value) {
  File = value;
}
export const Paths = { cache: "file:///cache/", document: "file:///documents/" };
export class Directory {
  constructor(...paths) { this.uri = paths.map((p) => typeof p === "string" ? p : p.uri).join("/").replace(/([^:])\/{2,}/g, "$1/").replace(/\/?$/, "/"); }
  get exists() { return [...globalThis.__snapbackNative.fileBodies.keys()].some((key) => key.startsWith(this.uri)); }
  create() {}
  list() { return [...globalThis.__snapbackNative.fileBodies.keys()].filter((key) => key.startsWith(this.uri)).map((key) => ({ name: key.slice(this.uri.length), uri: key })); }
  delete() { for (const key of globalThis.__snapbackNative.fileBodies.keys()) if (key.startsWith(this.uri)) globalThis.__snapbackNative.fileBodies.delete(key); }
}
Object.defineProperties(FileSystemFile.prototype, {
  exists: { get() { return globalThis.__snapbackNative.fileBodies.has(this.uri); } },
  parentDirectory: { get() { return new Directory(this.uri.slice(0, this.uri.lastIndexOf("/"))); } },
});
FileSystemFile.prototype.write = function(bytes) { this._bytes = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes.slice(); globalThis.__snapbackNative.fileBodies.set(this.uri, this._bytes); };
FileSystemFile.prototype.delete = function() { globalThis.__snapbackNative.fileBodies.delete(this.uri); };
