import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import { mintId } from "snapback4/client";
import { useClient, usePendingWrites, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { existence } from "snapback4/contract";
import { url } from "./client";

// @ref LLP 3000.028#8 — resolve once into navigation; never cache protected answers.
export default function Direct({ other }: { other: string }) {
  const viewer = useViewer();
  return viewer ? <Resolve key={JSON.stringify([url, viewer, other])} other={other} /> : null;
}
function Resolve({ other }: { other: string }) {
  const client = useClient(), read = useQuery(api.directConversation, { other });
  const pending = usePendingWrites(api.openDirect);
  const creation = pending.find(write => write.args.other === other);
  const started = useRef(false), alive = useRef(true);
  const [problem, setProblem] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (started.current || !("data" in read) || read.revalidating || !read.complete) return;
    if (read.data?.pending && !creation) return; // Restore the pending opening ID before navigating.
    started.current = true;
    if (read.data) {
      router.replace({ pathname: "/conversation/[id]", params: { id: read.data.conversation,
        ...(creation ? { opening: creation.id, proposed: creation.args.id, other } : {}),
      } });
      return;
    }
    if (creation) {
      router.replace({ pathname: "/conversation/[id]", params: {
        id: creation.args.id, opening: creation.id, proposed: creation.args.id, other,
      } });
      return;
    }
    void (async () => {
      // The hook starts empty while restoring. Await custody before creating.
      const restored = ((await client.pendingWrites()).filter(write => write.op === api.openDirect.name) as typeof pending)
        .find(write => write.args.other === other);
      if (!alive.current) return;
      if (restored) {
        router.replace({ pathname: "/conversation/[id]", params: {
          id: restored.args.id, opening: restored.id, proposed: restored.args.id, other,
        } });
        return;
      }
      const id = mintId(), opening = mintId();
      // A complete absent lookup permits this attempt. Only the SDK replays it.
      const write = await client.mutate(api.openDirect, { id, other }, { id: opening, waitSeconds: 0 });
      if (!alive.current) return;
      if (write.state === "failed") { setProblem(write.why.message); return; }
      router.replace({ pathname: "/conversation/[id]", params: {
        id: write.state === "sent" && write.result ? write.result : id, opening, proposed: id, other,
      } });
    })().catch(error => { if (alive.current) setProblem(`Opening outcome unknown: ${String(error)}`); });
  }, [client, other, read, creation]);
  return <><Text>{existence(read) === "loading" ? "Loading…" : existence(read) === "partial" ? "Partial results" : "denied" in read ? read.denied.message : ""}</Text><Text>{problem || "Opening direct message…"}</Text></>;
}
