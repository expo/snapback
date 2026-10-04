import { useEffect, useState } from "react";
import { createClient } from "snapback4/client";
import type { Client } from "snapback4/contract";
import { useClient, useSession } from "snapback4/react";

// createApp alone owns session rotation. This short-lived arm borrows its
// current bearer, closes on rotation/account change, and never signs it out.
export function useOnlineArm(url: string): Client | null {
  const owner = useClient(), session = useSession();
  const token = session?.token;
  const [arm, setArm] = useState<{ owner: Client; token: string; client: Client }>();
  useEffect(() => {
    if (!token) return;
    const client = createClient({ url, token });
    // Keep the arm alive through consumer cleanup (stopTyping). All signal
    // calls have the SDK's bounded wait; closing early would cancel the stop.
    const pending = new Set<Promise<unknown>>();
    const mutate = client.mutate;
    client.mutate = ((...args: Parameters<typeof mutate>) => {
      const call = mutate(...args); pending.add(call);
      void call.finally(() => pending.delete(call));
      return call;
    }) as typeof mutate;
    setArm({ owner, token, client });
    return () => { queueMicrotask(() => { void Promise.allSettled([...pending]).then(() => client.close()); }); };
  }, [url, owner, token]);
  return token && arm?.owner === owner && arm.token === token ? arm.client : null;
}
