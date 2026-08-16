import { Linking, Platform } from 'react-native';

export type ProbeCommand = Readonly<{
  id: string;
  name: string;
  args?: Readonly<Record<string, unknown>>;
}>;

type CommandHandler = (command: ProbeCommand) => Promise<unknown>;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function initialDirectorOrigin(): Promise<string> {
  const link = await Linking.getInitialURL();
  if (link !== null) {
    const director = new URL(link).searchParams.get('director');
    if (director !== null) return new URL(director).origin;
  }
  return Platform.OS === 'android' ? 'http://10.0.2.2:18771' : 'http://127.0.0.1:18771';
}

async function post(origin: string, path: string, body: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`director ${path} returned HTTP ${response.status}`);
}

export async function startWitness(
  launchId: string,
  onCommand: CommandHandler,
  onStatus: (status: string) => void,
) {
  const directorOrigin = await initialDirectorOrigin();
  const emit = async (event: string, details: Readonly<Record<string, unknown>> = {}) => {
    await post(directorOrigin, '/event', {
      schemaVersion: 'snapback.native-custody-event.v1',
      launchId,
      platform: Platform.OS,
      event,
      details,
      atMs: Date.now(),
    });
  };
  (globalThis as { __nativeCustodyProbeEmit?: typeof emit }).__nativeCustodyProbeEmit = emit;
  await emit('witness-ready', { launchId });

  for (;;) {
    try {
      onStatus('waiting for command');
      const response = await fetch(`${directorOrigin}/cmd?launchId=${encodeURIComponent(launchId)}`);
      if (response.status === 204) continue;
      if (!response.ok) throw new Error(`director /cmd returned HTTP ${response.status}`);
      const command = await response.json() as ProbeCommand;
      onStatus(`running ${command.name}`);
      try {
        const result = await onCommand(command);
        await post(directorOrigin, '/result', {
          schemaVersion: 'snapback.native-custody-result.v1',
          launchId,
          commandId: command.id,
          command: command.name,
          ok: true,
          result,
          atMs: Date.now(),
        });
      } catch (error) {
        const candidate = error as { code?: unknown; diagnostic?: { code?: unknown } };
        const code = typeof candidate?.diagnostic?.code === 'string'
          ? candidate.diagnostic.code
          : typeof candidate?.code === 'string'
            ? candidate.code
            : 'SNAPBACK_NATIVE_PROBE_FAILED';
        await post(directorOrigin, '/result', {
          schemaVersion: 'snapback.native-custody-result.v1',
          launchId,
          commandId: command.id,
          command: command.name,
          ok: false,
          error: {
            code,
            message: `Native custody probe command refused with ${code}.`,
          },
          atMs: Date.now(),
        });
      }
    } catch {
      onStatus('director disconnected; retrying');
      await delay(250);
    }
  }
}

export async function fetchDirectorConfig(): Promise<Readonly<Record<string, unknown>>> {
  const origin = await initialDirectorOrigin();
  const response = await fetch(`${origin}/config`);
  if (!response.ok) throw new Error(`director /config returned HTTP ${response.status}`);
  return response.json() as Promise<Readonly<Record<string, unknown>>>;
}
