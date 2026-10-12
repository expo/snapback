import type { Client } from "snapback4/contract";
import type { Saved } from "snapback4/react";
import { blobArrayBuffer } from "snapback4/local";

/** Save/share only bytes already authorized by client.asset, including retained offline files. */
export async function saveWithHost(client: Pick<Client, "asset">, id: string, name: string | undefined,
  present: ((hex: string, name: string) => Promise<boolean>) | undefined, read: typeof fetch = fetch): Promise<Saved> {
  if (!present) return { ok: false, why: { code: "E_CLIENT", family: "client", message: "saveAsset needs the Snapback native module in a development or production build" } };
  const asset = await client.asset(id);
  if ("denied" in asset) return { ok: false, why: asset.denied };
  const selected = name ?? asset.name ?? "file";
  // Keep a single safe leaf. The native host independently validates it.
  const filename = selected.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "").trim().replace(/^\.+/, "").slice(0, 128) || "file";
  try {
    if (!/^(file:|blob:|data:)/.test(asset.url)) throw new Error("asset handle is not a local byte source");
    const response = await read(asset.url);
    const bytes = new Uint8Array(await blobArrayBuffer(await response.blob()));
    const completed = await present(Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""), filename);
    return completed ? { ok: true, name: filename } : { ok: false, why: { code: "E_CANCELLED", family: "client", message: "the save sheet was cancelled" } };
  } catch (error) {
    return { ok: false, why: { code: "E_CLIENT", family: "client", message: `the asset could not be saved: ${String(error)}` } };
  } finally { asset.revoke(); }
}
