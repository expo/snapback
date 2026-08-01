// Loopback test-infrastructure endpoints (guide clients/react-expo.md:
// "Both bridge to a loopback development server and witness collector. That
// is test infrastructure, not a production endpoint design.").
// The iOS simulator shares the host loopback interface, so 127.0.0.1
// reaches the host-side snapback dev server and the director directly.
// A4-Expo arm ports: director 4611, dev server 4297 (the a1-expo arm owned
// 4610/4294; the web arms own 4288-4291; 4420 is never used).
export const DIRECTOR_URL = 'http://127.0.0.1:4611';
export const FALLBACK_SERVER_URL = 'http://127.0.0.1:4297';

export async function fetchServerUrl(): Promise<string> {
  try {
    const res = await fetch(`${DIRECTOR_URL}/config`);
    const body = await res.json();
    if (typeof body?.serverUrl === 'string') return body.serverUrl;
  } catch {
    // director unreachable: fall through to the baked default
  }
  return FALLBACK_SERVER_URL;
}
