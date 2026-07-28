import { Pressable, Text, View } from 'react-native';
import {
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
} from '@snapback/react';
import api from './snapback/generated/api.mjs';

export function Workspace() {
  const workspace = useSnapbackQueries({
    todos: { ref: api.listTodos, args: {} },
  });
  const createTodo = useSnapbackMutation(api.createTodo);
  const connection = useSnapbackConnection();
  const todos = workspace.queries.todos.status === 'ready'
    || workspace.queries.todos.status === 'refreshing'
    ? workspace.queries.todos.data
    : [];
  return (
    <View>
      <Text>{connection.status}</Text>
      {todos.map((todo) => <Text key={todo._id}>{todo.title}</Text>)}
      <Pressable onPress={() => void createTodo({ title: 'From Expo' })}>
        <Text>Add todo</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return <View><Text>Snapback Expo bundle proof</Text></View>;
}
