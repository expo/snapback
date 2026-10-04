import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { AppProvider, useAuth } from "snapback4/react";
import { AuthForm } from "@snapback-bench/social-ui";
import { app, tier } from "../src/client";
import { useNativeSmokeGuest } from "../src/native-smoke";
import { PersistentFeedTabs } from "../src/PersistentFeedTabs";

export default function RootLayout() {
  return (
    <AppProvider app={app}>
      <Account />
    </AppProvider>
  );
}

function Account() {
  useNativeSmokeGuest();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-in");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setProblem("");
    const result = mode === "sign-up" ? await auth.signup(email, password) : await auth.login(email, password);
    if (!result.ok) setProblem(result.why.message);
    else router.replace("/");
    setBusy(false);
  }

  if (auth.state === "restoring") return <Text>Restoring account…</Text>;
  if (auth.state !== "signed-in" && Platform.OS === "web" && globalThis.location?.pathname && globalThis.location.pathname !== "/") {
    globalThis.history.replaceState({}, "", "/");
  }
  if (auth.state === "signed-in") {
    return (
      <View style={{ flex: 1 }}>
      <PersistentFeedTabs />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="conversation/[handle]" options={{ title: "Conversation" }} />
        <Stack.Screen name="conversation/[handle]/settings" options={{ title: "Chat settings" }} />
        <Stack.Screen name="conversation/group/[group]" options={{ title: "Group" }} />
        <Stack.Screen name="conversation/group/[group]/settings" options={{ title: "Chat settings" }} />
        <Stack.Screen name="profile/[handle]" options={{ title: "Profile" }} />
        <Stack.Screen name="profile/edit" options={{ title: "Edit profile" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="insights" options={{ title: "Insights" }} />
        <Stack.Screen name="post/[id]" options={{ title: "Thread" }} />
        <Stack.Screen name="search-chat/[id]" options={{ title: "Search this chat" }} />
        <Stack.Screen name="dm/[other]" options={{ title: "Direct message" }} />
      </Stack>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <Text style={{ textAlign: "center", color: "#6B7280" }}>{tier}</Text>
      <AuthForm
        mode={mode}
        email={email}
        password={password}
        onChangeEmail={setEmail}
        onChangePassword={setPassword}
        onSubmit={() => void submit()}
        onToggleMode={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
        errorText={problem || auth.why?.message}
        submitting={busy}
      />
    </View>
  );
}
