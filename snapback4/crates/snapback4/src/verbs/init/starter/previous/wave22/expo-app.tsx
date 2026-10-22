import { useState } from "react";
import { Button, SafeAreaView, Text, View, Pressable, TextInput } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useAuth, useAppReady, useLink, useMutation, usePage, useSignedInViewer, type UseMutation, type UsePage } from "snapback4/react";
import { existence, isDenied, isFailed, isLoading } from "snapback4/contract";
import { app, tier } from "./src/client";
import { useNativeSmoke } from "snapback4-expo/native-smoke";
import { api } from "./snapback/generated/api";

export function App() {
  return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}>
    <StatusBar style="auto" /><Account />
  </SafeAreaView></AppProvider>;
}

// Every read and write runs as the signed-in viewer, so sign in first.
function Account() {
  useNativeSmoke();
  const auth = useAuth();
  const ready = useAppReady();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <Text style={{ padding: 24 }}>Restoring your session…</Text>;
  if (auth.state === "signed-in" && !ready) return <Text>{auth.why?.message ?? "Opening…"}</Text>;
  if (auth.state === "signed-in") return <Todos />;
  const signIn = async () => {
    const result = await auth.guest();
    if (!result.ok) setProblem(result.why.message);
  };
  return <View style={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Sign in</Text>
    <Text>{problem || auth.why?.message || "Signed out"}</Text>
    <Button title="Continue as a guest" onPress={() => void signIn()} />
  </View>;
}

function Todos() {
  const auth = useAuth(), link = useLink();
  // Never null here: Account renders this screen only once signed in.
  const viewer = useSignedInViewer();
  // A live query: it re-renders on every change, including this device's own
  // unconfirmed writes (marked `pending`) and changes from other devices.
  // usePage is for a query that takes `c: cursor ?`; any other query reads
  // with useQuery(api.op, args), which returns the Read itself (render it
  // with matchRead from snapback4/contract).
  // Keep the draft in this screen, above release-sensitive read children.
  const [title, setTitle] = useState("");
  const todos = usePage(api.list, {});
  const add = useMutation(api.add), toggle = useMutation(api.toggle), remove = useMutation(api.remove);
  const submit = () => {
    if (!title.trim()) return;
    void add.run({ title: title.trim() });
    setTitle("");
  };
  const failed = [add.last, toggle.last, remove.last].find(isFailed);
  return <View style={{ flex: 1, padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Todos</Text>
    <Text>{viewer} · {tier} · {link === "online" ? "online" : "offline"}</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput accessibilityLabel="Task" style={{ flex: 1, borderWidth: 1, borderColor: "#ccc", padding: 8 }} value={title} onChangeText={setTitle}
        placeholder="What needs doing?" maxLength={200} onSubmitEditing={submit} />
      <Button title="Add" onPress={submit} />
    </View>
    <Text accessibilityLiveRegion="polite">{add.last?.state ?? "Ready"}</Text>
    {failed && <Text style={{ color: "crimson" }}>{failed.why.message}</Text>}
    <TodoList todos={todos} toggle={toggle} remove={remove} />
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </View>;
}

// Hook results are named by the operation for props: UsePage<typeof api.list>,
// UseMutation<typeof api.toggle>, and UseQuery<typeof api.op> for useQuery.
function TodoList({ todos, toggle, remove }: { todos: UsePage<typeof api.list>; toggle: UseMutation<typeof api.toggle>; remove: UseMutation<typeof api.remove> }) {
  return <>
    {isLoading(todos.read) && <Text>Loading…</Text>}
    {isDenied(todos.read) && <Text style={{ color: "crimson" }}>Not available: {todos.read.denied.message}</Text>}
    {existence(todos.read) === "absent" && <Text>No tasks yet.</Text>}
    <View testID="todo-results">{todos.items.map(todo => <View key={todo.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: todo.pending ? 0.6 : 1 }}>
      <Pressable style={{ flex: 1 }} onPress={() => void toggle.run({ todoId: todo.id })}>
        <Text style={{ textDecorationLine: todo.done ? "line-through" : "none" }}>{todo.done ? "☑" : "☐"} {todo.title}</Text>
      </Pressable>
      <Button title="Delete" onPress={() => void remove.run({ todoId: todo.id })} />
    </View>)}</View>
    {todos.hasMore && <Button title="Show more" onPress={todos.loadMore} />}
  </>;
}
