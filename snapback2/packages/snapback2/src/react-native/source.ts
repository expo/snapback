import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSnapbackClient, useSnapbackSnapshot } from "../react-core.js";
import { isSnapbackRefusal, SnapbackRefusal } from "../client.js";
import type { AssetRecord } from "../types.js";
import type { AssetBytes } from "../store/byte-cache.js";
import { nativeAssetFiles } from "./files.js";

const none = () => "0";
const noSubscription = () => () => {};
const fileRefusal = (error: unknown): SnapbackRefusal => isSnapbackRefusal(error) ? error : new SnapbackRefusal({
  code: "E_OFFLINE_CARRIER", family: "offline", message: String(error), site: "useAssetFile",
  rewrite: "open a writable Expo cache directory and retry", guide: "offline",
});
export function bytesDataUri(value: AssetBytes): string {
  // No Buffer, Blob, or huge argument list on Hermes.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const output: string[] = [];
  for (let i = 0; i < value.bytes.length; i += 3) {
    const a = value.bytes[i], b = value.bytes[i + 1], c = value.bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    output.push(alphabet[n >>> 18], alphabet[(n >>> 12) & 63], b === undefined ? "=" : alphabet[(n >>> 6) & 63], c === undefined ? "=" : alphabet[n & 63]);
  }
  return `data:${value.type.replace(/[;,\r\n]/g, "")};base64,${output.join("")}`;
}

function useFile(asset: AssetRecord | null | undefined, width?: number) {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const files = nativeAssetFiles(client);
  const getRevision = useMemo(() => files && asset ? () => files.getAssetRevision(asset.id) : none, [files, asset?.id]);
  const revision = useSyncExternalStore(files?.subscribe ?? noSubscription, getRevision, none);
  const identity = useMemo(() => ({ client, id: asset?.id, width, auth: snapshot.authGeneration, files, revision }),
    [client, asset?.id, width, snapshot.authGeneration, files, revision]);
  const [result, setResult] = useState<{ identity: typeof identity; uri?: string; error?: unknown }>();
  useEffect(() => {
    let active = true;
    if (!asset || !files || !client.assetCache) {
      setResult({ identity });
      return;
    }
    void files.get(client.assetCache, asset.id, width ?? null).then(
      (uri) => { if (active) setResult({ identity, uri }); },
      (error) => { if (active) setResult({ identity, error }); },
    );
    return () => { active = false; };
  }, [identity]);
  return { files, revision, custody: files?.getCustody() ?? 0, checked: result?.identity === identity,
    uri: result?.identity === identity ? result.uri : undefined, error: result?.identity === identity ? result.error : undefined };
}

/** Cached ordinary media only. View-once is held by its viewing component, never a file. */
export function useAssetFile(asset: AssetRecord | null | undefined, options: { width?: number } = {}): string | undefined {
  return useFile(asset, options.width).uri;
}

export function useNativeSource(asset: AssetRecord | null | undefined, options: { width?: number; enabled?: boolean } = {}) {
  const client = useSnapbackClient();
  const snapshot = useSnapbackSnapshot();
  const file = useFile(asset, options.width);
  const failure = useMemo(() => file.error === undefined ? undefined : fileRefusal(file.error), [file.error]);
  const identity = useMemo(() => ({ client, id: asset?.id, width: options.width, auth: snapshot.authGeneration, custody: file.custody }),
    [client, asset?.id, options.width, snapshot.authGeneration, file.custody]);
  const [memory, setMemory] = useState<{ identity: typeof identity; revision?: string; uri?: string; refusal?: SnapbackRefusal }>();
  const attempted = useRef<typeof identity | undefined>(undefined);
  const current = useRef<typeof identity | undefined>(identity);
  current.current = identity;
  useEffect(() => {
    current.current = identity;
    return () => { current.current = undefined; };
  }, [identity]);
  useEffect(() => {
    if (!asset || options.enabled === false || !file.checked || failure || file.uri || attempted.current === identity || (file.files && !file.files.available())) return;
    attempted.current = identity;
    const active = () => current.current === identity && client.snapshot.authGeneration === identity.auth
      && (file.files?.getCustody() ?? 0) === identity.custody;
    void (async () => {
      await client.ready;
      if (!active()) return;
      // A new viewing instance cannot borrow another instance's allowance.
      if (await client.assetCache?.viewed(asset.id)) {
        if (active()) setMemory({ identity, revision: file.files?.getAssetRevision(asset.id) ?? "0" });
        return;
      }
      if (!active()) return;
      const url = await client.assetUrl(asset, { width: options.width });
      if (!url || !active()) return;
      const value = await client.assetBytes(url, { viewing: identity });
      if (!active()) return;
      if (client.assetCache && !await client.assetCache.canServe(asset.id, identity)) return;
      if (active()) setMemory({ identity, revision: file.files?.getAssetRevision(asset.id) ?? "0", uri: bytesDataUri(value) });
    })().catch((error) => {
      if (current.current !== identity) return;
      const refusal = fileRefusal(error);
      setMemory({ identity, revision: file.files?.getAssetRevision(asset!.id) ?? "0", refusal });
    });
  }, [identity, file.checked, file.uri, options.enabled, failure]);
  useEffect(() => {
    if (!asset || !file.files || memory?.identity !== identity || !memory.uri || memory.revision === file.revision) return;
    let active = true;
    const custody = file.custody;
    void client.assetCache?.canServe(asset.id, identity).then((held) => {
      if (active && current.current === identity && file.files?.getCustody() === custody)
        setMemory({ ...memory, revision: file.revision, uri: held ? memory.uri : undefined });
    }).catch(() => {
      if (active && current.current === identity) setMemory({ ...memory, revision: file.revision, uri: undefined });
    });
    return () => { active = false; };
  }, [memory, identity, file.revision]);
  // Fetch completion is fenced by the client's authority and by identity at render.
  return { settled: file.checked && (Boolean(file.uri) || memory?.identity === identity), uri: file.uri ?? (memory?.identity === identity && memory.revision === file.revision ? memory.uri : undefined), refusal: failure ?? (memory?.identity === identity ? memory.refusal : undefined) };
}
