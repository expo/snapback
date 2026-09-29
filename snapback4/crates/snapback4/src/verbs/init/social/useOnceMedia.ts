import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "snapback4/react";
import type { AssetRead } from "snapback4/contract";

type View = { id: string; url?: string; problem?: string } | null;
// @ref LLP 3000.028#8 — one explicit open owns one handle, including late results.
export function useOnceMedia() {
  const client = useClient();
  const [view, setView] = useState<View>(null);
  const owner = useRef({ epoch: 0, opened: false, alive: false, handle: null as Exclude<AssetRead, { denied: unknown }> | null });
  const release = useCallback(() => {
    const state = owner.current;
    state.epoch++; state.opened = false; state.handle?.revoke(); state.handle = null;
  }, []);
  const close = useCallback(() => { release(); setView(null); }, [release]);
  useEffect(() => {
    owner.current.alive = true;
    return () => { owner.current.alive = false; release(); };
  }, [client, release]);
  async function open(id: string) {
    const state = owner.current;
    if (!state.alive || state.opened) return;
    state.opened = true;
    const epoch = ++state.epoch;
    setView({ id });
    try {
      const result = await client.asset(id);
      if (!state.alive || state.epoch !== epoch) {
        if (!("denied" in result)) result.revoke();
        return;
      }
      if ("denied" in result) setView({ id, problem: `${result.denied.code}: ${result.denied.message}` });
      else { state.handle = result; setView({ id, url: result.url }); }
    } catch (error) {
      if (state.alive && state.epoch === epoch) setView({ id, problem: String(error) });
    }
  }
  return { view, open, close };
}
