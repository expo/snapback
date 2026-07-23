import { useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useSnapbackQuery } from '../../../../../packages/snapback-react/index.mjs';

import {
  PERSONAS,
  type EventRow,
  type MatrixProvider,
} from '../../../shared/model';
import { createMatrixProvider } from './provider';

// @ref LLP 0063#2026-07-23-two-part-subscription-memory-construct — this
// sibling entry retains public React binding lifecycles without emitting
// subscriber DOM, so the fitted slope is logical-subscription cost rather
// than a repeated product tree.

interface PartitimeMemoryHarness {
  readonly arm: 'react';
  readonly backend: string;
  start(count: number): Promise<{ count: number; ready: number }>;
  disposeSubscribers(): Promise<void>;
  dispose(): Promise<void>;
  snapshot(): { active: number; ready: number };
}

declare global {
  var partitimeMemoryHarness: PartitimeMemoryHarness | undefined;
  var partitimeMemoryHarnessReady: Promise<PartitimeMemoryHarness> | undefined;
}

function Subscriber({
  provider,
  index,
  onReady,
}: {
  provider: MatrixProvider;
  index: number;
  onReady(index: number): void;
}) {
  const snapshot = useSnapbackQuery<EventRow>({
    provider,
    name: 'listEvents',
    args: {},
    userId: PERSONAS[0].userId,
    authority: PERSONAS[0].userId,
  });
  useEffect(() => {
    if (
      snapshot.rows.length > 0
      && (snapshot.connection === 'live' || snapshot.connection === 'polling')
    ) {
      onReady(index);
    }
  }, [index, onReady, snapshot.connection, snapshot.rows.length]);
  return null;
}

function SubscriberDrain() {
  return null;
}

async function boot(): Promise<PartitimeMemoryHarness> {
  const provider = await createMatrixProvider();
  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  let root: Root | null = createRoot(container);
  let subscribersActive = false;
  let active = 0;
  let ready = new Set<number>();
  let drainGeneration = 0;
  let resolveReady: ((value: { count: number; ready: number }) => void) | null = null;

  const disposeSubscribers = async () => {
    if (subscribersActive) {
      // React's alternate fiber tree retains the just-removed subscriber
      // generation for one commit. Advance through a no-DOM sentinel commit,
      // then an empty commit, before judging recovery.
      root?.render(<SubscriberDrain key={drainGeneration += 1} />);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      root?.render(null);
    }
    subscribersActive = false;
    active = 0;
    ready = new Set();
    resolveReady = null;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const harness: PartitimeMemoryHarness = {
    arm: 'react',
    backend: provider.backend,
    async start(count) {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new TypeError('subscriber count must be a positive safe integer');
      }
      if (subscribersActive) throw new Error('React memory subscribers are already active');
      active = count;
      subscribersActive = true;
      ready = new Set();
      const settled = new Promise<{ count: number; ready: number }>((resolve) => {
        resolveReady = resolve;
      });
      const onReady = (index: number) => {
        ready.add(index);
        if (ready.size === active) {
          resolveReady?.({ count: active, ready: ready.size });
          resolveReady = null;
        }
      };
      root?.render(Array.from(
        { length: count },
        (_, index) => (
          <Subscriber
            key={index}
            provider={provider}
            index={index}
            onReady={onReady}
          />
        ),
      ));
      return settled;
    },
    disposeSubscribers,
    async dispose() {
      await disposeSubscribers();
      root?.unmount();
      root = null;
      await provider.dispose?.();
      container.replaceChildren();
      container.remove();
      delete globalThis.partitimeMemoryHarness;
    },
    snapshot: () => ({ active, ready: ready.size }),
  };
  root.render(null);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  globalThis.partitimeMemoryHarness = harness;
  return harness;
}

globalThis.partitimeMemoryHarnessReady = boot();
