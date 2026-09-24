import type { Query } from "./contract.ts";
import { ReadObservation } from "./read-observation.ts";

export interface LocalWatch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  incarnation: number;
}

/** Every local commit retires retained and remembered answers. */
export class LocalReads {
  revision = 0;

  clear(watches: Iterable<LocalWatch>, remembered: Map<string, unknown>): void {
    this.revision++;
    remembered.clear();
    for (const watch of watches) {
      watch.reset({ loading: true });
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
    }
  }
}
