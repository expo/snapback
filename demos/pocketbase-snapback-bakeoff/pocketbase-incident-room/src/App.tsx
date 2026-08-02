import { useCallback, useEffect, useMemo, useState } from 'react'
import PocketBase, { type RecordModel } from 'pocketbase'
import './App.css'

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL ?? 'http://127.0.0.1:8099')
pb.autoCancellation(false)

function App() {
  const [email, setEmail] = useState('ada@example.test')
  const [password, setPassword] = useState('correct-horse-ada')
  const [incidents, setIncidents] = useState<RecordModel[]>([])
  const [messages, setMessages] = useState<RecordModel[]>([])
  const [selected, setSelected] = useState('incidentapi0000')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const signedIn = pb.authStore.isValid

  const refresh = useCallback(async () => {
    if (!pb.authStore.isValid) return
    const filter = search
      ? pb.filter('title ~ {:term} || summary ~ {:term}', { term: search })
      : ''
    const [nextIncidents, nextMessages] = await Promise.all([
      pb.collection('incidents').getFullList({ filter, sort: '-created', expand: 'commander' }),
      pb.collection('messages').getFullList({
        filter: pb.filter('incident = {:incident}', { incident: selected }),
        sort: 'created', expand: 'author',
      }),
    ])
    setIncidents(nextIncidents)
    setMessages(nextMessages)
  }, [search, selected])

  useEffect(() => {
    if (!signedIn) return
    void refresh().catch((cause) => setError(cause.message))
    const unsubs: Array<() => Promise<void>> = []
    void pb.collection('incidents').subscribe('*', () => void refresh(), { filter: 'room = "roomops00000000"' }).then((fn) => unsubs.push(fn))
    void pb.collection('messages').subscribe('*', () => void refresh(), { filter: `incident = "${selected}"` }).then((fn) => unsubs.push(fn))
    return () => { for (const unsub of unsubs) void unsub() }
  }, [refresh, selected, signedIn])

  const current = useMemo(() => incidents.find((row) => row.id === selected), [incidents, selected])

  if (!signedIn) return (
    <main className="login">
      <p className="eyebrow">PocketBase 0.39.9 · incident room</p>
      <h1>Sign in to operations</h1>
      <input value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Email" />
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="Password" />
      <button onClick={() => void pb.collection('users').authWithPassword(email, password).then(refresh).catch((cause) => setError(cause.message))}>Sign in</button>
      {error && <p className="error">{error}</p>}
    </main>
  )

  return (
    <main className="shell">
      <header>
        <div><p className="eyebrow">PocketBase · live</p><h1>Incident room</h1></div>
        <button className="quiet" onClick={() => { pb.authStore.clear(); location.reload() }}>Sign out</button>
      </header>
      <section className="toolbar">
        <input placeholder="Search incidents" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button onClick={() => void refresh()}>Search</button>
      </section>
      <div className="grid">
        <aside>
          {incidents.map((incident) => (
            <button className={`incident ${selected === incident.id ? 'selected' : ''}`} key={incident.id} onClick={() => setSelected(incident.id)}>
              <span className={`severity ${incident.severity}`}>{incident.severity}</span>
              <strong>{incident.title}</strong>
              <small>{incident.status}</small>
            </button>
          ))}
        </aside>
        <article>
          {current ? <>
            <div className="detail-head"><div><p className="eyebrow">{current.severity}</p><h2>{current.title}</h2></div>
              <button disabled={current.status === 'acknowledged'} onClick={() => void pb.send(`/api/incident-room/incidents/${current.id}/acknowledge`, { method: 'POST' }).then(refresh)}>Acknowledge</button>
            </div>
            <p className="summary">{current.summary.replace(/<[^>]*>/g, '')}</p>
            <div className="timeline">
              {messages.map((item) => <div className="message" key={item.id}><strong>{item.expand?.author?.name ?? 'Operator'}</strong><span>{item.body}</span><time>{item.created?.slice(11, 16)}</time></div>)}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void pb.collection('messages').create({ incident: selected, body: message }).then(() => { setMessage(''); return refresh() }) }}>
              <input placeholder="Send an update" value={message} onChange={(event) => setMessage(event.target.value)} />
              <button disabled={!message.trim()}>Send</button>
            </form>
          </> : <p>Select an incident.</p>}
        </article>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  )
}

export default App
