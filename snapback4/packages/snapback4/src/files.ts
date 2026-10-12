// File assets on the client (LLP 3000.038): what a file upload declares, the
// filename a download names, and saving a document on demand in a browser.

import type { Client, Refusal, UploadOptions } from "./contract.ts";

/** A file upload's declared type and filename: the options win, then the
 * `File`/`Blob`'s own `type` and `name`. An unknown type is left undeclared;
 * the server then names PDF, PNG, JPEG, WebP, GIF and zip by their bytes. */
export function uploadFile(bytes: unknown, file: NonNullable<UploadOptions["file"]>): { type?: string; name: string } {
  const own = (typeof bytes === "object" && bytes !== null ? bytes : {}) as { type?: unknown; name?: unknown };
  const type = file.type ?? (typeof own.type === "string" && own.type ? own.type : undefined);
  const name = file.name ?? (typeof own.name === "string" ? own.name : "");
  return type === undefined ? { name } : { type, name };
}

/** The filename a `Content-Disposition` header names: RFC 8187 `filename*`
 * first, then the quoted ASCII `filename`. */
export function dispositionName(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try { return decodeURIComponent((extended[1] ?? "").trim()); } catch { /* fall back to the ASCII name */ }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? (plain[1] ?? "").trim() : undefined;
}

export type Saved = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly why: Refusal };

/** Download an asset under the viewer's credentials and hand it to the
 * browser as a saved file named `name` (default: the file's own name). For
 * documents, call this from a button: it fetches on demand instead of on
 * render. Browser only; a native host uses `client.assetSource(id)` with its
 * own file APIs. */
export async function saveAsset(client: Pick<Client, "asset">, id: string, name?: string): Promise<Saved> {
  const document = (globalThis as { document?: Document }).document;
  if (!document?.createElement || !document.body) {
    return { ok: false, why: { code: "E_CLIENT", family: "client", message: "saveAsset needs a browser document; on a native host, fetch client.assetSource(id) with the host's file APIs", guide: "assets" } };
  }
  const read = await client.asset(id);
  if ("denied" in read) return { ok: false, why: read.denied };
  const filename = name ?? read.name ?? "file";
  const link = document.createElement("a");
  link.href = read.url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
  // Revoking at once can cancel a download the browser has not started yet.
  setTimeout(read.revoke, 60_000);
  return { ok: true, name: filename };
}
