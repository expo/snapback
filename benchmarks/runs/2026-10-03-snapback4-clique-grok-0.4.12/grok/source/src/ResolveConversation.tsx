import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { mintId } from "snapback4/client";
import { existence, isReady } from "snapback4/contract";
import { useClient, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { ConversationScreen } from "./Conversation";

export function ResolveDm({ handle, visible }: { handle: string; visible: boolean }) {
  const client = useClient();
  const profile = useQuery(api.profileByHandle, { handle: handle.toLowerCase() });
  const dm = useQuery(api.dmByHandle, { handle: handle.toLowerCase() });
  const [id, setId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (!("data" in dm) || dm.revalidating || !dm.complete) return;
    if (dm.data) {
      started.current = true;
      setId(dm.data.conversation);
      return;
    }
    const other = isReady(profile) ? profile.data?.principal : undefined;
    if (!other) return;
    started.current = true;
    const conversationId = mintId();
    void client.mutate(api.openDirect, { id: conversationId, other }, { id: mintId(), waitSeconds: 0 }).then((write) => {
      if (write.state === "failed") setProblem(write.why.message);
      else setId(write.state === "sent" && write.result ? write.result : conversationId);
    });
  }, [client, dm, profile]);
  if (problem) return <Text>{problem}</Text>;
  if (!id) return <Text>{existence(dm) === "loading" ? "Loading…" : "Opening conversation…"}</Text>;
  return <ConversationScreen conversation={id} visible={visible} peerHandle={handle} />;
}

export function ResolveGroup({ title, visible }: { title: string; visible: boolean }) {
  const group = useQuery(api.groupByTitle, { title });
  const id = isReady(group) ? group.data?.id : undefined;
  if (!id) return <Text>Loading group…</Text>;
  return <ConversationScreen conversation={id} visible={visible} isGroup groupTitle={title} />;
}
