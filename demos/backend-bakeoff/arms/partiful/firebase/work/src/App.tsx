import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { EMULATORS, PROJECT_ID, REGION } from "../harness/constants";

const firebaseApp = initializeApp({
  apiKey: "demo-api-key",
  appId: "demo:partiful:neutral-ui",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`,
});
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const functions = getFunctions(firebaseApp, REGION);
connectAuthEmulator(auth, `http://${EMULATORS.auth.host}:${EMULATORS.auth.port}`, {
  disableWarnings: true,
});
connectFirestoreEmulator(db, EMULATORS.firestore.host, EMULATORS.firestore.port);
connectFunctionsEmulator(functions, EMULATORS.functions.host, EMULATORS.functions.port);

type EventPreview = {
  id: string;
  title: string;
  location: string;
  startsAt?: { toDate(): Date };
};

export function App() {
  const [events, setEvents] = useState<EventPreview[]>([]);
  const [selected, setSelected] = useState("event-01");
  const [user, setUser] = useState(auth.currentUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [wall, setWall] = useState<Array<{ id: string; body: string; authorName: string }>>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => onSnapshot(
    query(collection(db, "publicEvents"), where("published", "==", true)),
    (snapshot) => setEvents(snapshot.docs.map((entry) => ({
      id: entry.id,
      ...(entry.data() as Omit<EventPreview, "id">),
    })).sort((a, b) => a.id.localeCompare(b.id))),
  ), []);
  useEffect(() => {
    if (!user) {
      setWall([]);
      return;
    }
    return onSnapshot(
      collection(db, "events", selected, "wallPosts"),
      (snapshot) => setWall(snapshot.docs.map((entry) => ({
        id: entry.id,
        ...(entry.data() as { body: string; authorName: string }),
      }))),
      () => setWall([]),
    );
  }, [selected, user]);

  const current = useMemo(
    () => events.find((event) => event.id === selected) ?? events[0],
    [events, selected],
  );

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setMessage("Sign-in failed. Acceptance actor passwords stay in local ignored custody.");
    }
  }

  async function rsvp(response: "yes" | "maybe" | "no") {
    try {
      await httpsCallable(functions, "rsvp")({ eventId: selected, response, plusOneCount: 0 });
      setMessage(`RSVP saved: ${response}`);
    } catch {
      setMessage("This account is not invited to that event.");
    }
  }

  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !draft.trim()) return;
    await addDoc(collection(db, "events", selected, "wallPosts"), {
      eventId: selected,
      authorUid: user.uid,
      authorName: user.displayName ?? "Guest",
      body: draft.trim(),
      ordinal: Date.now(),
      createdAt: serverTimestamp(),
    });
    setDraft("");
  }

  return (
    <main>
      <header>
        <a className="brand" href="#">gather<span>●</span></a>
        <div className="auth">
          {user ? (
            <>
              <span>{user.displayName ?? user.email}</span>
              <button className="quiet" onClick={() => signOut(auth)}>Sign out</button>
            </>
          ) : <span>Firebase local arm</span>}
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">YOU’RE INVITED</p>
        <h1>{current?.title ?? "Loading celebrations…"}</h1>
        <p className="lede">{current?.location ?? "Somewhere wonderful"}</p>
        <div className="date">SAT <strong>15</strong> AUG · 7:00 PM</div>
        <div className="actions">
          {(["yes", "maybe", "no"] as const).map((response) => (
            <button key={response} disabled={!user} onClick={() => rsvp(response)}>
              {response === "yes" ? "I’m in" : response}
            </button>
          ))}
        </div>
        {message && <p className="message">{message}</p>}
      </section>

      <div className="layout">
        <aside>
          <h2>Upcoming</h2>
          {events.slice(0, 8).map((entry) => (
            <button
              className={entry.id === selected ? "event active" : "event"}
              key={entry.id}
              onClick={() => setSelected(entry.id)}
            >
              <span>{entry.title}</span>
              <small>{entry.location}</small>
            </button>
          ))}
        </aside>
        <section className="wall">
          <h2>Party wall</h2>
          {!user ? (
            <form className="login" onSubmit={login}>
              <p>Sign in to see private details and join the conversation.</p>
              <input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
              <input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <button>Sign in</button>
            </form>
          ) : (
            <>
              <form className="composer" onSubmit={post}>
                <input maxLength={500} placeholder="Share something with the guests…" value={draft} onChange={(event) => setDraft(event.target.value)} />
                <button>Post</button>
              </form>
              <div className="posts">
                {wall.map((entry) => <article key={entry.id}><strong>{entry.authorName}</strong><p>{entry.body}</p></article>)}
                {wall.length === 0 && <p className="empty">No messages yet.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
