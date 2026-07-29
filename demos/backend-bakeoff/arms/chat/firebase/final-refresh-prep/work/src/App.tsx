import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  QueryDocumentSnapshot,
  Timestamp,
  collection,
  disableNetwork,
  limit,
  onSnapshot,
  orderBy,
  query
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
import "./styles.css";

type Message = {
  id: string;
  authorId: string;
  body: string;
  sequence: number;
  createdAt: Timestamp | null;
};

const sendMessage = httpsCallable<
  { channelId: string; body: string },
  { id: string; authorId: string; sequence: number }
>(functions, "sendMessage");

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [source, setSource] = useState("none");
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const channelId = "private-beta";
  const offline = useMemo(
    () => new URLSearchParams(window.location.search).get("offline") === "1",
    []
  );

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!offline) return;
    void disableNetwork(db);
  }, [offline]);

  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, "channels", channelId, "messages"),
      orderBy("sequence", "desc"),
      limit(25)
    );
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        setSource(snapshot.metadata.fromCache ? "cache" : "server");
        setMessages(
          snapshot.docs.map((doc: QueryDocumentSnapshot) => ({
            id: doc.id,
            ...(doc.data() as Omit<Message, "id">)
          }))
        );
      },
      (cause) => {
        setMessages([]);
        setError(cause.code);
      }
    );
  }, [user]);

  async function login() {
    setError("");
    await signInWithEmailAndPassword(auth, "bob@example.test", "CorrectHorseBattery1!");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    await sendMessage({ channelId, body: text });
    setBody("");
  }

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Firebase calibration arm</p>
          <h1>Realtime group chat</h1>
        </div>
        {user ? (
          <button data-testid="logout" onClick={() => signOut(auth)}>
            Log out
          </button>
        ) : (
          <button data-testid="login" onClick={login}>
            Sign in as Bob
          </button>
        )}
      </header>

      <section className="status" aria-live="polite">
        <span data-testid="auth-state">{user ? user.email : "signed-out"}</span>
        <span data-testid="snapshot-source">{source}</span>
        <span data-testid="message-count">{messages.length}</span>
        {error && <span data-testid="error">{error}</span>}
      </section>

      <section aria-label="Private beta messages">
        <h2># private-beta</h2>
        <ol data-testid="message-list">
          {messages.map((message) => (
            <li key={message.id} data-sequence={message.sequence}>
              <b>{message.authorId.slice(0, 8)}</b>
              <span>{message.body}</span>
              <small>#{message.sequence}</small>
            </li>
          ))}
        </ol>
      </section>

      <form onSubmit={submit}>
        <label htmlFor="message">Message</label>
        <input
          id="message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!user || offline}
        />
        <button type="submit" disabled={!user || offline}>
          Send
        </button>
      </form>
    </main>
  );
}
