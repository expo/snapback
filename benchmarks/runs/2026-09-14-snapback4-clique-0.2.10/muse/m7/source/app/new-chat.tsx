import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useClient } from "snapback4/react";
import { api } from "../snapback/generated/api";

export default function NewChat() {
  const router = useRouter();
  const client: any = useClient();
  const [dmHandle, setDmHandle] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [member2, setMember2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startDM = async () => {
    if (busy || !dmHandle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const w = await client.mutate(api.dmCreate, { otherHandle: dmHandle.trim() });
      if (w.state === "failed") setError(`DM failed: ${w.why?.code ?? "unknown"}`);
      else router.push({ pathname: "/chat/[id]", params: { id: w.result.id } });
    } finally {
      setBusy(false);
    }
  };
  const createGroup = async () => {
    if (busy || !groupName.trim() || !member2.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const w = await client.mutate(api.groupCreate, {
        secondMemberHandle: member2.trim(),
        name: groupName.trim(),
        description: groupDesc.trim() || null,
      });
      if (w.state === "failed") setError(`Group failed: ${w.why?.code ?? "unknown"}`);
      else router.push({ pathname: "/chat/[id]", params: { id: w.result.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff", padding: 16, gap: 8 }}>
      <Text style={{ fontWeight: "700" }}>Direct message</Text>
      <TextInput
        value={dmHandle}
        onChangeText={setDmHandle}
        placeholder="handle (e.g. bob)"
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 8 }}
        testID="sm-newchat-dm-handle"
        onSubmitEditing={startDM}
      />
      <Pressable onPress={startDM} style={{ backgroundColor: "#4F46E5", padding: 10, alignItems: "center" }} testID="sm-newchat-dm-submit">
        <Text style={{ color: "#fff" }}>Start DM</Text>
      </Pressable>
      <Text style={{ fontWeight: "700", marginTop: 16 }}>New group</Text>
      <TextInput
        value={groupName}
        onChangeText={setGroupName}
        placeholder="Group name"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 8 }}
        testID="sm-newchat-group-name"
      />
      <TextInput
        value={groupDesc}
        onChangeText={setGroupDesc}
        placeholder="Description (optional)"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 8 }}
        testID="sm-newchat-group-description"
      />
      <TextInput
        value={member2}
        onChangeText={setMember2}
        placeholder="Second member handle"
        autoCapitalize="none"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 8 }}
        testID="sm-newchat-group-member"
      />
      <Pressable onPress={createGroup} style={{ backgroundColor: "#4F46E5", padding: 10, alignItems: "center" }} testID="sm-newchat-group-submit">
        <Text style={{ color: "#fff" }}>Create group</Text>
      </Pressable>
      {error ? <Text testID="sm-newchat-error">{error}</Text> : null}
    </View>
  );
}
