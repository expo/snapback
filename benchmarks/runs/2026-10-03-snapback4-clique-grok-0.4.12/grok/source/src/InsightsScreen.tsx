import { ScrollView, RefreshControl } from "react-native";
import { useQuery } from "snapback4/react";
import { isReady } from "snapback4/contract";
import { InsightsBarList, InsightsSummary } from "@snapback-bench/social-ui";
import { api } from "../snapback/generated/api";
import { useState } from "react";

export default function InsightsScreen() {
  const read = useQuery(api.insights, {});
  const [tick, setTick] = useState(0);
  const data = isReady(read) ? read.data : null;
  if (!data) return null;
  const totals = [
    { label: "Posts" as const, value: data.posts },
    { label: "Likes received" as const, value: data.likesReceived },
    { label: "Reposts received" as const, value: data.repostsReceived },
    { label: "Replies received" as const, value: data.repliesReceived },
    { label: "Followers" as const, value: data.followers },
    { label: "Following" as const, value: data.following },
  ];
  const days = [
    { dayLabel: "Today", posts: data.posts0, likesReceived: data.likes0 },
    { dayLabel: "D-1", posts: data.posts1, likesReceived: data.likes1 },
    { dayLabel: "D-2", posts: data.posts2, likesReceived: data.likes2 },
    { dayLabel: "D-3", posts: data.posts3, likesReceived: data.likes3 },
    { dayLabel: "D-4", posts: data.posts4, likesReceived: data.likes4 },
    { dayLabel: "D-5", posts: data.posts5, likesReceived: data.likes5 },
    { dayLabel: "D-6", posts: data.posts6, likesReceived: data.likes6 },
  ];
  return (
    <ScrollView
      refreshControl={<RefreshControl refreshing={!!read.revalidating} onRefresh={() => setTick(tick + 1)} />}
    >
      <InsightsSummary totals={totals} />
      <InsightsBarList days={days} />
    </ScrollView>
  );
}
