import {
  useSnapbackConnection,
  useSnapbackMutation,
  useSnapbackQueries,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

export function App() {
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
