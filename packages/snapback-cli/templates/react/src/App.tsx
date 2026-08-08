import {
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

// Hoisted to module scope on purpose: useSnapbackQueries subscribes by the
// identity of this entries map, so a fresh inline object would resubscribe
// every render. Build the map with useMemo instead if args become dynamic.
const workspaceQueries = {
  todos: { ref: api.listTodos, args: {} },
};

export function App() {
  const workspace = useSnapbackQueries(workspaceQueries);
  const createTodo = useSnapbackMutation(api.createTodo);
  const connection = useSnapbackConnection();
  const todos = workspace.queries.todos.status === 'ready'
    || workspace.queries.todos.status === 'refreshing'
    ? workspace.queries.todos.data
    : [];
  return (
    <main>
      <h1>Snapback todos</h1>
      <p>Connection: {connection.status}</p>
      <button onClick={() => void createTodo({ title: `Todo ${todos.length + 1}` })}>
        Add todo
      </button>
      <ul>{todos.map((todo) => <li key={todo._id}>{todo.title}</li>)}</ul>
    </main>
  );
}
