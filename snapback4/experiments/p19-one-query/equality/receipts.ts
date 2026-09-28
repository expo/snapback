// Adapted from published snapback4 0.4.6 guide receipts.
import { useEffect, useMemo, useState } from "react";
import { useClient, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";
// Runs and ordinals, merged into disjoint unbroken runs, lowest first.
function runsOf(runs: [number, number][], ordinals: number[]) {
  const all = [...runs, ...ordinals.map((n): [number, number] => [n, n])].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, through] of all) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], through); else merged.push([from, through]);
  }
  return merged;
}
// What the hook owes, for the life of the signed-in client, per viewer and conversation:
// a remount keeps it, and a replaced client or another viewer starts afresh.
type Debt = { owed: Map<string, { run: [number, number]; tried: string | null }>; viewed: { through: number; sent: number } };
const debts = new WeakMap<object, Map<string, Debt>>();
function debtOf(client: object, viewer: string | null, conversation: string): Debt {
  const scopes = debts.get(client) ?? new Map<string, Debt>();
  debts.set(client, scopes);
  const scope = JSON.stringify([viewer, conversation]);
  const debt = scopes.get(scope) ?? { owed: new Map(), viewed: { through: 0, sent: 0 } };
  scopes.set(scope, debt);
  return debt;
}
export function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const viewer = useViewer();
  const progress = useQuery(api.progress, { conversation });
  const [archived, setArchived] = useState(false);
  useEffect(() => { if ('denied' in progress && progress.denied.code === 'NOT_MEMBER') setArchived(true); else if ('data' in progress) setArchived(false); }, [progress]);
  const page = usePage(api.history, { conversation }, { keep: true });
  const mine = "data" in progress ? progress.data : null;
  const member = mine ? mine.member : null;
  // What it holds (the pages walked, the page ahead) it owes until the server's own rows
  // cover it, remembered even before progress loads; a view is owed the same way.
  const { owed, viewed } = useMemo(() => debtOf(client, viewer, conversation), [client, viewer, conversation]);
  const held = [...page.items, ...(mine ? mine.ahead : [])].filter(m => !m.pending).map(m => m.ordinal);
  const prefix = member && !member.pending ? Math.max(member.deliveredOrdinal, member.joinedOrdinal) : null;
  const stored = mine ? mine.runs.filter(r => !r.pending).map((r): [number, number] => [r.fromOrdinal, r.throughOrdinal]) : [];
  const coverage = mine && JSON.stringify([prefix, stored]);
  const holding = JSON.stringify(runsOf([], held));
  useEffect(() => {
    const entries = new Map(owed);
    owed.clear();
    for (const run of runsOf([...entries.values()].map(entry => entry.run), held)) owed.set(run.join("-"), entries.get(run.join("-")) ?? { run, tried: null });
    if (coverage === null) return;
    // Send a run when it is new, and again only when the server's coverage has moved.
    for (const [name, entry] of owed) {
      const from = prefix === null ? entry.run[0] : Math.max(entry.run[0], prefix + 1), through = entry.run[1];
      if (from > through || stored.some(([low, high]) => low <= from && through <= high)) { owed.delete(name); continue; }
      if (entry.tried === coverage) continue;
      entry.tried = coverage;
      void client.mutate(api.delivered, { conversation, from, through }).then(write => {
        // Nothing was kept (storage unavailable): owe it again, and send it with the next answer.
        if (write.state === "failed" && write.why.code === "E_ADMISSION" && entry.tried === coverage) entry.tried = null;
      });
    }
  }, [client, conversation, owed, holding, coverage, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  // Walk older pages while the lowest run held lies above the prefix.
  const floor = member ? Math.max(member.deliveredOrdinal, member.joinedOrdinal) : null;
  const lowest = runsOf([], held)[0];
  const short = floor !== null && lowest !== undefined && lowest[0] > floor + 1;
  useEffect(() => { if (short && page.hasMore) page.loadMore(); }, [short, page.hasMore, page.items.length, page.loadMore]);
  const settled = page.items.filter(m => !m.pending).map(m => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : 0;
  const shown = member ? Math.max(member.seenOrdinal, member.joinedOrdinal) : null;
  useEffect(() => {
    // A view needs no watermark first: seen only moves forward.
    if (visible && newest > viewed.through) viewed.through = newest;
    // Sent once; one the client could not keep goes again when the hook next runs.
    const through = viewed.through;
    if (shown === null) return; // Wait for the current watermark before issuing a potentially redundant write.
    if (through === 0 || (shown !== null && through <= shown) || viewed.sent === through) return;
    viewed.sent = through;
    void client.mutate(api.seen, { conversation, through }).then(write => {
      if (write.state === "failed" && write.why.code === "E_ADMISSION" && viewed.sent === through) viewed.sent = 0;
    });
  }, [client, conversation, viewed, visible, shown, newest, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...page, archived };
}
