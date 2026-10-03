import { Text, View } from "react-native";
import type { ReadPresentation } from "snapback4/contract";
export function ReadNotice({ status }: { status: ReadPresentation }) {
  return <View accessibilityLiveRegion="polite">
    {status.why && <Text>{status.why.message}</Text>}
    {status.incomplete && <Text>Results may be incomplete</Text>}
    {status.stale && <Text>As of {status.since === undefined ? "the last available answer" : new Date(status.since).toISOString()}</Text>}
    {status.revalidating && <Text>Updating…</Text>}
  </View>;
}
