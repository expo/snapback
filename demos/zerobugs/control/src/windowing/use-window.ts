import {useEffect, useMemo, useSyncExternalStore} from 'react';

import {
  WindowController,
  type WindowControllerOptions,
  type WindowSnapshot,
} from './controller';

export type UseWindowOptions<Row, Cursor> = WindowControllerOptions<Row, Cursor> & Readonly<{
  permalinkID?: string | null;
}>;

export type UseWindowValue<Row, Cursor> = Readonly<{
  controller: WindowController<Row, Cursor>;
  snapshot: WindowSnapshot<Row, Cursor>;
  loadForward(): Promise<void>;
  loadBackward(): Promise<void>;
  loadPermalink(id: string): Promise<void>;
  measure(key: string, height: number): void;
}>;

/**
 * React owns no rows here: it only observes an app-owned, server-backed
 * controller. A changed identity constructs an already-blank generation, so
 * predecessor rows cannot render for one transitional frame.
 */
export function useWindow<Row, Cursor>(
  options: UseWindowOptions<Row, Cursor>,
): UseWindowValue<Row, Cursor> {
  // `identity` is the semantic dependency: it must include query, args,
  // order, and bounds. Source/estimator closures may be recreated by a UI
  // render without retiring a valid controller generation.
  const controller = useMemo(() => new WindowController(options), [
    options.identity,
    options.pageSize,
  ]);
  const snapshot = useSyncExternalStore(
    listener => controller.subscribe(listener),
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (options.permalinkID) void controller.loadPermalink(options.permalinkID);
    else void controller.loadInitial();
  }, [controller, options.permalinkID]);

  return useMemo(() => Object.freeze({
    controller,
    snapshot,
    loadForward: () => controller.loadForward(),
    loadBackward: () => controller.loadBackward(),
    loadPermalink: (id: string) => controller.loadPermalink(id),
    measure: (key: string, height: number) => controller.measure(key, height),
  }), [controller, snapshot]);
}
