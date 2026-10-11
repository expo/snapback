import { useState } from "react";
import { Button, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { isDenied, isLoading } from "snapback4/contract";
import { AppProvider, useAuth, useLink, useMutation, usePage } from "snapback4/react";
import { api } from "./snapback/generated/api";
import { app, tier } from "./src/client";
import { useNativeSmokeGuest } from "./src/native-smoke";

export function App() {
  return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}>
    <StatusBar style="auto" /><Account />
  </SafeAreaView></AppProvider>;
}

// Every read and write runs as the signed-in viewer, so sign in first.
function Account() {
  useNativeSmokeGuest();
  const auth = useAuth();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <Text style={{ padding: 24 }}>Restoring your session…</Text>;
  if (auth.state === "signed-in") return <Todos />;
  const signIn = async () => {
    const result = await auth.guest();
    if (!result.ok) setProblem(result.why.message);
  };
  return <View style={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Todos</Text>
    <Text>{problem || auth.why?.message || "Signed out"}</Text>
    <Button title="Continue as a guest" onPress={() => void signIn()} />
  </View>;
}

function Todos() {
  const auth = useAuth(), link = useLink();
  // A live query: it re-renders on every change, including this device's own
  // unconfirmed writes (marked `pending`) and changes from other devices.
  const todos = usePage(api.list, {});
  const add = useMutation(api.add), toggle = useMutation(api.toggle), remove = useMutation(api.remove);
  const [title, setTitle] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    void add.run({ title: title.trim() });
    setTitle("");
  };
  const failed = [add.last, toggle.last, remove.last].find(write => write?.state === "failed");
  return <View style={{ flex: 1, padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Todos</Text>
    <Text>{tier} · {link === "online" ? "online" : "offline"}</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput style={{ flex: 1, borderWidth: 1, borderColor: "#ccc", padding: 8 }} value={title} onChangeText={setTitle}
        placeholder="What needs doing?" maxLength={200} onSubmitEditing={submit} />
      <Button title="Add" onPress={submit} />
    </View>
    {failed?.state === "failed" && <Text style={{ color: "crimson" }}>{failed.why.message}</Text>}
    {isLoading(todos.read) && <Text>Loading…</Text>}
    {isDenied(todos.read) && <Text style={{ color: "crimson" }}>{todos.read.denied.message}</Text>}
    {todos.items.map(todo => <View key={todo.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: todo.pending ? 0.6 : 1 }}>
      <Pressable style={{ flex: 1 }} onPress={() => void toggle.run({ todoId: todo.id })}>
        <Text style={{ textDecorationLine: todo.done ? "line-through" : "none" }}>{todo.done ? "☑" : "☐"} {todo.title}</Text>
      </Pressable>
      <Button title="Delete" onPress={() => void remove.run({ todoId: todo.id })} />
    </View>)}
    {todos.hasMore && <Button title="Show more" onPress={todos.loadMore} />}
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </View>;
}
