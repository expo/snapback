import { Text, View } from "react-native";
import { existence, isReady, type Read } from "snapback4/contract";
export function ReadNotice({ read }: { read: Read<unknown> }) {
  const state = existence(read);
  return <View accessibilityLiveRegion="polite">
    {state === "loading" && <Text>Loading profile…</Text>}
    {"denied" in read && <Text>{read.denied.message}</Text>}
    {isReady(read) && (state === "partial" || !read.complete || read.cut !== null || read.next != null) && <Text>Results may be incomplete</Text>}
    {isReady(read) && !read.fresh && <Text>As of {read.since === undefined ? "the last available answer" : new Date(read.since).toISOString()}</Text>}
    {isReady(read) && read.revalidating && <Text>Updating…</Text>}
  </View>;
}
