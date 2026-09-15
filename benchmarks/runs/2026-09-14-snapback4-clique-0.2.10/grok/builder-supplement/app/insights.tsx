import { InsightsBarList, InsightsSummary } from "@snapback-bench/social-ui";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useQuery } from "snapback4/react";
import { api } from "../src/api.generated";

export default function Insights(): React.JSX.Element {
  const q = useQuery(api.insights, {});
  if (!q || "loading" in q) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  if ("denied" in q) return <View style={{ padding: 24 }}><Text>{q.denied.message}</Text></View>;
  const d = q.data;
  const days = (d.days ?? []).map((day: any, i: number) => ({
    label: i === 0 ? "Today" : new Date(day.dayStart).toUTCString().slice(0, 3),
    posts: day.posts ?? 0,
    likesReceived: day.likesReceived ?? 0,
  }));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }}>
      <InsightsSummary
        posts={d.posts}
        likesReceived={d.likesReceived}
        repostsReceived={d.repostsReceived}
        repliesReceived={d.repliesReceived}
        followers={d.followers}
        following={d.following}
      />
      <InsightsBarList days={days} />
    </ScrollView>
  );
}
