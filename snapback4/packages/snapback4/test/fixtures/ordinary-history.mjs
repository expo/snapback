// Focused adaptation of the comparative Conversation's Bubble: the stored
// message owns the bubble; each decoration is an independent Read snapshot.
// @ref LLP 3000.021#3.1 — loading/refused decorations never replace history.
import { createElement as h } from "react";

const data = read => read && "data" in read ? read.data : undefined;
function decoration(name, read, render) {
  return h("aside", { "data-decoration": name }, read?.loading ? "Loading…"
    : read?.denied ? read.denied.message : render(data(read)));
}

export function History({ history, pending, conversation, decorations = {} }) {
  return h("section", null,
    ...(data(history) ?? []).map(item => {
      const extra = decorations[item.id] ?? {};
      return h("article", { key: item.id, id: `msg-${item.id}`, "data-sender": item.sender },
        h("p", null, item.tombstone ? "This message was deleted" : item.kind === "text" ? item.text : item.caption),
        h("time", null, item.at),
        item.editedAt ? h("span", null, "edited") : null,
        item.photoOnce ? h("button", { "data-asset": item.photoOnce.id }, "View once") : null,
        item.quote ? h("a", { href: `#msg-${item.quote}` }, "Quoted message") : null,
        decoration("profile", extra.profile, row => row?.displayName),
        decoration("quote", extra.quote, row => row?.text ?? row?.caption),
        decoration("receipt", extra.receipt, rows => rows?.find(row => row.id === item.id)?.receipt),
        decoration("reaction", extra.reaction, row => row?.emoji));
    }),
    ...pending.filter(write => write.op === "sendText" && write.args.conversation === conversation)
      .filter(write => !(data(history) ?? []).some(row => row.id === write.args.id))
      .map(write => h("article", { key: write.id, "data-pending": write.id }, h("p", null, write.args.text), h("span", null, "queued"))));
}
