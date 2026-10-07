import { Pressable, Text, View } from "react-native";
import { matchRead, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";

// @ref LLP 3000.031#7 — only the SDK's absent state proves a missing quote.
export function QuotedMessage({ id, onJump }: { id: string; onJump?(message: { id: string; conversation: string; ordinal: number }): void }) {
  // messagePhoto is the starter's whole-message point read, including text.
  const read = useQuery(api.messagePhoto, { id });
  const content = matchRead(read, {
    loading: () => "Loading quoted message…",
    denied: () => "Quoted message hidden",
    absent: () => "Quoted message unavailable",
    partial: () => "Quoted message not yet known",
    present: (message, state) => {
      const excerpt = message.text || (message.photo ? "Photo message" : "Message");
      return onJump ? <Pressable accessibilityRole="button" accessibilityLabel={`Jump to quoted message: ${excerpt}`}
        disabled={!!state.revalidating || !!message.pending} onPress={() => onJump(message)}><Text>{excerpt}</Text></Pressable> : excerpt;
    },
  });
  return <View style={{ minHeight: 40, padding: 8 }}>{typeof content === "string" ? <Text>{content}</Text> : content}</View>;
}
