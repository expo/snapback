import { afterEach, describe, expect, it } from 'bun:test';

import { GatewayContractProvider } from '../../native/exact-contract/src/partitime/provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('GatewayContractProvider', () => {
  it('publishes pending synchronously and defers initial transport work', async () => {
    let fetchCalls = 0;
    const statuses: string[] = [];
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ ok: true, value: [{ _id: 'event-1' }] }),
      } as Response;
    }) as typeof fetch;

    const provider = new GatewayContractProvider(
      'snapback',
      'http://127.0.0.1:4460',
      'user_ada',
    );
    const subscription = provider.subscribe(
      'listEvents',
      {},
      (cell) => statuses.push(cell.status),
    );

    expect(statuses).toEqual(['pending']);
    expect(fetchCalls).toBe(0);

    await new Promise((resolve) => globalThis.setTimeout(resolve, 10));

    expect(fetchCalls).toBe(1);
    expect(statuses).toEqual(['pending', 'ready']);
    subscription.dispose();
    provider.dispose();
  });
});
