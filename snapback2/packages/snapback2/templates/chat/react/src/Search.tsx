import { useState } from "react";
import { api, reasonMessages } from "snapback2/client";
import { usePage } from "snapback2/react";

function Results({ term, onOpen }: { term: string; onOpen(conversationId: string): void }) {
  const result = usePage(api.messages.search, { term });
  const hits = result.items, page = result.pages.at(-1), next = result.hasMore;
  const predicted = result.pages.some(page => page.local.predicted.some(item => item.table === "messages" && page.data?.some(row => row.id === item.id)));
  const primary = result.status === "loading" ? "Searching…"
    : result.reason?.code === "held" ? "Matching downloaded messages"
    : result.reason?.code === "partial" ? "Some matching messages are not downloaded"
    : result.status === "unavailable" ? "Search unavailable"
    : result.reason?.code === "stale" ? "Saved matches may be out of date"
    : result.reason?.code === "changed" ? "Saved matches need refreshing" : "Matching messages";
  const status = [primary, predicted ? reasonMessages.predicted : undefined,
    next ? "More results available" : result.status === "ready" && !hits.length ? "No matching messages" : undefined].filter(Boolean).join(" · ");
  return <>
    <p className="scope" data-state={page?.receipt?.state ?? result.status} data-status={result.status}
      data-receipt={page?.receipt?.state ?? "none"} data-reason={result.reason?.code}
      data-predicted={String(predicted)} data-next={next ? "available" : "none"}>{status}</p>
    <ul className="hits">
      {hits.map((row) => (
        <li key={row.id} data-message={row.id}>
          <button type="button" onClick={() => onOpen(row.conversationId)}>{row.body}</button>
        </li>
      ))}
    </ul>
    {next ? <button type="button" disabled={result.status === "loading"} onClick={result.loadMore}>Show more results</button> : null}
    {result.reason ? <details><summary>Search details</summary><pre>{JSON.stringify(result.reason, null, 2)}</pre></details> : null}
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
