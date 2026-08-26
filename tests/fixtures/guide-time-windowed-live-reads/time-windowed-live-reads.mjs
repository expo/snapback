export const HOUR_MS = 60 * 60 * 1_000;

export async function openTimeWindow(client, reference, connectionId) {
  const clockMs = Date.now();
  const handle = await client.liveQuery(reference, {
    connectionId,
    args: { clockMs, windowMs: HOUR_MS },
    transport: 'stream',
  });
  return { clockMs, handle };
}

export async function refreshTimeWindow(current, client, reference, connectionId) {
  await current.handle.dispose();
  return openTimeWindow(client, reference, connectionId);
}
