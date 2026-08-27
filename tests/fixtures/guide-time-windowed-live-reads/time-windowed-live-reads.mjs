export const HOUR_MS = 60 * 60 * 1_000;
export const SOON_MS = 60 * 1_000;

export async function openTrendingWindow(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, windowMs: HOUR_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}

export async function openExpiringSoon(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, soonWithinMs: SOON_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}

export async function refreshTimeWindow(current, openSuccessor) {
  await current.handle.dispose();
  return openSuccessor();
}
