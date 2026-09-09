import React, { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { api, type Principal } from "snapback2/client";
import { useMutation } from "snapback2/react-native";

export function NewConversation({ onOpen }: { onOpen(id: string): void }) {
  const [title, setTitle] = useState(""), [member, setMember] = useState("");
  const create = useMutation(api.groups.groupCreate);
  const submit = async () => {
    const result = await create.run({ title: title.trim(), members: [member.trim() as Principal] });
    if (result.state === "committed") { setTitle(""); setMember(""); onOpen(result.data.id); }
  };
  return <View accessibilityLabel="New conversation">
    <Text>New conversation</Text><Text>Ask a friend to share their account ID shown above.</Text>
    <TextInput accessibilityLabel="Title" placeholder="Title" value={title} maxLength={120} onChangeText={setTitle} />
    <TextInput accessibilityLabel="Member account ID" placeholder="Member account ID" value={member} autoCapitalize="none" onChangeText={setMember} />
    <Button title="Create conversation" disabled={create.inFlight || !create.can.send || !title.trim() || !member.trim()} onPress={() => void submit()} />
    {create.last?.state === "rejected" ? <Text accessibilityRole="alert">{create.last.message}</Text> :
      create.last?.state === "queued" ? <Text>Queued. Your conversation will appear after reconnecting.</Text> : null}
    {!create.can.send ? <Text>{create.can.reason?.message}</Text> : null}
  </View>;
}
