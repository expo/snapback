import {
  useSnapbackAuth,
  useSnapbackConnection,
  useSnapbackCurrentPrincipal,
  useSnapbackMutation,
  useSnapbackQueries,
} from '@expo/snapback-react';
import { useState } from 'react';
import api from '../snapback/generated/api.mjs';

// Hoisted to module scope on purpose: useSnapbackQueries subscribes by the
// identity of this entries map, so a fresh inline object would resubscribe
// every render. Build the map with useMemo instead if args become dynamic.
const workspaceQueries = {
  todos: { ref: api.listTodos, args: {} },
};

export function App() {
  const auth = useSnapbackAuth();
  const principal = useSnapbackCurrentPrincipal();
  const workspace = useSnapbackQueries(workspaceQueries);
  const createTodo = useSnapbackMutation(api.createTodo);
  const connection = useSnapbackConnection();
  const [email, setEmail] = useState('person@example.com');
  const [password, setPassword] = useState('replace-this-password');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const todos = workspace.queries.todos.status === 'ready'
    || workspace.queries.todos.status === 'refreshing'
    ? workspace.queries.todos.data
    : [];

  const signUp = async () => {
    setRecoveryCodes(null);
    const result = await auth.signUpWithPassword({ email, password });
    setRecoveryCodes(result.recoveryCodes);
  };
  const signIn = async () => {
    setRecoveryCodes(null);
    await auth.signInWithPassword({ email, password });
  };
  const signOut = async () => {
    setRecoveryCodes(null);
    await auth.signOut();
  };

  return (
    <main>
      <h1>Snapback todos</h1>
      <p>Connection: {connection.status}</p>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <p>
          {principal.status === 'authenticated'
            ? `Signed in: ${principal.userId}`
            : principal.status === 'anonymous'
              ? 'Ready to sign up or sign in'
              : `Authentication: ${principal.status}`}
        </p>
        {principal.status === 'anonymous' ? (
          <>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <button onClick={() => void signUp()}>Sign up</button>
            <button onClick={() => void signIn()}>Sign in</button>
          </>
        ) : null}
        {principal.status === 'authenticated'
          ? <button onClick={() => void signOut()}>Sign out</button>
          : null}
        {recoveryCodes ? (
          <aside>
            <strong>Save these recovery codes now. They are shown once.</strong>
            <pre>{recoveryCodes.join('\n')}</pre>
          </aside>
        ) : null}
      </section>
      <button onClick={() => void createTodo({ title: `Todo ${todos.length + 1}` })}>
        Add todo
      </button>
      <ul>{todos.map((todo) => <li key={todo._id}>{todo.title}</li>)}</ul>
    </main>
  );
}
