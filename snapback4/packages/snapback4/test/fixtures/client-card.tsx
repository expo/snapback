import type { Client, Write } from "snapback4/contract";
import { createClient } from "snapback4/client";
import { createLocalClient } from "snapback4/local";
import type { AssetState } from "snapback4/react";
import { Image, Text } from "react-native";
declare const local: Awaited<ReturnType<typeof createLocalClient>>;
const online: Client = createClient({ url: "http://localhost:4400", persona: "alice" });
const clients: Client[] = [local, online];
for (const client of clients) void client.signOut();
export function Photo({ photo }: { photo: AssetState }) {
  return <>{photo.status === "ready" && <Image source={{ uri: photo.url }} />}
    {photo.status === "loading" && <Text>Loading photo…</Text>}
    {photo.status === "empty" && <Text>No photo</Text>}
    {photo.status === "denied" && <Text>{photo.why.message}</Text>}</>;
}
declare const write: Write<{ id: string }>;
if (write.state === "sent") {
  // @ts-expect-error a replay receipt cannot promise an application result
  const unchecked: { id: string } = write.result;
  if (write.replayed) {
    const absent: undefined = write.result;
  } else {
    const result: { id: string } = write.result;
  }
}
