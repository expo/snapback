import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, ref, uploadBytes } from "firebase/storage";
import { auth, db, functions, storage } from "./firebase";

const ROOM_ID = "room-primary";

type Source = {
  id: string;
  title: string;
  ownerId: string;
  objectPath: string;
  keywords: string[];
};

type Question = {
  id: string;
  prompt: string;
  status: string;
  progressCount: number;
};

function sourceFromSnapshot(snapshot: DocumentData): Source {
  return { id: snapshot.id, ...snapshot.data() } as Source;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("climate");
  const [searchResults, setSearchResults] = useState<Source[]>([]);
  const [prompt, setPrompt] = useState("How do coastal wetlands help communities?");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Sign in to enter the room.");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setSources([]);
      setQuestions([]);
      return;
    }
    const stopSources = onSnapshot(
      query(collection(db, `rooms/${ROOM_ID}/sources`), orderBy("title")),
      (snapshot) => setSources(snapshot.docs.map(sourceFromSnapshot)),
      (error) => setNotice(error.message),
    );
    const stopQuestions = onSnapshot(
      query(collection(db, `rooms/${ROOM_ID}/questions`), orderBy("createdAt", "desc")),
      (snapshot) => setQuestions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Question)),
      (error) => setNotice(error.message),
    );
    return () => {
      stopSources();
      stopQuestions();
    };
  }, [user]);

  useEffect(() => {
    if (!user || !activeQuestion) {
      setProgress([]);
      return;
    }
    return onSnapshot(
      query(collection(db, `rooms/${ROOM_ID}/questions/${activeQuestion}/progress`), orderBy("ordinal")),
      (snapshot) => setProgress(snapshot.docs.map((item) => item.get("message"))),
    );
  }, [activeQuestion, user]);

  const latest = useMemo(() => questions[0], [questions]);

  async function login() {
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, "alice@research.test", "correct-horse-battery");
      setNotice("Signed in as Alice · native Firebase listeners connected");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    const normalized = searchTerm.trim().toLowerCase();
    setSearchResults(sources.filter((source) => source.keywords.includes(normalized)));
    setNotice(`Keyword index matched “${normalized}”.`);
  }

  async function ask() {
    if (!user || !prompt.trim()) return;
    const questionId = `ui-${Date.now()}`;
    setActiveQuestion(questionId);
    setBusy(true);
    setNotice("Dispatching deterministic research stream…");
    try {
      const execute = httpsCallable(functions, "executeQuestion");
      await execute({
        roomId: ROOM_ID,
        questionId,
        dedupeKey: questionId,
        prompt,
        fault: "complete",
        delayMs: 180,
      });
      setNotice("Answer completed with source-record citations.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    if (!user) return;
    const sourceDoc = doc(collection(db, `rooms/${ROOM_ID}/sources`));
    const objectPath = `rooms/${ROOM_ID}/sources/${sourceDoc.id}`;
    await uploadBytes(ref(storage, objectPath), file, {
      contentType: "text/plain",
      customMetadata: { ownerId: user.uid, sourceId: sourceDoc.id },
    });
    await setDoc(sourceDoc, {
      title: file.name,
      ownerId: user.uid,
      objectPath,
      keywords: ["upload"],
      createdAt: serverTimestamp(),
    });
    setNotice(`Uploaded ${file.name}.`);
  }

  async function removeSource(source: Source) {
    await deleteObject(ref(storage, source.objectPath));
    await deleteDoc(doc(db, `rooms/${ROOM_ID}/sources/${source.id}`));
    setNotice(`Deleted ${source.title}.`);
  }

  if (!user) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">F</div>
          <p className="eyebrow">FIELDNOTE RESEARCH</p>
          <h1>A room for evidence, not tabs.</h1>
          <p className="lede">Collect sources, ask questions, and watch every durable reasoning step arrive live.</p>
          <button className="primary" onClick={login} disabled={busy} data-testid="sign-in">
            {busy ? "Connecting…" : "Enter as Alice"}
          </button>
          <p className="fine">{notice}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark small">F</span><strong>Fieldnote</strong></div>
        <p className="eyebrow">RESEARCH ROOMS</p>
        <button className="room active"><span>◈</span><span>Coastal resilience</span><em>2</em></button>
        <button className="room"><span>◇</span><span>Material futures</span><em>2</em></button>
        <div className="sidebar-spacer" />
        <div className="identity"><span>A</span><div><strong>Alice</strong><small>Researcher</small></div></div>
        <button className="ghost" onClick={() => signOut(auth)}>Sign out</button>
      </aside>

      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">ROOM / ACTIVE</p>
            <h1>Coastal resilience</h1>
          </div>
          <div className="presence"><i className="alice">A</i><i className="bob">B</i><span>2 live</span></div>
        </header>

        <section className="search-row">
          <label>
            <span>⌕</span>
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} aria-label="Keyword search" />
          </label>
          <button onClick={search}>Search sources</button>
          <span className="semantic">Semantic search · local GAP</span>
        </section>

        <div className="content-grid">
          <section className="sources-panel">
            <div className="section-title"><div><p className="eyebrow">LIBRARY</p><h2>Sources</h2></div><strong>{sources.length}</strong></div>
            <label className="upload">
              <input type="file" accept="text/plain" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} />
              + Add source
            </label>
            <div className="source-list">
              {(searchResults.length ? searchResults : sources.slice(0, 7)).map((source, index) => (
                <article className="source-card" key={source.id}>
                  <div className={`file-icon tint-${index % 4}`}>TXT</div>
                  <div><strong>{source.title}</strong><small>{source.keywords.slice(0, 2).join(" · ")}</small></div>
                  {source.ownerId === user.uid && <button onClick={() => removeSource(source)} aria-label={`Delete ${source.title}`}>×</button>}
                </article>
              ))}
            </div>
          </section>

          <section className="answer-panel">
            <div className="section-title"><div><p className="eyebrow">LIVE SYNTHESIS</p><h2>Ask the room</h2></div><span className="native">● Firebase push</span></div>
            <div className="question-box">
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="Research question" />
              <button className="primary" onClick={ask} disabled={busy}>{busy ? "Researching…" : "Ask →"}</button>
            </div>

            <article className="answer-card">
              <div className="answer-head"><span className="spark">✦</span><div><strong>{latest?.prompt ?? "Ready for a grounded question"}</strong><small>{latest?.status ?? "Awaiting a question"}</small></div></div>
              <div className="progress-stack">
                {(progress.length ? progress : [
                  "Membership and source authority",
                  "Deterministic retrieval",
                  "Cited synthesis",
                  "Terminal settlement",
                ]).map((message, index) => (
                  <div className={index < progress.length ? "step done" : "step"} key={message}>
                    <span>{index < progress.length ? "✓" : index + 1}</span><p>{message}</p>
                  </div>
                ))}
              </div>
              {latest?.status === "complete" && (
                <div className="answer-text">
                  Coastal wetlands retain carbon while reducing flood exposure.
                  <div><button>[1] Wetland carbon study</button><button>[2] Flood exposure brief</button></div>
                </div>
              )}
            </article>
            <p className="notice">{notice}</p>
          </section>
        </div>
      </section>
    </main>
  );
}
