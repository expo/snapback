import type { FeedTab } from "@snapback-bench/social-ui";

let current: FeedTab = "following";
const listeners = new Set<() => void>();

export function getFeedTab(): FeedTab {
  return current;
}

export function setFeedTab(tab: FeedTab) {
  current = tab;
  for (const listener of listeners) listener();
}

export function subscribeFeedTab(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
