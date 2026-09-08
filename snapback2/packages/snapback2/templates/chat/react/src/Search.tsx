import { useState } from "react";
import { api } from "snapback2/client";
import { useQuery } from "snapback2/react";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = useQuery(api.messages.search, { term, c: null });
  const hits = result.data ?? [];
  const next = result.receipt?.next !== null && result.receipt?.next !== undefined;
  const status = result.status === "loading" ? "Searching…"
    : result.reason?.code === "held" ? "Downloaded indexed results"
    : result.reason?.code === "partial" ? `Partial indexed results · ${result.reason.detail ?? result.reason.message}`
    : result.receipt?.outcome === "capped" ? (next ? "Indexed result limit reached · more available" : "Indexed result limit reached")
    : result.status === "unavailable" ? (result.reason?.message ?? "Search unavailable")
    : result.reason?.code === "stale" ? "Showing stale indexed results"
    : result.freshness.live ? "Live indexed results" : "Indexed results";
  return <>
    <p className="scope" data-state={result.receipt?.outcome ?? result.status} data-next={next ? "available" : "none"}>{status}</p>
    <ul className="hits">
      {hits.map((row) => (
        <li key={row.id} data-message={row.id}>
          <button type="button" onClick={() => onOpen(row.conversationId)}>{row.body}</button>
        </li>
      ))}
    </ul>
  </>;
}

// @ref LLP 1012#6-reads-offline — search is the same named Unicode index
// online and over held rows; provenance and completeness stay visible.
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
