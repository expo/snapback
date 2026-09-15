import { PollDisplay } from "@snapback-bench/social-ui";
import React, { useEffect, useRef, useState } from "react";
import { mintId } from "snapback4/client";
import { useClient, useViewer } from "snapback4/react";
import { api } from "./api.generated";

type OptionView = { id: string; label: string; count: number; mine?: boolean; pending?: boolean };

function sameOptions(a: OptionView[], b: OptionView[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, i) => {
    const other = b[i];
    return (
      row.id === other.id &&
      row.label === other.label &&
      row.count === other.count &&
      row.mine === other.mine &&
      row.pending === other.pending
    );
  });
}

export function PollMessage({
  messageId,
  question,
  accentColor,
}: {
  messageId: string;
  question: string;
  accentColor?: string;
}): React.JSX.Element {
  const client = useClient();
  const viewer = useViewer();
  const [options, setOptions] = useState<OptionView[]>([]);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = pendingOptionId;

  useEffect(() => {
    let on = true;
    const tick = async () => {
      if (pendingRef.current) return;
      try {
        const [optsRead, votesRead] = await Promise.all([
          client.query(api.pollOptionsOf, { messageId }),
          client.query(api.pollVotesOf, { messageId }),
        ]);
        if (!on) return;
        if ("denied" in optsRead || "loading" in optsRead) return;
        const votes =
          !("denied" in votesRead) && !("loading" in votesRead) ? votesRead.data ?? [] : [];
        const opts = [...(optsRead.data ?? [])].sort((a, b) => a.position - b.position);
        if (opts.length === 0) return;
        const mine = votes.find((v: { principal: string }) => v.principal === viewer);
        const next: OptionView[] = opts.map((o) => ({
          id: o.id,
          label: o.label,
          count: typeof o.tally === "number" ? o.tally : 0,
          mine: pendingRef.current ? o.id === pendingRef.current : mine?.optionId === o.id,
          pending: pendingRef.current === o.id,
        }));
        setOptions((prev) => (sameOptions(prev, next) ? prev : next));
      } catch {
        /* offline or in-flight — keep last options so the vote target stays mounted */
      }
    };
    void tick();
    const id = setInterval(tick, 400);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [client, messageId, viewer]);

  return (
    <PollDisplay
      question={question}
      options={options}
      accentColor={accentColor}
      onVote={(index) => {
        const option = options[index];
        if (!option) return;
        pendingRef.current = option.id;
        setPendingOptionId(option.id);
        setOptions((prev) =>
          prev.map((row) => ({
            ...row,
            mine: row.id === option.id,
            pending: row.id === option.id,
          })),
        );
        const mutationId = mintId();
        void client
          .mutate(api.setPollVote, {
            messageId,
            optionId: option.id,
            mutationId,
          })
          .then((write) => {
            if (write.state !== "pending") {
              pendingRef.current = null;
              setPendingOptionId(null);
              return;
            }
            const off = client.onWrite((next) => {
              if (next.id !== write.id || next.state === "pending") return;
              pendingRef.current = null;
              setPendingOptionId(null);
              off();
            });
          })
          .catch(() => {
            /* keep pending until reconnect flushes the queued write */
          });
      }}
    />
  );
}
