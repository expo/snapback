import { useState } from "react";
import { ReadNotice } from "./ReadNotice";
import { url } from "./client";
import { View } from "react-native";
import { mintId } from "snapback4/client";
import { useAuth, useClient, useMutation, useQuery } from "snapback4/react";
import { AuthForm } from "../vendor/social-ui";
import { api } from "../snapback/generated/api";
import { TextInput } from "react-native";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.state === "restoring") return null;
  if (auth.state === "signed-in") return <EnsureProfile key={JSON.stringify([url, auth.viewer, "profile"])}>{children}</EnsureProfile>;
  return <AuthScreen />;
}

function EnsureProfile({ children }: { children: React.ReactNode }) {
  const profile = useQuery(api.myProfile, {});
  return <>{children}<ReadNotice read={profile} /></>;
}

function AuthScreen() {
  const auth = useAuth();
  const client = useClient();
  const save = useMutation(api.saveProfile);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const result = mode === "sign-up"
        ? await auth.signup(email.trim(), password)
        : await auth.login(email.trim(), password);
      if (!result.ok) {
        setError(result.why.message);
        return;
      }
      if (mode === "sign-up" && handle.trim()) {
        const h = handle.trim().toLowerCase();
        const write = await save.run({
          displayName: h,
          handle: h,
          bio: null,
          location: null,
          link: null,
        }, { id: mintId(), waitSeconds: 0 });
        if (write.state === "failed") setError(write.why.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <AuthForm
        mode={mode}
        email={email}
        password={password}
        onChangeEmail={setEmail}
        onChangePassword={setPassword}
        onSubmit={() => { void submit(); }}
        onToggleMode={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
        errorText={error || undefined}
        submitting={submitting}
      />
      {mode === "sign-up" ? (
        <TextInput
          accessibilityLabel="Handle"
          autoCapitalize="none"
          placeholder="Handle"
          value={handle}
          onChangeText={setHandle}
          style={{ marginHorizontal: 32, marginTop: 8, padding: 12, backgroundColor: "#F4F5F7", borderRadius: 10 }}
        />
      ) : null}
    </View>
  );
}
