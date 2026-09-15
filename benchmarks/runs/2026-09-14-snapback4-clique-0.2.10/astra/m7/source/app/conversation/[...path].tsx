import { randomUUID } from "expo-crypto";
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { useApp } from "../../src/session";
import { Conversation, ChatSettings } from "../../src/chat";
export default function Route() {
  const { path } = useLocalSearchParams<{ path: string[] }>();
  const parts = Array.isArray(path) ? path : [path];
  return <Resolve key={parts.slice(0, 2).join("/")} parts={parts} />;
}
function Resolve({ parts }: { parts: string[] }) {
  const { client } = useApp();
  const [id, setId] = useState<string | null>(
    parts[0] === "id" ? parts[1] : null,
  );
  const p = useQuery(api.profile, {
    handle: parts[0] === "group" || parts[0] === "id" ? "unknown" : parts[0],
  });
  const g = useQuery(api.chat.group, {
    name: parts[0] === "group" ? parts[1] : "unknown",
  });
  useEffect(() => {
    if (parts[0] === "group" && "data" in g && g.data[0]?.conversation)
      setId(g.data[0].conversation.id);
    if (parts[0] !== "group" && parts[0] !== "id" && "data" in p && p.data) {
      client
        .mutate(api.chat.createDM, {
          other: p.data.principal,
          conversationId: randomUUID(),
        })
        .then((w: any) => {
          if (w.state === "sent") setId(w.result.id);
        });
    }
  }, [
    "data" in p ? p.data?.principal : null,
    "data" in g ? g.data[0]?.conversation?.id : null,
  ]);
  if (!id) return <Text>Opening conversation…</Text>;
  return parts.includes("settings") ? (
    <ChatSettings id={id} />
  ) : (
    <Conversation id={id} />
  );
}
