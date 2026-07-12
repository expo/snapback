// @ref LLP 0052#acceptance-gates — measure the real mounted surface against the fixed D1–D5 gates.
// LLP 0052 final acceptance: a Vite-resolved lazy edge to Exact's dev-only
// reporter and reactive counters. The production/native startup graph never
// imports this module; the acceptance runner requests it after mount.
import {
  getContractDataflowSnapshot,
  installContractDeterminismHost,
  reactiveChurn,
  snapshotReactiveGraph,
  type ContractDeterminismHost,
} from '@exact/contract/runtime';
import {
  contractClockDebugSnapshot,
  notifyContractClockWallJump,
} from '@exact/contract/runtime/temporal';
import {
  _hostStateDebugSnapshotForTests,
  publishHostTransaction,
} from '@exact/contract/runtime/host-bindings';
import {
  createTextInstance,
  updateTextContent,
} from '@exact/renderer/host-ops';

interface UpdateEconomyRendererApi {
  getReport(): unknown;
  reset(): void;
  bridge: { finishCommit(rootId: number, durationMs: number): void };
}

export async function installUpdateEconomyReporter(): Promise<void> {
  await import('@exact/renderer/update-economy');
}

export function sampleUpdateEconomy(sinceWave?: number): {
  reactive: ReturnType<typeof reactiveChurn>;
  renderer: unknown;
} {
  const renderer = (globalThis as { __exactUpdateEconomy?: UpdateEconomyRendererApi })
    .__exactUpdateEconomy;
  return {
    reactive: reactiveChurn(sinceWave === undefined ? {} : { sinceWave }),
    renderer: renderer?.getReport() ?? null,
  };
}

export function resetUpdateEconomyRenderer(): void {
  (globalThis as { __exactUpdateEconomy?: UpdateEconomyRendererApi })
    .__exactUpdateEconomy?.reset();
}

const acceptanceHostSnapshot = Object.freeze({
  colorScheme: 'light' as const,
  safeAreaInsets: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  geolocation: Object.freeze({
    status: 'unavailable' as const,
    source: 'host' as const,
    message: 'geolocation is unavailable',
  }),
  appGlue: Object.freeze({ backend: Object.freeze({ status: 'connected' }) }),
});

interface AcceptanceHostOverrides {
  colorScheme?: 'light' | 'dark';
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
  geolocation?: {
    status: 'pending' | 'available' | 'denied' | 'unavailable';
    coords?: { latitude: number; longitude: number };
    source?: string;
    message?: string;
  };
  backendStatus?: 'connecting' | 'connected' | 'offline';
}

/** Publish a fresh D1 transaction for behavioral and value-equality gates. */
export function publishAcceptanceHostSnapshot(overrides: AcceptanceHostOverrides = {}): void {
  publishHostTransaction({
    colorScheme: overrides.colorScheme ?? acceptanceHostSnapshot.colorScheme,
    safeAreaInsets: {
      ...(overrides.safeAreaInsets ?? acceptanceHostSnapshot.safeAreaInsets),
    },
    geolocation: {
      ...acceptanceHostSnapshot.geolocation,
      ...overrides.geolocation,
    },
    appGlue: {
      backend: {
        status: overrides.backendStatus ?? acceptanceHostSnapshot.appGlue.backend.status,
      },
    },
  });
}

export function sampleHostBindingDebug(): ReturnType<typeof _hostStateDebugSnapshotForTests> {
  return _hostStateDebugSnapshotForTests();
}

/** Settle every root derive, then return its JSON-safe reactive value. */
export function sampleAllAboardDerives(): Record<string, unknown> {
  getContractDataflowSnapshot({
    component: 'AllAboard',
    include: ['derives'],
    includeValues: 'none',
  });
  const compactValue = (name: string, value: unknown): unknown => {
    if (name === 'station' && value && typeof value === 'object') {
      return { id: (value as { id?: unknown }).id };
    }
    if (name === 'matches' && Array.isArray(value)) {
      return value.map((item) => item && typeof item === 'object'
        ? (item as { id?: unknown }).id
        : null);
    }
    if (name === 'feedSource' && value && typeof value === 'object') {
      const source = value as { live?: unknown; label?: unknown; color?: unknown };
      return { live: source.live, label: source.label, color: source.color };
    }
    return value;
  };
  return Object.fromEntries(
    snapshotReactiveGraph().nodes
      .filter((node) => node.label.startsWith('AllAboard.derive.'))
      .map((node) => {
        const name = node.label.slice('AllAboard.derive.'.length);
        return [name, compactValue(name, node.value)];
      }),
  );
}

interface ScriptedTimer {
  callback: () => void;
  dueAt: number;
  intervalMs: number | null;
}

let scriptedNowMs: number | null = null;
let nextScriptedTimerId = 1;
let scriptedTimers = new Map<number, ScriptedTimer>();
let restoreScriptedHost: (() => void) | null = null;

/**
 * Move the mounted production temporal queue onto a deterministic clock.
 * This lives only on the acceptance-only lazy edge; release bundles never
 * import it. The queue and terminal binding under test are the app's real
 * runtime instances, not a parallel timer implementation.
 */
export function beginScriptedContractClock(nowMs: number): ReturnType<typeof contractClockDebugSnapshot> {
  if (restoreScriptedHost) throw new Error('scripted Contract clock is already active');
  if (!Number.isFinite(nowMs)) throw new Error('scripted Contract clock requires finite nowMs');
  scriptedNowMs = nowMs;
  nextScriptedTimerId = 1;
  scriptedTimers = new Map();
  const schedule = (callback: () => void, delayMs: number, intervalMs: number | null): number => {
    const id = nextScriptedTimerId++;
    scriptedTimers.set(id, {
      callback,
      dueAt: scriptedNowMs! + Math.max(0, Number(delayMs) || 0),
      intervalMs,
    });
    return id;
  };
  const host: ContractDeterminismHost = {
    now: () => scriptedNowMs!,
    random: () => 0.5,
    setTimeout: (callback, delayMs) => schedule(callback, delayMs, null),
    clearTimeout: (handle) => { scriptedTimers.delete(Number(handle)); },
    setInterval: (callback, delayMs) => schedule(callback, delayMs, Math.max(1, delayMs)),
    clearInterval: (handle) => { scriptedTimers.delete(Number(handle)); },
  };
  restoreScriptedHost = installContractDeterminismHost(host);
  return contractClockDebugSnapshot();
}

export function advanceScriptedContractClock(nowMs: number): ReturnType<typeof contractClockDebugSnapshot> {
  if (!restoreScriptedHost || scriptedNowMs === null) {
    throw new Error('scripted Contract clock is not active');
  }
  if (!Number.isFinite(nowMs) || nowMs < scriptedNowMs) {
    throw new Error('scripted Contract clock can only advance to a finite later time');
  }
  scriptedNowMs = nowMs;
  let guard = 0;
  while (true) {
    if (guard++ > 10_000) throw new Error('scripted Contract clock did not settle');
    const due = [...scriptedTimers.entries()]
      .filter(([, timer]) => timer.dueAt <= scriptedNowMs!)
      .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0]);
    if (due.length === 0) break;
    for (const [id, timer] of due) {
      if (scriptedTimers.get(id) !== timer) continue;
      if (timer.intervalMs === null) scriptedTimers.delete(id);
      else timer.dueAt += timer.intervalMs;
      timer.callback();
    }
  }
  return contractClockDebugSnapshot();
}

export function endScriptedContractClock(): ReturnType<typeof contractClockDebugSnapshot> {
  if (restoreScriptedHost) restoreScriptedHost();
  restoreScriptedHost = null;
  scriptedNowMs = null;
  scriptedTimers.clear();
  // The scripted advance moved presentation one authored boundary ahead of
  // ambient wall time. Revalidate after restoring the real host so the app's
  // text and next registered deadline return to the live timeline instead of
  // suppressing the imminent ambient transition.
  notifyContractClockWallJump();
  return contractClockDebugSnapshot();
}

/** Exercise the real D3 raw-text boundary with an intentionally equal write. */
export function exerciseRawTextEqualityProbe(): void {
  const renderer = (globalThis as { __exactUpdateEconomy?: UpdateEconomyRendererApi })
    .__exactUpdateEconomy;
  if (!renderer) throw new Error('update-economy reporter is not installed');
  const text = createTextInstance('LLP 0052 equality probe');
  updateTextContent(text, 'LLP 0052 equality probe');
  renderer.bridge.finishCommit(0, 0);
}
