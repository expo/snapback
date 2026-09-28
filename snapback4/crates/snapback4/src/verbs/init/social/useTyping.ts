import { useEffect, useRef, useState } from "react";
import type { Client, Read, ResultOf } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// @ref LLP 3000.028#8 — signals belong to a mounted, signed-in online arm.
export function useTyping(online: Client | null, conversation: string) {
  const [read, setRead] = useState<Read<ResultOf<typeof api.typingIn>>>({ loading: true });
  const controls = useRef({ change: (_text: string) => {}, stop: () => {} });
  useEffect(() => {
    setRead({ loading: true });
    if (!online) return;
    let alive = true, active = false, touched = 0, generation = 0;
    const stop = (cleanup = true) => {
      generation++;
      const wasActive = active; active = false;
      if (wasActive && cleanup) void online.mutate(api.stopTyping, { conversation });
    };
    const renew = () => {
      if (!active || online.link() !== "online") return;
      const call = ++generation;
      void online.mutate(api.setTyping, { conversation }).then(signal => {
        // A late failure cannot cancel a newer renewal or a restarted lease.
        if (alive && call === generation && signal.state === "failed") stop(false);
      });
    };
    const owned = {
      change(text: string) {
        if (!text) { stop(); return; }
        if (!alive || online.link() !== "online") return;
        touched = Date.now(); active = true; renew();
      },
      stop: () => stop(),
    };
    controls.current = owned;
    // The SDK withdraws hints on membership changes and their original deadline.
    const observation = online.observe(api.typingIn, { conversation });
    const publish = () => { if (alive) setRead(observation.getSnapshot()); };
    const unsubscribe = observation.subscribe(publish); publish();
    const unlink = online.onLink(link => {
      if (link !== "online") { stop(false); setRead({ loading: true }); }
      // Reconnect alone does not restart a lease. A new keystroke does.
    });
    const timer = setInterval(() => {
      if (Date.now() - touched >= 2000) stop();
      else renew();
    }, 1000);
    return () => {
      alive = false; stop(); clearInterval(timer); unlink(); unsubscribe(); observation.close();
      if (controls.current === owned) controls.current = { change: () => {}, stop: () => {} };
    };
  }, [online, conversation]);
  return { read, change: (text: string) => controls.current.change(text), stop: () => controls.current.stop() };
}
