import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  isSnapbackRefusal,
  type ConnectionState,
  type MutationResult,
  type OutboxStatus,
  type SnapbackClient,
} from "snapback2/client";
import { sendingStatus, type SendUncertainty } from "./offline.js";
import { useAccountRecoveryCustody, type RecoveryCustody } from "./recovery";

type SendArgs = { conversationId: string; body: string };
type PostMutation = {
  run(args: SendArgs): Promise<MutationResult<unknown>>;
  readonly ready: boolean;
  readonly inFlight: boolean;
  readonly pending: readonly unknown[];
  readonly status: OutboxStatus;
};

export function useSendController({
  conversationId,
  client,
  generation,
  connection,
  post,
  custody: ownedCustody,
  onNote,
}: {
  conversationId: string;
  client: SnapbackClient;
  generation: number;
  connection: ConnectionState;
  post: PostMutation;
  custody?: RecoveryCustody<SendUncertainty>;
  onNote(note: string): void;
}) {
  const localCustody = useAccountRecoveryCustody<SendUncertainty>(client, generation);
  const custody = ownedCustody ?? localCustody;
  const [body, setBody] = useState("");
  const [syncing, setSyncing] = useState(false);
  const visit = useMemo(() => ({ client, generation, conversationId }), [client, generation, conversationId]);
  const activeVisit = useRef(visit);
  activeVisit.current = visit;
  const mounted = useRef(false);
  const note = useRef(onNote);
  note.current = onNote;
  const syncToken = useRef<object | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const pending = custody.unknown;
    if (pending?.conversationId === conversationId) {
      setBody((current) => current === "" ? pending.draft : current);
    }
  }, [conversationId, custody.unknown]);
  useEffect(() => {
    const active = custody.active;
    if (active && active.conversationId !== conversationId && active.draft !== undefined) {
      setBody((current) => current === active.draft ? "" : current);
    }
  }, [conversationId, custody.active]);
  const current = (captured: typeof visit) => mounted.current && activeVisit.current === captured
    && captured.client.snapshot.authGeneration === captured.generation;
  const sameAccount = (captured: typeof visit) => captured.client.snapshot.authGeneration === captured.generation;
  const uncertainty = custody.unknown;
  const busy = custody.active !== undefined;
  const status = sendingStatus(post.status, connection, post.pending.length);

  const sync = async () => {
    if (syncToken.current) return;
    const captured = visit;
    const token = {};
    syncToken.current = token;
    setSyncing(true);
    try {
      await client.online();
      const result = await client.outbox.settled();
      if (current(captured)) note.current(result.stopped ? `${result.remaining} queued; sync paused. Your messages are saved.` : "");
    } catch (error) {
      if (current(captured)) note.current(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));
    } finally {
      if (syncToken.current === token) syncToken.current = undefined;
      if (mounted.current) setSyncing(false);
    }
  };

  const send = async () => {
    const text = body.trim();
    if (!text || !post.ready || post.inFlight || busy || uncertainty) return;
    const captured = visit;
    const draft = body;
    const args = { conversationId, body: text };
    const token = custody.begin({ conversationId, draft });
    if (!token) return;
    try {
      const result = await post.run(args);
      if (result.state === "admission-unknown") {
        const pending = { conversationId, args, draft, recovery: result.recovery };
        if (sameAccount(captured) && custody.hold(token, pending) && current(captured)) {
          note.current("Send confirmation was lost. Check this send before sending another message.");
        }
        return;
      }
      custody.finish(token);
      if (!current(captured)) return;
      if (result.state !== "rejected") setBody((currentBody) => currentBody === draft ? "" : currentBody);
      if (result.state === "queued") note.current(post.status.fence === "past" ? "Queued until the next sync." : "Queued; use Sync now to retry delivery.");
      else if (result.state === "rejected") note.current(`Not sent: ${result.rewrite ?? result.message}`);
      else note.current("");
    } catch (error) {
      custody.finish(token);
      if (current(captured)) note.current(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));
    }
  };

  const recover = async () => {
    const pending = custody.unknown;
    if (!pending || pending.conversationId !== conversationId) return;
    const captured = visit;
    const token = custody.beginRecovery(pending, { conversationId: pending.conversationId, draft: pending.draft });
    if (!token) return;
    try {
      const result = await client.recoverMutation(api.deliveries.post, pending.args, pending.recovery);
      if (!sameAccount(captured)) return;
      if (result.state === "admission-unknown") {
        const next = { ...pending, recovery: result.recovery };
        if (custody.hold(token, next) && current(captured)) {
          note.current("Send confirmation is still unknown. Check this same send again when the sending tab responds.");
        }
      } else if (custody.resolve(token, pending) && current(captured)) {
        setBody((currentBody) => currentBody === pending.draft ? "" : currentBody);
        note.current(`Send in ${pending.conversationId} is queued; it sends when the connection returns.`);
      }
    } catch (error) {
      custody.finish(token);
      if (current(captured)) note.current(isSnapbackRefusal(error) ? error.envelope.rewrite ?? error.message : String(error));
    }
  };

  return {
    body,
    setBody,
    busy,
    syncing,
    uncertainty,
    canRecover: uncertainty?.conversationId === conversationId,
    status,
    send,
    recover,
    sync,
  };
}
