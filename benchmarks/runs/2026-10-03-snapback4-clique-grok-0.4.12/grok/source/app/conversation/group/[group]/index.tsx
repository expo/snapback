import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { ResolveGroup } from "../../../../src/ResolveConversation";

export default function GroupRoute() {
  const { group } = useLocalSearchParams<{ group: string }>();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => sub.remove();
  }, []);
  return <ResolveGroup title={group} visible={focused && foreground} />;
}
