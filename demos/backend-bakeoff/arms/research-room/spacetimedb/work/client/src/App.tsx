import { useEffect, useMemo, useState } from 'react';
import { DbConnection } from './module_bindings';

const URI = 'ws://127.0.0.1:3344';
const DATABASE = 'llp0102-research-spacetimedb-w1';
const QUERIES = [
  'SELECT * FROM my_rooms',
  'SELECT * FROM my_sources',
  'SELECT * FROM my_questions',
  'SELECT * FROM my_answers',
  'SELECT * FROM my_progress',
];

export function App() {
  const [connection, setConnection] = useState<DbConnection | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const savedToken = localStorage.getItem('research-room-spacetimedb-token');
    let builder = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DATABASE)
      .onConnect((conn, _identity, token) => {
        localStorage.setItem('research-room-spacetimedb-token', token);
        const refresh = () => setRevision(value => value + 1);
        for (const target of [
          conn.db.myRooms,
          conn.db.mySources,
          conn.db.myQuestions,
          conn.db.myAnswers,
          conn.db.myProgress,
        ]) {
          target.onInsert(refresh);
          target.onDelete(refresh);
          target.onUpdate(refresh);
        }
        conn.subscriptionBuilder()
          .onApplied(() => {
            setConnection(conn);
            refresh();
          })
          .onError(ctx => setError(String((ctx as any)?.event?.message ?? 'subscription failed')))
          .subscribe(QUERIES);
      })
      .onConnectError((_ctx, cause) => setError(cause.message));
    if (savedToken) builder = builder.withToken(savedToken);
    const conn = builder.build();
    return () => conn.disconnect();
  }, []);

  const sources = useMemo(
    () => connection ? Array.from(connection.db.mySources.iter()) : [],
    [connection, revision]
  );
  const questions = useMemo(
    () => connection ? Array.from(connection.db.myQuestions.iter()) : [],
    [connection, revision]
  );
  const answers = useMemo(
    () => connection ? Array.from(connection.db.myAnswers.iter()) : [],
    [connection, revision]
  );
  const progress = useMemo(
    () => connection ? Array.from(connection.db.myProgress.iter()) : [],
    [connection, revision]
  );
  const latestQuestion = questions.at(-1);
  const latestAnswer = answers.find(row => row.questionId === latestQuestion?.id);
  const latestProgress = progress.filter(row => row.questionId === latestQuestion?.id);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Collaborative AI research room</p>
          <h1>Backend architecture</h1>
        </div>
        <span className={error ? 'status error' : 'status'}>
          {error || (connection ? 'SpacetimeDB live' : 'Connecting…')}
        </span>
      </header>
      <section className="workspace research-grid" aria-label="Research room">
        <nav className="panel source-nav" aria-label="Sources">
          <button className="primary" data-testid="research-upload">Upload source</button>
          <p className="section-label">{sources.length} sources</p>
          {(sources.length ? sources.slice(0, 8).map(row => row.filename) : [
            'Architecture.pdf',
            'Interview notes.md',
            'Benchmarks.csv',
            'Roadmap.txt',
          ]).map(name => <button className="nav-row" key={name}>{name}</button>)}
        </nav>
        <div className="panel research-panel">
          <div className="section-heading">
            <div><p className="eyebrow">Shared room</p><h2>Cancellation safety</h2></div>
            <span>2 members</span>
          </div>
          <article className="question">
            <strong>Alice</strong>
            <p>{latestQuestion?.prompt ?? 'Which backend properties matter most for cancellation safety?'}</p>
          </article>
          <article className="answer" data-testid="research-answer">
            <p className="eyebrow">Answer · {latestAnswer?.status ?? 'complete'}</p>
            <p>{latestAnswer?.body || 'Durable attempt identity and an authoritative cancellation fence keep late work from becoming a successful patch.'}</p>
            <div className="citations">
              {(latestAnswer?.citations.length ? latestAnswer.citations : ['source-01', 'source-02'])
                .map(citation => <button key={citation}>[{citation}]</button>)}
            </div>
          </article>
          <div className="progress" data-testid="research-progress">
            {[1, 2, 3, 4].map(step => <span className={latestProgress.length >= step ? 'complete' : ''} key={step} />)}
          </div>
          <label className="composer">
            Ask the room
            <input data-testid="research-question" placeholder="Ask a cited question…" />
          </label>
        </div>
      </section>
    </main>
  );
}
