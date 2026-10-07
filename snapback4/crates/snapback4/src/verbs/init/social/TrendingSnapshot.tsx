import { useEffect, useState } from "react";
import { Button, Text, View } from "react-native";
import { matchRead, useOnline } from "snapback4/react";
import type { Online } from "snapback4/app";
import type { Read, ResultOf } from "snapback4/contract";
import { readPresentation } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// A server snapshot for a Trending-style screen, using the starter's feed.
// No replica acquisition barrier; refresh explicitly for a new snapshot.
export function TrendingSnapshot() {
  const online = useOnline(), [attempt, retry] = useState(0);
  const [answer, setAnswer] = useState<{ owner: Online; read: Read<ResultOf<typeof api.feed>> }>();
  useEffect(() => {
    let active = true;
    setAnswer(undefined);
    void online.query(api.feed, {}).then(read => { if (active) setAnswer({ owner: online, read }); });
    return () => { active = false; };
  }, [online, attempt]);
  const read = answer?.owner === online ? answer.read : { loading: true } as const;
  return <>{matchRead(read, {
    loading: () => <Text>Loading…</Text>, denied: why => <Text accessibilityRole="alert">{why.message}</Text>,
    absent: () => <Text>No posts yet</Text>, partial: rows => <Text>Partial snapshot: {rows.length} posts</Text>,
    present: rows => <View>{rows.map(row => <Text key={row.id}>{row.card?.body ?? "Post unavailable"}</Text>)}</View>,
  })}{readPresentation(read).incomplete && <Text>Snapshot may be incomplete</Text>}
    <Button title="Refresh" onPress={() => retry(n => n + 1)} /></>;
}
