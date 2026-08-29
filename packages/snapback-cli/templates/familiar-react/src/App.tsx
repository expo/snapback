import {
  useAuth,
  useCurrentPrincipal,
  useMutation,
  useQuery,
} from '@expo/snapback-react/familiar';
import { useState } from 'react';
import { api } from '../snapback/generated/api.mjs';

// Hoisted to module scope on purpose: useQuery subscribes by args identity,
// so a fresh inline object would resubscribe every render.
const emptyArgs = {};

export function App() {
  const auth = useAuth();
  const principal = useCurrentPrincipal();
  const todos = useQuery(api.todos.list, emptyArgs) ?? [];
  const createTodo = useMutation(api.todos.create);
  const [email, setEmail] = useState('person@example.com');
  const [password, setPassword] = useState('replace-this-password');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
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
