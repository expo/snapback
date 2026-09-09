import { useState } from "react";
import { api, reasonMessages } from "snapback2/client";
import { useQuery } from "snapback2/react";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = useQuery(api.messages.search, { term, c: null });
  const hits = result.data ?? [];
  const next = result.receipt?.next !== null && result.receipt?.next !== undefined;
  const limit = next ? "Indexed result limit reached · more available" : "Indexed result limit reached";
  const predicted = hits.some((row) => result.local.predicted.some((item) => item.table === "messages" && item.id === row.id));
  const primary = result.status === "loading" ? "Searching…"
    : result.reason?.code === "held" ? "Downloaded indexed results"
    : result.reason?.code === "partial" ? `Partial indexed results · ${result.reason.detail ?? result.reason.message}`
    : result.status === "unavailable" ? (result.reason?.message ?? "Search unavailable")
    : result.reason?.code === "stale" ? "Showing stale indexed results"
    : result.freshness.live ? "Live indexed results" : "Indexed results";
  const status = [primary, predicted ? reasonMessages.predicted : undefined,
    result.receipt?.outcome === "capped" ? limit : undefined].filter(Boolean).join(" · ");
  return <>
    <p className="scope" data-state={result.receipt?.outcome ?? result.status} data-status={result.status}
      data-receipt={result.receipt?.outcome ?? "none"} data-reason={result.reason?.code}
      data-predicted={String(predicted)} data-next={next ? "available" : "none"}>{status}</p>
    <ul className="hits">
      {hits.map((row) => (
        <li key={row.id} data-message={row.id}>
          <button type="button" onClick={() => onOpen(row.conversationId)}>{row.body}</button>
        </li>
      ))}
    </ul>
  </>;
}

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
