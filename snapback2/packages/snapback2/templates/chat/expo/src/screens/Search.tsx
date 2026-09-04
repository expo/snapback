import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { searchHeld, type LogRow } from "../../shared/log.js";
export function Search({ rows, onOpen }: { rows: readonly LogRow[]; onOpen(id: string): void }) {
  const [term, setTerm] = useState("");
  return <View><TextInput accessibilityLabel="Search downloaded messages" placeholder="Search" value={term} onChangeText={setTerm} />
    {term ? <Text>in downloaded messages</Text> : null}
    {searchHeld(rows, term).map((row) => <Pressable key={row.messageId} onPress={() => onOpen(row.conversationId)}><Text>{row.message?.body}</Text></Pressable>)}
  </View>;
}
