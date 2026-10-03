import { useEffect, useMemo } from "react";
import { useAcquired, useClient, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../snapback/generated/api";

type Viewed = { through: number; sent: number };
const views = new WeakMap<object, Map<string, Viewed>>();

function viewOf(client: object, viewer: string | null, conversation: string): Viewed {
  const scopes = views.get(client) ?? new Map<string, Viewed>();
  views.set(client, scopes);
  const key = JSON.stringify([viewer, conversation]);
  const viewed = scopes.get(key) ?? { through: 0, sent: 0 };
  scopes.set(key, viewed);
  return viewed;
}

export function useReceipts(conversation: string, visible: boolean) {
  const client = useClient();
  const viewer = useViewer();
  const acquired = useAcquired();
  const page = usePage(api.history, { conversation });
  const membership = useQuery(api.receiptMember, { conversation });
  const member = "data" in membership ? membership.data : null;
  const viewed = useMemo(() => viewOf(client, viewer, conversation), [client, viewer, conversation]);
  const settled = page.items.filter((m) => !m.pending).map((m) => m.ordinal);
  const newest = settled.length ? Math.max(...settled) : 0;
  const shown = member && !member.pending ? Math.max(member.seenOrdinal, member.joinedOrdinal) : null;
  useEffect(() => {
    if (!acquired) return;
    if (visible && newest > viewed.through) viewed.through = newest;
    const through = viewed.through;
    if (through === 0 || (shown !== null && through <= shown) || viewed.sent === through) return;
    viewed.sent = through;
    void client.mutate(api.seen, { conversation, through }).then((write) => {
      if (write.state === "failed" && write.why.code === "E_ADMISSION" && viewed.sent === through) {
        viewed.sent = 0;
      }
    });
  }, [acquired, client, conversation, viewed, visible, shown, newest, membership]);
  return page;
}
