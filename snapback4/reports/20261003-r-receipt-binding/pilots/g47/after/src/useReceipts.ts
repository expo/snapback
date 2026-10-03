import { usePage, useSeen } from "snapback4/react";
import { api } from "../snapback/generated/api";

export function useReceipts(conversation: string, active: boolean, visibleIds: ReadonlySet<string>) {
  const page = usePage(api.history, { conversation });
  const through = Math.max(0, ...page.items.filter(m => visibleIds.has(m.id) && !m.pending).map(m => m.ordinal));
  useSeen(api.receiptFamilies.chat, { scope: conversation, through, active });
  return page;
}
