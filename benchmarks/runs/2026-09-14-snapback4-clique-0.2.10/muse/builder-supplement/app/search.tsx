import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SearchBar, SearchResultItem } from "../ui-kit/src/SearchBar";
import { useClient, useLink, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { readData, useAssetUrl } from "../lib/helpers";
import { BottomNav } from "./components/FeedItem";

type Scope = "people" | "chat" | "all";

function AvatarFor({ id }: { id?: string }) {
  useAssetUrl(id);
  return null;
}

export default function Search() {
  const router = useRouter();
  const params = useLocalSearchParams<{ chat?: string }>();
  const client: any = useClient();
  const link = useLink();
  const [q, setQ] = useState("");
  // Default to all-messages: message search (online, else warm-offline over
  // synced content) is the landing expectation; people/chat narrow explicitly.
  const [scope, setScope] = useState<Scope>(params.chat ? "chat" : "all");
  const [results, setResults] = useState<SearchResultItem[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const chatTitles = useQuery(api.inbox, {});
  const inbox = readData<any[]>(chatTitles) ?? [];
  const chatName = (cid: string) => {
    const m = inbox.find((x: any) => x.conversationId === cid);
    const c = m?.conversation;
    if (!c) return cid;
    return c.kind === "group" ? c.name ?? "Group" : "Direct message";
  };

  useEffect(() => {
    let live = true;
    const query = q.trim();
    if (query.length < 2) {
      setResults(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        if (scope === "people") {
          const r = await client.query(api.searchPeople, { q: query });
          if (!live || (r as any).denied) return;
          setResults(
            ((r as any).data as any[]).map((p: any) => ({
              id: `person:${p.handle}`,
              title: p.displayName,
              subtitle: `@${p.handle}`,
            }))
          );
        } else if (scope === "chat" && params.chat) {
          const r = await client.query(api.searchChat, { conversationId: params.chat, q: query });
          if (!live || (r as any).denied) return;
          setResults(
            ((r as any).data as any[]).map((m: any) => ({
              id: `msg:${m.id}`,
              title: (m.body ?? (m.kind === "video" ? "Video" : "Photo")).slice(0, 120),
              subtitle: new Date(m.at).toLocaleString(),
            }))
          );
        } else {
          const op = link === "online" ? api.searchAllOnline : api.searchAll;
          const r = await client.query(op, { q: query });
          if (!live || (r as any).denied) return;
          setResults(
            ((r as any).data as any[]).map((m: any) => ({
              id: `msg:${m.conversationId}:${m.id}`,
              title: (m.body ?? (m.kind === "video" ? "Video" : "Photo")).slice(0, 120),
              subtitle: new Date(m.at).toLocaleString(),
              groupLabel: chatName(m.conversationId),
            }))
          );
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scope, client, link]);

  const pressResult = (id: string) => {
    if (id.startsWith("person:")) {
      router.push({ pathname: "/profile/[handle]", params: { handle: id.slice(7) } });
    } else if (id.startsWith("msg:")) {
      const parts = id.split(":");
      const cid = parts.length === 3 ? parts[1] : params.chat!;
      router.push({ pathname: "/chat/[id]", params: { id: cid } });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flexDirection: "row", gap: 8, padding: 8 }}>
        {(["people", "chat", "all"] as Scope[]).map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setScope(s);
              setResults(undefined);
            }}
            style={{ padding: 8, backgroundColor: scope === s ? "#4F46E5" : "#eee", borderRadius: 8 }}
            testID={`sm-search-scope-${s}`}
          >
            <Text style={{ color: scope === s ? "#fff" : "#000" }}>{s === "people" ? "People" : s === "chat" ? "This chat" : "All messages"}</Text>
          </Pressable>
        ))}
      </View>
      {link !== "online" ? <Text testID="sm-search-offline">Offline — searching synced content</Text> : null}
      <SearchBar value={q} onChangeText={setQ} onClear={() => setQ("")} results={results} onPressResult={pressResult} loading={loading} />
      <View style={{ flex: 1 }} />
      <BottomNav />
    </View>
  );
}
