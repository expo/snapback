import { Directory, File, Paths } from "expo-file-system";
import type { NativeFileSystem } from "../react-native/files.js";

/** SDK 54 File.write accepts Uint8Array directly; no Blob or base64 file ingress. */
export function expoAssetFileSystem(): NativeFileSystem {
  return {
    root: new Directory(Paths.cache, "snapback2").uri,
    async exists(uri) { return new File(uri).exists; },
    async list(uri) {
      const directory = new Directory(uri);
      return directory.exists ? directory.list().map((entry) => entry.name) : [];
    },
    async write(uri, bytes) {
      const file = new File(uri);
      file.parentDirectory.create({ idempotent: true, intermediates: true });
      file.write(bytes);
    },
    async remove(uri) {
      const entry = uri.endsWith("/") ? new Directory(uri) : new File(uri);
      if (entry.exists) entry.delete();
    },
  };
}
