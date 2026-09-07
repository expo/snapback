import type { FormEvent } from "react";
import { api } from "snapback2/client";
import { useConnection, useMutation, useSnapbackClient, useSnapbackSnapshot } from "snapback2/react";
import type { SendUncertainty } from "../shared/offline.js";
import type { RecoveryCustody } from "../shared/recovery";
import { useSendController } from "../shared/send";

// @ref LLP 1012#7-writes-offline — `run()` resolves `queued` when the owner is
// unavailable, so the authored draft clears only after durable admission.
// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the
// account owner retains the exact unresolved command across route remounts.
export function Composer({ conversationId, onNote, custody }: {
  conversationId: string;
  onNote(note: string): void;
  custody?: RecoveryCustody<SendUncertainty>;
}) {
  const post = useMutation(api.deliveries.post);
  const client = useSnapbackClient();
  const generation = useSnapbackSnapshot().authGeneration;
  const controller = useSendController({
    conversationId,
    client,
    generation,
    connection: useConnection(),
    post,
    custody,
    onNote,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void controller.send();
  };
  return (
    <form aria-label="Composer" onSubmit={submit}>
      <input aria-label="Message" value={controller.body} placeholder="Message"
        onChange={(event) => controller.setBody(event.target.value)} />
      <button type="submit" disabled={controller.busy || post.inFlight || !post.ready || controller.uncertainty !== undefined}>Send</button>
      {controller.uncertainty ? <>
        <small role="alert" data-send-unknown={controller.uncertainty.conversationId}>
          {controller.canRecover
            ? `Confirmation is unknown for “${controller.uncertainty.draft}” in ${controller.uncertainty.conversationId}.`
            : `Confirmation is unknown in ${controller.uncertainty.conversationId}. Return there to check the same send.`}
        </small>
        {controller.canRecover ? <button type="button" disabled={controller.busy}
          onClick={() => { void controller.recover(); }}>{controller.busy ? "Checking…" : "Check send"}</button> : null}
      </> : null}
      {controller.status ? <small role="status" data-waiting={controller.status.reason}>{controller.status.message}</small> : null}
      {controller.status?.canSync ? <button type="button" disabled={controller.syncing}
        onClick={() => { void controller.sync(); }}>{controller.syncing ? "Syncing…" : "Sync now"}</button> : null}
    </form>
  );
}
