import { useState } from "react";
import { api } from "snapback2/client";
import { useQuery } from "snapback2/react";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = useQuery(api.messages.search, { term, c: null });
  const hits = "data" in result && Array.isArray(result.data) ? result.data : [];
  const next = "next" in result && result.next !== null;
  const status = result.state === "hydrating" ? "Searching…"
    : result.state === "held" ? "Downloaded indexed results"
    : result.state === "partial" ? `Partial indexed results · ${result.reason}`
    : result.state === "capped" ? (next ? "Indexed result limit reached · more available" : "Indexed result limit reached")
    : result.state === "denied" ? `Search denied · ${result.rule}`
    : result.state === "refused" ? (result.refusal.rewrite ?? result.refusal.message)
    : result.state === "stale" ? "Showing stale indexed results"
    : result.live ? "Live indexed results" : "Indexed results";
  return <>
    <p className="scope" data-state={result.state} data-next={next ? "available" : "none"}>{status}</p>
    <ul className="hits">
      {hits.map((row) => (
        <li key={row.id} data-message={row.id}>
          <button type="button" onClick={() => onOpen(row.conversationId)}>{row.body}</button>
        </li>
      ))}
    </ul>
  </>;
}

// @ref LLP 1012#6-reads-offline — search is a named indexed query. A held
// answer is labeled as downloaded; partial/capped answers keep their evidence.
export function Search({ onOpen }: { onOpen(conversationId: string): void }) {
  const [term, setTerm] = useState("");
  const normalized = term.trim();
  return (
    <section aria-label="Search">
      <input aria-label="Search messages" value={term} maxLength={128} placeholder="Search" onChange={(event) => setTerm(event.target.value)} />
      {normalized ? <Results term={normalized} onOpen={onOpen} /> : null}
    </section>
  );
}
