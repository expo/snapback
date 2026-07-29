import { useMemo, useState } from 'react';

const sources = [
  ['01', 'Bounded streams and durable winners', 'aurora · research'],
  ['02', 'Authorization as a persistent obligation', 'harbor · research'],
  ['03', 'Scheduled refresh field study', 'quartz · research'],
];

export default function App() {
  const [persona, setPersona] = useState('alice');
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => sources.filter(([, title, tags]) =>
      `${title} ${tags}`.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <main>
      <header>
        <a className="brand" href="/" aria-label="Fieldnotes home">
          <span className="brandMark">F</span>
          <span>Fieldnotes</span>
        </a>
        <nav aria-label="Research room navigation">
          <button className="navActive">Research room</button>
          <button>Sources</button>
          <button>Activity</button>
        </nav>
        <label className="persona">
          <span>View as</span>
          <select
            data-testid="persona-switcher"
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
          >
            <option value="alice">Alice · owner</option>
            <option value="bob">Bob · member</option>
            <option value="mallory">Mallory · outsider</option>
          </select>
        </label>
      </header>

      <section className="hero">
        <p className="eyebrow">PRIMARY RESEARCH ROOM / LIVE</p>
        <div className="heroRow">
          <div>
            <h1>Make evidence<br />answerable.</h1>
            <p className="dek">
              Ask across a shared source library. Every partial answer is durable,
              cited, and visible to the room.
            </p>
          </div>
          <aside className="roomCard" data-testid="room-summary">
            <span className="roomNumber">20</span>
            <span>frozen sources</span>
            <div className="avatars" aria-label="Alice and Bob are members">
              <i>A</i><i>B</i><b>2 members</b>
            </div>
          </aside>
        </div>
      </section>

      <section className="workspace">
        <div className="sourcePane">
          <div className="sectionTitle">
            <h2>Source shelf</h2>
            <span>Keyword index</span>
          </div>
          <input
            data-testid="source-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search research, aurora, quartz…"
            aria-label="Search sources"
          />
          <div className="sourceList">
            {filtered.map(([number, title, tags]) => (
              <article key={number}>
                <span className="sourceIndex">{number}</span>
                <div><h3>{title}</h3><p>{tags}</p></div>
                <span className="fileType">TXT</span>
              </article>
            ))}
          </div>
          <button className="upload" disabled aria-describedby="asset-gap">
            Upload source
          </button>
          <p id="asset-gap" className="gap">
            File bytes are an explicit capability gap on this frozen Snapback target.
          </p>
        </div>

        <div className="answerPane">
          <div className="sectionTitle">
            <h2>Research thread</h2>
            <span className="liveDot">Authoritative live</span>
          </div>
          <div className="question">
            <span>Alice asked</span>
            <h3>Which constraints keep streamed answers correct after cancellation?</h3>
          </div>
          <div className="answer" data-testid="answer-card">
            <div className="answerMeta"><span>FIELDNOTES</span><span>Complete · 4 updates</span></div>
            <p>
              A durable terminal winner and an in-transaction status check form
              the fence. Progress commits that arrive after cancellation observe
              the terminal row and cannot patch the answer.
            </p>
            <div className="citations">
              <span>[1] Bounded streams</span>
              <span>[2] Authorization obligations</span>
            </div>
          </div>
          <form onSubmit={(event) => event.preventDefault()}>
            <textarea aria-label="Ask a research question" placeholder="Ask across 20 sources…" />
            <button data-testid="ask-question">Ask the room <span>↗</span></button>
          </form>
        </div>
      </section>
      <footer>
        <span>SNAPBACK / LOCAL IBEX + SQLITE</span>
        <span>Semantic retrieval: explicit GAP</span>
      </footer>
    </main>
  );
}
