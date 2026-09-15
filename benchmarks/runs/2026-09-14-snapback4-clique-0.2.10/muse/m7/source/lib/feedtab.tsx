import React, { createContext, useCallback, useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";

export type FeedTab = "following" | "global" | "trending";

const FeedTabCtx = createContext<{ tab: FeedTab; setTab: (t: FeedTab) => void }>({
  tab: "following",
  setTab: () => {},
});
export const useFeedTab = () => useContext(FeedTabCtx);
export function FeedTabProvider({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<FeedTab>("following");
  return <FeedTabCtx.Provider value={{ tab, setTab }}>{children}</FeedTabCtx.Provider>;
}

/** Global feed-tab bar: the contracted sm-feed-tab-* IDs live here, mounted
 * exactly once above every route, so automation can reach a feed from any
 * screen (profile, thread, settings). */
export function GlobalFeedTabs() {
  const router = useRouter();
  const { tab, setTab } = useFeedTab();
  const go = useCallback(
    (t: FeedTab) => {
      setTab(t);
      // Replace: pushing "/feed" over "/feed" would stack duplicate feed
      // screens (duplicate contract IDs underneath).
      router.replace("/feed");
    },
    [router, setTab]
  );
  const tabs: { id: FeedTab; label: string; testID: string }[] = [
    { id: "following", label: "Following", testID: "sm-feed-tab-following" },
    { id: "global", label: "Global", testID: "sm-feed-tab-global" },
    { id: "trending", label: "Trending", testID: "sm-feed-tab-trending" },
  ];
  return (
    <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#E2E4E8", backgroundColor: "#fff" }}>
      {tabs.map((t) => (
        <Pressable
          key={t.id}
          testID={t.testID}
          accessibilityState={{ selected: tab === t.id }}
          onPress={() => go(t.id)}
          style={{ flex: 1, padding: 10, alignItems: "center", borderBottomWidth: tab === t.id ? 2 : 0, borderBottomColor: "#4F46E5" }}
        >
          <Text style={{ color: tab === t.id ? "#4F46E5" : "#555", fontWeight: tab === t.id ? "700" : "400" }}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
