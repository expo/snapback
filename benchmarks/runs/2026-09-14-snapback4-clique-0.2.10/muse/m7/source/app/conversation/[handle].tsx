import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useClient, useLink } from "snapback4/react";
import { api } from "../../snapback/generated/api";

/** Adapter route: /conversation/{handle} opens (or creates) the DM, then redirects. */
export default function ConversationByHandle() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const router = useRouter();
  const client: any = useClient();
  const link = useLink();
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (link !== "online") {
          const r = await client.query(api.dmWith, { handle: (handle ?? "").toLowerCase() });
          if (!live) return;
          if (!(r as any).denied && (r as any).data?.id) {
            router.replace({ pathname: "/chat/[id]", params: { id: (r as any).data.id } });
          } else {
            setMissing(true);
          }
          return;
        }
        const w = await client.mutate(api.dmCreate, { otherHandle: (handle ?? "").toLowerCase() });
        if (!live) return;
        if (w.state === "sent" && w.result?.id) {
          router.replace({ pathname: "/chat/[id]", params: { id: w.result.id } });
        } else {
          setMissing(true);
        }
      } catch {
        if (live) setMissing(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, handle, link, router]);
  if (missing) {
    return <View style={{ padding: 24 }}><Text testID="sm-convo-missing">No conversation with {handle}.</Text></View>;
  }
  return <View style={{ padding: 24 }}><Text>Opening conversation…</Text></View>;
}
