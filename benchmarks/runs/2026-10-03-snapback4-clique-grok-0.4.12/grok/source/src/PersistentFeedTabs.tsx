import { useSyncExternalStore } from "react";
import { router } from "expo-router";
import { FeedTabs, type FeedTab } from "@snapback-bench/social-ui";
import { getFeedTab, setFeedTab, subscribeFeedTab } from "./feed-tab";

export function PersistentFeedTabs() {
  const active = useSyncExternalStore(subscribeFeedTab, getFeedTab, getFeedTab);
  return (
    <FeedTabs
      active={active}
      onChange={(tab: FeedTab) => {
        setFeedTab(tab);
        router.replace("/");
      }}
    />
  );
}
