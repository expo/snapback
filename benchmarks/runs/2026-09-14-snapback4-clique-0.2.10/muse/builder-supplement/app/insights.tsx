import React from "react";
import { ScrollView, Text, View } from "react-native";
import { InsightsSummary } from "../ui-kit/src/InsightsSummary";
import { InsightsBarList } from "../ui-kit/src/InsightsBarList";
import { useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";
import { readData } from "../lib/helpers";
import { BottomNav } from "./components/FeedItem";

export default function Insights() {
  const read = useQuery(api.myInsights, {});
  const data = readData<any>(read);
  if (read.denied) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", padding: 24 }}>
        <Text testID="sm-insights-offline">Insights need a connection.</Text>
        <BottomNav />
      </View>
    );
  }
  if (!data) return <View style={{ padding: 24 }}><Text>Loading…</Text></View>;
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView>
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
        <InsightsBarList
          days={[...(data.days ?? [])].reverse().map((d: any) => ({
            dayLabel: new Date(d.dayEnd ?? d.dayStart).toLocaleDateString([], { weekday: "short" }),
            posts: d.posts,
            likesReceived: d.likes,
          }))}
        />
      </ScrollView>
      <BottomNav />
    </View>
  );
}
