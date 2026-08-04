import { useEffect, useRef, useState } from 'react';

import api from '../snapback/generated/api.mjs';
import { retainInboxRegistration } from './retained-registration';

type QueryHandle = {
  rows: any[];
  answerClass?: string;
  freshness?: string;
  dispose(): Promise<void> | void;
};

type Client = {
  authRequestCode(email: string): Promise<{ challengeId: string }>;
  authExchange(input: { challengeId: string; code: string }): Promise<unknown>;
  liveQuery(reference: unknown, options: Record<string, unknown>): Promise<QueryHandle>;
};

export function App({ client }: { client: Client }) {
  const [email, setEmail] = useState('owner@triage-graph.test');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [boardId, setBoardId] = useState(() => localStorage.getItem('triage-graph.board') ?? '');
  const [issues, setIssues] = useState<any[]>([]);
  const [transitions, setTransitions] = useState<any[]>([]);
  const [retained, setRetained] = useState<any[]>([]);
  const [retainedClass, setRetainedClass] = useState('unknown');
  const [status, setStatus] = useState('Ready to sign in or relaunch retained custody.');
  const handles = useRef<QueryHandle[]>([]);

  const disposeHandles = async () => {
    const prior = handles.current.splice(0);
    await Promise.allSettled(prior.map((handle) => handle.dispose()));
  };

  const openWorkload = async ({ pin = true } = {}) => {
    await disposeHandles();
    if (boardId) localStorage.setItem('triage-graph.board', boardId);
    setStatus('Opening generated Triage results…');

    // The two calls are intentionally independent. triageGraph is a volatile
    // snapshot batch; retainedInbox is a lease-backed materialization.
    const inboxPromise = client.liveQuery(api.retainedInbox, {
      connectionId: `triage-retained-${Date.now()}`,
      persistResume: true,
      onUpdate: (rows: any[], detail: any) => {
        setRetained(rows);
        setRetainedClass(`${detail.answerClass ?? 'unknown'} / ${detail.freshness ?? 'unknown'}`);
      },
    });
    const graphPromise = boardId
      ? client.liveQuery(api.triageGraph, {
          args: { boardId },
          connectionId: `triage-graph-${Date.now()}`,
          persistResume: false,
          onUpdate: (rows: any[]) => {
            const result = rows[0];
            if (result?.kind !== 'visible') return;
            setIssues(result.nodes[0].children);
            setTransitions(result.nodes[1].children);
          },
        })
      : Promise.reject(new Error('Enter a board id to open the online graph.'));

    const [inboxResult, graphResult] = await Promise.allSettled([inboxPromise, graphPromise]);
    if (inboxResult.status === 'fulfilled') {
      const inbox = inboxResult.value;
      handles.current.push(inbox);
      setRetained(inbox.rows);
      setRetainedClass(`${inbox.answerClass ?? 'unknown'} / ${inbox.freshness ?? 'unknown'}`);
      if (pin && inbox.freshness === 'current') {
        await retainInboxRegistration(client, api.retainedInbox);
      }
    }
    if (graphResult.status === 'fulfilled') {
      const graph = graphResult.value;
      handles.current.push(graph);
      const result = graph.rows[0];
      if (result?.kind === 'visible') {
        setIssues(result.nodes[0].children);
        setTransitions(result.nodes[1].children);
      }
    }
    const outcomes = [inboxResult, graphResult].map((result) => result.status).join(' / ');
    setStatus(`Retained inbox / online graph: ${outcomes}.`);
  };

  useEffect(() => {
    if (boardId) void openWorkload({ pin: false });
    return () => { void disposeHandles(); };
    // Boot once: later board edits are applied only when the operator opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Move-1 successor · P3</p>
          <h1>Triage Graph</h1>
        </div>
        <span className="status">{status}</span>
      </header>

      <section className="controls">
        <label>Email <input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button onClick={() => void client.authRequestCode(email).then((request) => {
          setChallengeId(request.challengeId);
          setStatus('Code requested. Read it from the trusted local mailbox.');
        })}>Request code</button>
        <label>Code <input value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button disabled={!challengeId || !code} onClick={() => void client.authExchange({
          challengeId,
          code,
        }).then(() => setStatus('Authenticated. Open a seeded board.'))}>Exchange</button>
        <label>Board id <input value={boardId} onChange={(event) => setBoardId(event.target.value)} /></label>
        <button className="primary" onClick={() => void openWorkload()}>Open and retain</button>
      </section>

      <section className="grid">
        <article>
          <p className="eyebrow">Generated snapshot batch</p>
          <h2>Active issues <span>{issues.length}/50</span></h2>
          <ul>{issues.map((issue) => (
            <li key={issue.id}>
              <strong>{issue.issueKey}</strong>
              <span>{issue.title}</span>
              <small>P{issue.priority} · {issue.state}</small>
            </li>
          ))}</ul>
        </article>

        <article>
          <p className="eyebrow">Same pinned snapshot</p>
          <h2>Transitions <span>{transitions.length}/20</span></h2>
          <ul>{transitions.map((transition) => (
            <li key={transition.id}>
              <strong>{transition.issueKey}</strong>
              <span>{transition.summary}</span>
              <small>sequence {transition.sequence}</small>
            </li>
          ))}</ul>
        </article>

        <article className="retained">
          <p className="eyebrow">LLP 0166 retained companion</p>
          <h2>Custody inbox <span>{retained.length}/100</span></h2>
          <p className="answer">{retainedClass}</p>
          <ul>{retained.map((issue) => (
            <li key={issue.issueKey}>
              <strong>{issue.issueKey}</strong>
              <span>{issue.title}</span>
              <small>{issue.projectName} · P{issue.priority}</small>
            </li>
          ))}</ul>
        </article>
      </section>
    </main>
  );
}
