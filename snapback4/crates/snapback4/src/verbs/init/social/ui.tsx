import { useState } from "react";
import { Button, Image, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useAsset, useClient } from "snapback4/react";
import type { Read } from "snapback4/contract";

export function ReadState({ read }: { read: Read<unknown> }) {
  return <Text>{"loading" in read ? "Loading…" : "denied" in read ? read.denied.message :
    [read.revalidating ? "Checking…" : "", !read.fresh ? "Saved on this device" : "", !read.complete ? "Partial results" : ""].filter(Boolean).join(" · ")}</Text>;
}
export function Avatar({ id }: { id: string | null }) {
  const asset = useAsset(id);
  return asset.status === "ready" ? <Image source={{ uri: asset.url }} style={{ width: 64, height: 64 }} /> : null;
}
export function PhotoPicker({ title, onUploaded }: { title: string; onUploaded(id: string): void }) {
  const client = useClient();
  const [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  async function pick() {
    setBusy(true); setProblem("");
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled) return;
      const file = picked.assets[0];
      const bytes = await (await fetch(file.uri)).blob();
      const uploaded = await client.upload(bytes);
      if (uploaded.ok) onUploaded(uploaded.asset.id);
      else setProblem(uploaded.why.message);
    } catch (error) { setProblem(String(error)); }
    finally { setBusy(false); }
  }
  return <View><Button title={title} disabled={busy} onPress={() => void pick()} /><Text>{problem}</Text></View>;
}
