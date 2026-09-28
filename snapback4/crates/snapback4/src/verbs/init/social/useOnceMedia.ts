import { useCallback, useRef, useState } from "react";
import { useAsset } from "snapback4/react";

type View = { id: string; url?: string; problem?: string } | null;
// @ref LLP 3000.029#4 — the SDK owns the handle and withdraws it on authority evidence.
// One explicit open selects one asset; revalidation never starts another GET.
export function useOnceMedia() {
  const [id, setId] = useState<string | null>(null);
  const opened = useRef(false);
  const asset = useAsset(id);
  const close = useCallback(() => { opened.current = false; setId(null); }, []);
  const open = (next: string) => { if (!opened.current) { opened.current = true; setId(next); } };
  const view: View = !id ? null : asset.status === "ready" ? { id, url: asset.url }
    : asset.status === "denied" ? { id, problem: `${asset.why.code}: ${asset.why.message}` } : { id };
  return { view, open, close };
}
