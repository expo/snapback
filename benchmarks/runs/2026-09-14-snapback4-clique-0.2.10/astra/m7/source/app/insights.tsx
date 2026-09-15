import React, { useEffect, useState } from "react";
import { ScrollView, Text, RefreshControl } from "react-native";
import { InsightsSummary, InsightsBarList } from "../ui";
import { Shell, Button } from "../src/common";
import { useApp } from "../src/session";
import { api } from "../snapback/generated/api";
export default function Insights() {
  const { client } = useApp();
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function refresh() {
    setBusy(true);
    try {
      const r = await client.query(api.analytics.insights, {});
      if ("denied" in r) throw Error(r.denied.message);
      setData(r.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [client]);
  return (
    <Shell>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={busy} onRefresh={refresh} />
        }
      >
        <Text style={{ fontSize: 28, fontWeight: "700", padding: 20 }}>
          Your insights
        </Text>
        <Button testID="sm-insights-refresh" onPress={refresh}>
          Refresh
        </Button>
        {error ? <Text>{error}</Text> : null}
        {data && (
          <>
            <InsightsSummary
              totals={[
                { label: "Posts", value: data.posts },
                { label: "Likes received", value: data.likesReceived },
                { label: "Reposts received", value: data.repostsReceived },
                { label: "Replies received", value: data.repliesReceived },
                { label: "Followers", value: data.followers },
                { label: "Following", value: data.following },
              ]}
            />
            <Text style={{ padding: 20 }}>Last seven UTC days</Text>
            <InsightsBarList
              days={data.days.map((d: any) => ({
                dayLabel: new Date(d.day * 86400000).toISOString().slice(0, 10),
                posts: d.posts,
                likesReceived: d.likesReceived,
              }))}
            />
            <Text style={{ padding: 20 }}>
              Updated {new Date(data.asOf).toLocaleTimeString()}
            </Text>
          </>
        )}
      </ScrollView>
    </Shell>
  );
}
