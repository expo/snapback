import React, { useEffect, useState } from "react";
import { useClient, useQuery } from "snapback4/react";
import { PollDisplay } from "../../ui-kit/src/PollDisplay";
import { api } from "../../snapback/generated/api";
import { readData } from "../../lib/helpers";

/**
 * A poll message body (M7): live tallies from pollState, one changeable
 * vote per user as an idempotent set-state intent, offline queueing with
 * a pending marker until the write settles.
 */
export function PollBlock({
  pollId,
  fallbackQuestion,
  accentColor,
  onError,
}: {
  pollId: string;
  fallbackQuestion?: string | null;
  accentColor?: string;
  onError: (msg: string) => void;
}) {
  const client: any = useClient();
  const stateRead = useQuery(api.pollState, { pollId });
  const state = readData<any>(stateRead);
  // Optimistic selection for instant feedback; the server row wins as soon
  // as pollState carries it.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  // Offline/queued vote intent waiting to settle ({ optionId, writeId }).
  const [pending, setPending] = useState<{ optionId: string; writeId: string } | null>(null);

  // A queued vote settles after reconnect: onWrite reports its terminal
  // outcome once. Clear only the matching intent; a newer tap supersedes.
  useEffect(() => {
    try {
      return client.onWrite((w: any) => {
        if (!w || w.id == null) return;
        setPending((prev) => {
          if (prev && prev.writeId === w.id) {
            if (w.state === "failed") {
              setOptimistic(null);
              onError(`Vote failed: ${w.why?.code ?? "unknown"}`);
            }
            return null;
          }
          return prev;
        });
      });
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pollId]);

  // Server confirmation absorbs the optimistic pick.
  useEffect(() => {
    if (state && optimistic && state.myOption === optimistic) setOptimistic(null);
  }, [state, optimistic]);

  const options = (state?.options ?? []).map((o: any) => ({
    id: o.id,
    label: o.label,
    count: o.tally,
    mine: (optimistic ?? state?.myOption ?? "") === o.id,
    pending: pending?.optionId === o.id,
  }));

  const vote = async (index: number) => {
    const target = (state?.options ?? [])[index];
    if (!target) return;
    setOptimistic(target.id);
    try {
      const w = await client.mutate(api.pollVote, { pollId, optionId: target.id });
      if (w.state === "pending") {
        setPending({ optionId: target.id, writeId: w.id });
      } else if (w.state === "sent") {
        setPending(null);
      } else {
        setPending(null);
        setOptimistic(null);
        onError(`Vote failed: ${w.why?.code ?? "unknown"}`);
      }
    } catch (err: any) {
      setPending(null);
      setOptimistic(null);
      onError(`Vote failed: ${err?.message ?? err}`);
    }
  };

  return (
    <PollDisplay
      question={state?.question ?? fallbackQuestion ?? ""}
      options={options}
      onVote={vote}
      accentColor={accentColor}
    />
  );
}
