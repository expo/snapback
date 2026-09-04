import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  OfflineStoreFailure,
  PersistentRangeStore,
  type PersistedRangeState,
  type PrincipalPartition,
  type RangeStoreBackend,
  type RangeStoreFactory,
} from "./range-store.js";

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
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as PersistedRangeState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new OfflineStoreFailure(
        "E_OFFLINE_CARRIER",
        `Node file carrier could not open ${this.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async replace(state: PersistedRangeState): Promise<void> {
    if (!this.path) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "Node file carrier is not open");
    const temporary = `${this.path}.tmp-${process.pid}-${++this.writeNumber}`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await this.options.beforeRename?.(temporary, this.path);
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    const target = this.partitionPath(partition);
    await rm(target, { force: true });
    if (this.path === target) this.path = undefined;
  }

  close(): void {
    this.path = undefined;
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
