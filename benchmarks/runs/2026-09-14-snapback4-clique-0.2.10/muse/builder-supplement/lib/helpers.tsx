import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useAsset } from "snapback4/react";
import { serverUrl, useAppClient } from "./client";

export function readData<T>(read: any): T | undefined {
  if (!read || read.loading || read.denied) return undefined;
  return read.data as T;
}

export function fmtTime(at: number): string {
  const d = new Date(at);
  const now = Date.now();
  const diff = now - at;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString();
}

export function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Blob/file URL for an asset id carried on a row, or null. */
export function useAssetUrl(id: string | null | undefined): string | null {
  const st = useAsset(id);
  if (st.status === "ready") return st.url;
  return null;
}

/**
 * Device-independent single-asset fetch for the full-screen viewer: plain
 * authed HTTP (fetch -> blob -> object URL) with retries, bypassing the
 * local device's media queue so one wedged asset op cannot stall playback.
 * Shape matches useAsset ({ status, url?, why? }).
 */
export function useDirectAssetUrl(id: string | null | undefined) {
  const ctx = useAppClient();
  const [state, setState] = useState<{ status: string; url?: string; why?: any }>({ status: "loading" });
  useEffect(() => {
    if (!id) {
      setState({ status: "empty" });
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    let tries = 0;
    // Hung asset fetches hold browser sockets open across offline windows
    // and stall the whole client behind them; abort on unmount/id change,
    // and never fetch while the browser reports offline.
    const ctl = new AbortController();
    const load = async (): Promise<void> => {
      tries += 1;
      try {
        const token = ctx.session?.token;
        if (!token) {
          if (live) setState({ status: "denied", why: { code: "E_AUTH" } });
          return;
        }
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          if (live) setState({ status: "offline" });
          return;
        }
        const r = await fetch(`${serverUrl()}/assets/${encodeURIComponent(id)}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: ctl.signal,
        });
        if (!r.ok) {
          const denied = (await r.json().catch(() => null))?.denied ?? { code: `E_HTTP_${r.status}` };
          if (live) setState({ status: "denied", why: denied });
          return;
        }
        const blob = await r.blob();
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", url: objectUrl, type: blob.type });
      } catch (e: any) {
        if (!live || ctl.signal.aborted) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          if (live) setState({ status: "offline" });
          return;
        }
        if (tries < 3) {
          setTimeout(() => {
            if (live) void load();
          }, 1500);
          return;
        }
        setState({ status: "denied", why: { code: "E_OFFLINE" } });
      }
    };
    setState({ status: "loading" });
    void load();
    const onOnline = () => {
      if (live) {
        tries = 0;
        void load();
      }
    };
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);
    return () => {
      live = false;
      ctl.abort();
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.session?.token, id]);
  return id ? state : { status: "empty" };
}

export async function uploadFile(client: any, file: File | Blob): Promise<string> {
  const up = await client.upload(file);
  if (!up.ok) throw new Error(`upload refused: ${up.why?.code ?? "unknown"}`);
  return up.asset.id as string;
}

/** Capture a poster frame from a video URL (web). Falls back to null. */
export function captureVideoPoster(url: string, timeoutMs = 6000): Promise<string | null> {
  if (Platform.OS !== "web") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const video = document.createElement("video");
      video.muted = true;
      (video as any).playsInline = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), timeoutMs);
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 240;
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          clearTimeout(timer);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      video.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Durable settings write. Settings screens navigate immediately after a tap,
 * and a device-outbox write alone can die with the page before it syncs,
 * silently losing the change (member-remove / disappearing races). So when
 * online with a session, apply directly to the server first (keepalive: the
 * request lands even if the page unloads mid-tap); otherwise fall back to
 * the device queue. Returns the mutation outcome ({ state, why? }).
 */
export async function settingsMutate(
  session: { token?: string } | null | undefined,
  client: any,
  op: any,
  args: any,
  fallback?: (op: any, args: any) => Promise<any>
): Promise<any> {
  const token = session?.token;
  if (token && typeof navigator !== "undefined" && navigator.onLine !== false && op?.name) {
    try {
      const r = await fetch(`${serverUrl()}/m/${op.name}`, {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          args,
        }),
      });
      const j = await r.json().catch(() => null);
      if (j && typeof j.state === "string") return j;
    } catch {}
  }
  if (fallback) return fallback(op, args);
  return client.mutate(op, args);
}

/** Poll a changing value while mounted (for server-run live aggregates). */
export function usePoll(fn: () => void, ms: number, active = true) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, active]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
