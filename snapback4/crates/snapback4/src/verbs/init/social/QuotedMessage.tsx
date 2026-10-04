import { Text, View } from "react-native";
import { useQuery } from "snapback4/react";
import { isReady, readPresentation } from "snapback4/contract";
import { api } from "../snapback/generated/api";

// @ref LLP 3000.031#7 — only the SDK's absent state proves a missing quote.
export function QuotedMessage({ id }: { id: string }) {
  // messagePhoto is the starter's whole-message point read, including text.
  const read = useQuery(api.messagePhoto, { id });
  const status = readPresentation(read);
  let text: string;
  switch (status.existence) {
    case "loading": text = "Loading quoted message…"; break;
    case "denied": text = "Quoted message hidden"; break;
    case "absent": text = "Quoted message unavailable"; break;
    case "partial": text = "Quoted message not yet known"; break;
    case "present": text = isReady(read) && read.existence === "present" ? read.data.text : "Loading quoted message…"; break;
  }
  return <View style={{ minHeight: 40, padding: 8 }}><Text>{text}</Text></View>;
}
