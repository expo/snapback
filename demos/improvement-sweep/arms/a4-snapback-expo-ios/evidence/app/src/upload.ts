// On-device asset upload/read over the raw authenticated attempt/TUS/
// finalize recipe (the packaged client exposes no asset-upload helper —
// finding 0137-a1-f3, cited; recipe adopted from the a4-snapback-web arm
// records). Binary legs use expo/fetch (WinterCG fetch: Uint8Array bodies
// and response.arrayBuffer() are first-class), because React Native's
// global fetch has no reliable binary body lane.
import { fetch as expoFetch } from 'expo/fetch';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = B64.indexOf(ch);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256hex(bytes: Uint8Array): Promise<string> {
  // Requires the consumer WebCrypto polyfill (finding 0137-a1expo-f1, cited).
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
}

export async function sha256b64(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return toBase64(new Uint8Array(digest));
}

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

export type UploadIntent = { name: string; intentPolicyHash?: string | null };

export async function uploadAsset(
  serverUrl: string,
  token: string,
  intent: UploadIntent,
  filename: string,
  bytes: Uint8Array,
): Promise<Record<string, unknown>> {
  const authed = { authorization: `Bearer ${token}`, ...protocolHeaders };
  const createdRes = await fetch(`${serverUrl}/assets/attempts`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({
      intentId: intent.name,
      intentPolicyHash: intent.intentPolicyHash ?? null,
      args: {},
      declaredFilename: filename,
      declaredLength: bytes.byteLength,
      declaredContentType: 'image/png',
    }),
  });
  const created = await createdRes.json();
  if (!createdRes.ok) {
    return { stage: 'attempt', status: createdRes.status, body: created };
  }
  const attemptId = created.task.attemptId;
  const assetId = created.task.assetId;
  const checksum = await sha256b64(bytes);
  const patchedRes = await expoFetch(`${serverUrl}${created.transfer.uploadUrl}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'x-snapback-auth-client-protocol': '1',
      'tus-resumable': '1.0.0',
      'content-type': 'application/offset+octet-stream',
      'upload-offset': '0',
      'upload-checksum': `sha256 ${checksum}`,
    },
    body: bytes as unknown as never,
  });
  if (!patchedRes.ok) {
    return { stage: 'tus', status: patchedRes.status, body: await patchedRes.text() };
  }
  const finalizedRes = await fetch(`${serverUrl}/assets/attempts/${encodeURIComponent(attemptId)}/finalize`, {
    method: 'POST',
    headers: authed,
    body: JSON.stringify({ attemptId, lifecycleGeneration: 1, declaredDigest: await sha256hex(bytes) }),
  });
  const finalized = await finalizedRes.json();
  if (!finalizedRes.ok) {
    return { stage: 'finalize', status: finalizedRes.status, body: finalized };
  }
  return { stage: 'complete', assetId, attemptId, tusStatus: patchedRes.status, finalize: finalized };
}

export async function readAssetVariant(
  serverUrl: string,
  token: string | null,
  assetId: string,
  variant: string,
): Promise<Record<string, unknown>> {
  const res = await expoFetch(`${serverUrl}/assets/records/${assetId}/bytes/${variant}`, {
    headers: token
      ? { authorization: `Bearer ${token}`, 'x-snapback-auth-client-protocol': '1' }
      : { 'x-snapback-auth-client-protocol': '1' },
  });
  const out: Record<string, unknown> = {
    status: res.status,
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
    contentDisposition: res.headers.get('content-disposition'),
  };
  if (res.ok) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    out.byteLength = bytes.byteLength;
    out.sha256 = await sha256hex(bytes);
    out.pngMagic = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  } else {
    out.body = await res.text();
  }
  return out;
}
