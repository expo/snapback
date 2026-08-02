import { useCallback, useEffect, useState } from 'react';
import type { GeneratedDataModel, Id } from '../snapback/generated/api';
import { api, client, currentUser, parseSearchQueryV1 } from './backend';

type Incident = Pick<GeneratedDataModel['incidents'], '_id' | 'title' | 'summary' | 'severity' | 'status'>;
type Message = Pick<GeneratedDataModel['messages'], '_id' | 'authorName' | 'body'>;
const SEEDED_INCIDENT_ID = 'incident_api' as Id<'incidents'>;

export function App() {
  const [incidents, setIncidents] = useState<readonly Incident[]>([]);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [selected, setSelected] = useState<Id<'incidents'>>(SEEDED_INCIDENT_ID);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [presence, setPresence] = useState(0);
  const [connection, setConnection] = useState('connecting');
  const [error, setError] = useState('');

  const runSearch = useCallback(async () => {
    if (!search.trim()) return;
    const result = await client.search(api.searchIncidents, {
      query: parseSearchQueryV1(search, { fields: ['title', 'summary'] }),
      userId: currentUser.id,
    });
    setIncidents(result.items.map((item) => ({ _id: item.rowId, ...item.fields })));
  }, [search]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    void (async () => {
      const incidentLive = await client.liveQuery(api.listIncidents, {
        connectionId: 'incident-ui', args: {}, userId: currentUser.id, transport: 'stream',
        fallbackToPoll: false, onUpdate: (rows) => setIncidents(rows),
        onConnectionChange: (next) => setConnection(next),
      });
      setIncidents(incidentLive.rows);
      cleanups.push(() => incidentLive.dispose());
      const messageLive = await client.liveQuery(api.messagesForIncident, {
        connectionId: 'message-ui', args: { incidentId: selected }, userId: currentUser.id,
        transport: 'stream', fallbackToPoll: false, onUpdate: setMessages,
      });
      setMessages(messageLive.rows);
      cleanups.push(() => messageLive.dispose());
      const room = await client.subscribeEphemeral(api.ephemeral.incidentPresence, {
        connectionId: 'presence-ui', scope: { incidentId: selected }, userId: currentUser.id,
      });
      const updatePresence = () => setPresence(room?.currentEntries().length ?? 0);
      room.onChange(updatePresence);
      await room.publish({ name: currentUser.name, state: 'viewing' }, { ttlMs: 10_000 });
      updatePresence();
      cleanups.push(() => room.dispose());
    })().catch((cause) => setError(cause.message));
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [selected]);

  const current = incidents.find((incident) => incident._id === selected) ?? incidents[0];
  return <main className="app-shell">
    <header><div><p className="kicker">Snapback 0.1.8 · {connection}</p><h1>Signal desk</h1></div><div className="presence">● {presence} here</div></header>
    <section className="search"><input placeholder="Indexed search" value={search} onChange={(event) => setSearch(event.target.value)} /><button onClick={() => void runSearch()}>Search</button></section>
    <div className="workspace">
      <aside>{incidents.map((incident) => <button key={incident._id} className={selected === incident._id ? 'active' : ''} onClick={() => setSelected(incident._id)}><b>{incident.severity}</b><span>{incident.title}</span><small>{incident.status}</small></button>)}</aside>
      <article>{current ? <>
        <div className="title-row"><div><p className="kicker">{current.severity}</p><h2>{current.title}</h2></div><button onClick={() => void client.mutate(api.acknowledgeIncident, { args: { incidentId: current._id }, userId: currentUser.id })}>Acknowledge</button></div>
        <p className="summary">{current.summary}</p>
        <div className="gap">Attachment upload exercised but blocked by <code>SNAPBACK_AUTH_REQUIRED</code> in 0.1.8.</div>
        <div className="messages">{messages.map((message) => <div key={message._id}><strong>{message.authorName}</strong><span>{message.body}</span></div>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); void client.mutate(api.createMessage, { args: { incidentId: current._id, authorName: currentUser.name, body: draft }, userId: currentUser.id }).then(() => setDraft('')) }}><input placeholder="Post an update" value={draft} onChange={(event) => setDraft(event.target.value)} /><button disabled={!draft.trim()}>Send</button></form>
      </> : <p>No accessible incidents.</p>}</article>
    </div>
    {error && <p className="error">{error}</p>}
  </main>;
}
