// @ref LLP 0109#63-reset-install-and-clear — destructive demo isolation is
// explicit reset-install against the previewed predecessor stream; it never
// falls back to legacy reset/seed once a generated seed identity exists.
export async function resetInstallGeneratedSeed(client, artifact) {
  const preview = await client.previewVersionedSeed(artifact, {
    // The non-destructive classification exposes the exact current stream;
    // the destructive request then binds that predecessor explicitly.
    operation: 'install',
    requestedMode: 'sessions',
  });
  const stream = preview?.requested?.dataVersionStream;
  return client.resetInstallVersionedSeed(artifact, {
    requestedMode: 'sessions',
    expectedDataVersionStream: typeof stream === 'string'
      ? { state: 'present', value: stream }
      : { state: 'absent' },
  });
}
