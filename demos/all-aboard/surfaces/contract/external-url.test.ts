import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { openExternalUrl } from './external-url';

type UrlOpenTestGlobal = typeof globalThis & {
  exact?: unknown;
  __hostCall?: (operation: string, argsJson: string) => unknown;
  __hostCallAsync?: (operation: string, argsJson: string) => Promise<unknown>;
  open?: (url?: string | URL, target?: string, features?: string) => unknown;
};

const host = globalThis as UrlOpenTestGlobal;
const originalExact = host.exact;
const originalSync = host.__hostCall;
const originalAsync = host.__hostCallAsync;
const originalOpen = host.open;

beforeEach(() => {
  delete host.exact;
  delete host.__hostCall;
  delete host.__hostCallAsync;
  delete host.open;
});

afterEach(() => {
  if (typeof originalExact === 'undefined') delete host.exact;
  else host.exact = originalExact;
  if (typeof originalSync === 'undefined') delete host.__hostCall;
  else host.__hostCall = originalSync;
  if (typeof originalAsync === 'undefined') delete host.__hostCallAsync;
  else host.__hostCallAsync = originalAsync;
  if (typeof originalOpen === 'undefined') delete host.open;
  else host.open = originalOpen;
});

describe('openExternalUrl', () => {
  test('uses Exact desktop.shell.openExternal when a native host bridge exists', async () => {
    const calls: Array<{ operation: string; argsJson: string }> = [];
    let browserOpens = 0;
    host.__hostCallAsync = async (operation, argsJson) => {
      calls.push({ operation, argsJson });
      return { opened: true };
    };
    host.open = () => {
      browserOpens += 1;
      return null;
    };

    await openExternalUrl('https://maps.apple.com/?daddr=37.1,-122.1');

    expect(calls).toEqual([{
      operation: 'desktop.shell.openExternal',
      argsJson: '{"url":"https://maps.apple.com/?daddr=37.1,-122.1"}',
    }]);
    expect(browserOpens).toBe(0);
  });

  test('preserves window.open in a browser without an Exact host bridge', async () => {
    const calls: Array<[string | URL | undefined, string | undefined, string | undefined]> = [];
    host.open = (url, target, features) => {
      calls.push([url, target, features]);
      return null;
    };

    await openExternalUrl('https://www.google.com/maps/dir/?api=1');

    expect(calls).toEqual([
      ['https://www.google.com/maps/dir/?api=1', '_blank', 'noopener'],
    ]);
  });

  test('does nothing for an empty URL', async () => {
    let calls = 0;
    host.__hostCallAsync = async () => {
      calls += 1;
      return null;
    };
    host.open = () => {
      calls += 1;
      return null;
    };

    await openExternalUrl('');
    expect(calls).toBe(0);
  });
});
