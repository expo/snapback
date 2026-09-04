import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  OfflineStoreFailure,
  PersistentRangeStore,
  type PersistedRangeState,
  type PrincipalPartition,
  type RangeStoreBackend,
  type RangeStoreFactory,
} from "./range-store.js";
import type { ByteDelta } from "./byte-cache.js";

export interface FileRangeStoreOptions {
  /** Test barrier used to prove a failed pre-rename write leaves the old file. */
  beforeRename?: (temporaryPath: string, finalPath: string) => void | Promise<void>;
}

class FileBackend implements RangeStoreBackend {
  readonly carrier = "Node file";
  private path?: string;
  private writeNumber = 0;

  constructor(private readonly root: string, private readonly options: FileRangeStoreOptions) {}

  async open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined> {
    await mkdir(this.root, { recursive: true });
    this.path = this.partitionPath(partition);
    let state: PersistedRangeState | undefined;
    try {
      state = JSON.parse(await readFile(this.path, "utf8")) as PersistedRangeState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new OfflineStoreFailure(
          "E_OFFLINE_CARRIER",
          `Node file carrier could not open ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    await this.sweepBytes(state);
    return state;
  }

  // @ref LLP 1012#9-asset-bytes-on-the-device — the index in the state file is the
  // authority over bytes: payloads are written before the rename that publishes
  // them and dropped after the rename that forgets them, so a crash leaves only
  // garbage the next open sweeps, never a served byte without its row.
  async replace(state: PersistedRangeState, bytes: ByteDelta): Promise<void> {
    if (!this.path) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "Node file carrier is not open");
    const temporary = `${this.path}.tmp-${process.pid}-${++this.writeNumber}`;
    await mkdir(dirname(this.path), { recursive: true });
    if (bytes.put.length > 0) {
      await mkdir(this.bytesDirectory(), { recursive: true });
      for (const item of bytes.put) {
        await writeFile(join(this.bytesDirectory(), item.key), item.bytes, { mode: 0o600 });
      }
    }
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await this.options.beforeRename?.(temporary, this.path);
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    for (const key of bytes.remove) {
      await rm(join(this.bytesDirectory(), key), { force: true }).catch(() => undefined);
    }
  }

  async readBytes(key: string): Promise<Uint8Array | undefined> {
    if (!this.path) return undefined;
    try {
      return new Uint8Array(await readFile(join(this.bytesDirectory(), key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    const target = this.partitionPath(partition);
    await rm(target, { force: true });
    await rm(`${target.slice(0, -".json".length)}.bytes`, { recursive: true, force: true });
    if (this.path === target) this.path = undefined;
  }

  close(): void {
    this.path = undefined;
  }

  private async sweepBytes(state: PersistedRangeState | undefined): Promise<void> {
    const directory = this.bytesDirectory();
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return;
    }
    const held = state?.assets ?? {};
    for (const name of names) {
      if (held[name] === undefined) await rm(join(directory, name), { force: true }).catch(() => undefined);
    }
  }

  private bytesDirectory(): string {
    return `${this.path!.slice(0, -".json".length)}.bytes`;
  }

  private partitionPath(partition: PrincipalPartition): string {
    return resolve(this.root, `${encodeURIComponent(partition)}.json`);
  }
}

/** Node-only carrier used by `snapback2 test` and durability harnesses. */
export function fileRangeStore(root: string, options: FileRangeStoreOptions = {}): RangeStoreFactory {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("fileRangeStore requires a directory");
  const absolute = resolve(root);
  const factory = (() => new PersistentRangeStore(new FileBackend(absolute, options))) as RangeStoreFactory;
  Object.defineProperty(factory, "carrier", { value: "Node file" });
  return factory;
}
