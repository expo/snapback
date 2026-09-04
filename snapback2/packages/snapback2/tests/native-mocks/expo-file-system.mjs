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
