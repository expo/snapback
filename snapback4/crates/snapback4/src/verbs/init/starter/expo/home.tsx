import { Button, Text, View } from "react-native";
import { useAuth, useLink, useSignedInViewer } from "snapback4/react";
import { api } from "./snapback/generated/api";
import { tier } from "./src/client";

// Your first screen: replace it with your own. `snapback4 check` writes
// snapback/generated/api.ts, a typed handle for each operation in
// snapback/*.q. Read with useQuery(api.yourQuery, args) and render the Read
// with matchRead, or usePage(api.yourList, args) for a query that takes
// `c: cursor ?`; write with useMutation(api.yourMutation). Name hook results
// in props as UseQuery<typeof api.op>, UsePage<…> and UseMutation<…>
// (`npx snapback4 guide client`).
function Home() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  return <View style={{ flex: 1, padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Signed in</Text>
    <Text>{viewer} · {tier} · {link === "online" ? "online" : "offline"}</Text>
    <Text>Your operations, from snapback/generated/api.ts: {Object.keys(api).join(", ") || "none yet"}</Text>
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </View>;
}
