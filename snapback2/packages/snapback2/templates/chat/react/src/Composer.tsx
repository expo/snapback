import { sendAdvice, recoveryAdvice, refusalDetails } from "../shared/status";
import type { Refusal } from "snapback2/client";
import { messageWrites } from "../shared/thread";
import { useState, type FormEvent } from "react";
import { useAuth, useMutation, useOutbox } from "snapback2/react";

export function Composer({ conversationId }: { conversationId: string }) {
  const { session: auth } = useAuth();
  const account = auth.state === "anonymous" ? null : auth.viewer ?? auth.restoringViewer;
  const [scope, setScope] = useState({ account, key: 0 });
  // First confirmation adopts the cold draft; logout and account switches reset it.
  if (account !== undefined && account !== scope.account) {
    setScope({ account, key: scope.key + (scope.account === undefined && account !== null ? 0 : 1) });
  }
  return <Draft key={JSON.stringify([scope.key, conversationId])} conversationId={conversationId} />;
}
function Draft({ conversationId }: { conversationId: string }) {
  const post = useMutation(messageWrites.create);
  const outbox = useOutbox();
  const [body, setBody] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [syncRefusal, setSyncRefusal] = useState<Refusal>();
  const queued = post.last?.state === "queued" && outbox.detail.status.reason !== "forwarding"
    && post.work?.entry.state === "queued";
  const note = post.last?.state === "rejected" ? `Not sent: ${sendAdvice(post.last)}`
    : queued ? post.can.reason?.code === "fence" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery." : "";
  const send = async () => {
    const text = body.trim(), draft = body;
    if (!text || !post.can.send || post.inFlight) return;
    setSyncNote(""); setSyncRefusal(undefined);
    const result = await post.run({ conversationId, body: text });
    if (result.state !== "rejected") setBody(now => now === draft ? "" : now);
  };
  const sync = async () => {
    setSyncing(true); setSyncRefusal(undefined);
    const result = await outbox.recover();
    setSyncRefusal(result.refusal);
    setSyncNote(result.refusal ? recoveryAdvice(result.refusal)
      : result.settlement.stopped ? `${result.settlement.remaining} queued; sync paused. Your messages are saved.` : "");
    setSyncing(false);
  };
  const failure = syncRefusal ?? (post.last?.state === "rejected" ? post.last : undefined);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void send(); };
  return <form aria-label="Composer" onSubmit={submit}>
    <input aria-label="Message" value={body} placeholder="Message" onChange={(event) => setBody(event.target.value)} />
    <button type="submit" disabled={post.inFlight || !post.can.send}>Send</button>
    {post.can.reason ? <small role="status" data-waiting={post.can.reason.code}>{post.can.reason.message}</small> : null}
    {syncing || post.can.action === "connect" ? <button type="button" disabled={syncing}
      onClick={() => { void sync(); }}>{syncing ? "Syncing…" : "Sync now"}</button> : null}
    {note ? <p role="alert">{note}</p> : null}
    {syncNote ? <p role="alert">{syncNote}</p> : null}
    {failure ? <details><summary>Details</summary><pre>{refusalDetails(failure)}</pre></details> : null}
  </form>;
}
