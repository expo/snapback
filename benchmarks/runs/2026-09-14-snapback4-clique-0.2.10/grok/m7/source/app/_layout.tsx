import { AuthForm, FeedTabs, type FeedTab } from "@snapback-bench/social-ui";
import { Slot, usePathname, useRouter } from "expo-router";
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionGate, useSessionGate } from "../src/AppProviders";

function Shell(): React.JSX.Element {
  const { client, register, login } = useSessionGate();
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  if (!client) {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
        <AuthForm
          mode={mode}
          email={email}
          password={password}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onSubmit={async (e, p) => {
            setSubmitting(true);
            setError(undefined);
            const err = mode === "sign-up" ? await register(e, p) : await login(e, p);
            if (err) setError(err);
            setSubmitting(false);
          }}
          onToggleMode={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
          errorText={error}
          submitting={submitting}
        />
      </ScrollView>
    );
  }
  const router = useRouter();
  const path = usePathname() ?? "";
  const active: FeedTab = path.includes("tab=trending")
    ? "trending"
    : path.includes("tab=global")
      ? "global"
      : "following";
  return (
    <View style={{ flex: 1 }}>
      <FeedTabs
        active={active}
        onChange={(next) => {
          if ((path ?? "").startsWith("/feed")) router.setParams({ tab: next });
          else router.push(`/feed?tab=${next}`);
        }}
      />
      <Slot />
    </View>
  );
}

export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SessionGate>
        <Shell />
      </SessionGate>
    </SafeAreaProvider>
  );
}
