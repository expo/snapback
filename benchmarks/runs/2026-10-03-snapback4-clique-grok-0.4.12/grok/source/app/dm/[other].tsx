import { useLocalSearchParams } from "expo-router";
import { ResolveDm } from "../../src/ResolveConversation";

export default function DirectRoute() {
  const { other } = useLocalSearchParams<{ other: string }>();
  return <ResolveDm handle={other} visible />;
}
