import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ResolveDm } from "../../src/ResolveConversation";

export default function DmRoute() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  return <ResolveDm handle={handle} visible={focused && foreground} />;
}
