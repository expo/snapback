import { useState } from "react";
import { Button, Pressable, Text, TextInput, View } from "react-native";
import { isAbsent, isDenied, isFailed, isLoading } from "snapback4/contract";
import { useAuth, useLink, useMutation, usePage, useSignedInViewer, type UseMutation, type UsePage } from "snapback4/react";
import { api } from "./snapback/generated/api";
import { tier } from "./src/client";

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
    {isAbsent(todos.read) && <Text>No tasks yet.</Text>}
    {todos.items.map(todo => <View key={todo.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: todo.pending ? 0.6 : 1 }}>
      <Pressable style={{ flex: 1 }} onPress={() => void toggle.run({ todoId: todo.id })}>
        <Text style={{ textDecorationLine: todo.done ? "line-through" : "none" }}>{todo.done ? "☑" : "☐"} {todo.title}</Text>
      </Pressable>
      <Button title="Delete" onPress={() => void remove.run({ todoId: todo.id })} />
    </View>)}
    {todos.hasMore && <Button title="Show more" onPress={todos.loadMore} />}
  </>;
}
