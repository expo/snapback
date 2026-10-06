import { Text, View } from "react-native";
import { matchRead, useQuery } from "snapback4/react";
import { api } from "../snapback/generated/api";

// @ref LLP 3000.031#7 — only the SDK's absent state proves a missing quote.
export function QuotedMessage({ id }: { id: string }) {
  // messagePhoto is the starter's whole-message point read, including text.
  const read = useQuery(api.messagePhoto, { id });
  const text = matchRead(read, {
    loading: () => "Loading quoted message…",
    denied: () => "Quoted message hidden",
    absent: () => "Quoted message unavailable",
    partial: () => "Quoted message not yet known",
    present: message => message.text,
  });
  return <View style={{ minHeight: 40, padding: 8 }}><Text>{text}</Text></View>;
}
