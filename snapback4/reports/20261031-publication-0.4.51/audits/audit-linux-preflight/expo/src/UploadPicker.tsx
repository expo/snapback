// A bounded image picker for Expo Go, device builds and Expo web.
import { useState } from "react";
import { Button, Platform, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useClient } from "snapback4/react";

/** Selection uploads bytes; onUploaded must place the id through your mutation. */
export function UploadPicker({ onUploaded }: { onUploaded(id: string): void }) {
  const client = useClient();
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState("");
  async function upload(bytes: Blob) {
    setBusy(true); setProblem("");
    try {
      if (!bytes.size || bytes.size > 10_000_000) throw Error("Choose an image of at most 10 MB");
      const result = await client.upload(bytes);
      if (result.ok) onUploaded(result.asset.id); else setProblem(result.why.message);
    } catch (error) { setProblem(String(error)); } finally { setBusy(false); }
  }
  async function pick() {
    if (busy) return;
    setBusy(true); setProblem("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled && result.assets[0]) await upload(await (await fetch(result.assets[0].uri)).blob());
    } catch (error) { setProblem(String(error)); } finally { setBusy(false); }
  }
  return <View>{Platform.OS === "web"
    ? <input aria-label="Choose image" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file); }} />
    : <Button title="Choose image" disabled={busy} onPress={() => { void pick().catch(error => setProblem(String(error))); }} />}
    {busy && <Text>Uploading…</Text>}{problem && <Text accessibilityRole="alert">{problem}</Text>}
  </View>;
}
