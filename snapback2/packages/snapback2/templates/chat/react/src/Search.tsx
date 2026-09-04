import { useMemo, useState } from "react";
import { searchHeld, type LogRow } from "../shared/log.js";

// @ref LLP 1012#6-reads-offline — a search op has no held answer for a new
// term, so the recipe filters the downloaded log and says so.
export function Search({ rows, onOpen }: { rows: readonly LogRow[]; onOpen(conversationId: string): void }) {
  const [term, setTerm] = useState("");
  const hits = useMemo(() => searchHeld(rows, term), [rows, term]);
  return (
    <section aria-label="Search">
      <input aria-label="Search downloaded messages" value={term} placeholder="Search" onChange={(event) => setTerm(event.target.value)} />
      {term.trim() ? (
        <>
          <p className="scope">in downloaded messages</p>
          <ul className="hits">
            {hits.map((row) => (
              <li key={row.messageId} data-message={row.messageId}>
                <button type="button" onClick={() => onOpen(row.conversationId)}>{row.message?.body}</button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
