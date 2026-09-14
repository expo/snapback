import { useEffect, useRef } from "react";

export type WebPollOption = {
  id: string;
  label: string;
  count: number;
  mine: boolean;
  pending: boolean;
};

export type WebPoll = {
  messageId: string;
  question: string;
  options: WebPollOption[];
  total: number;
};

type Item = {
  id: string;
  body: string | null;
  caption: string | null;
  authorId: string;
  tombstoned: boolean;
  quote?: { senderName: string; excerpt: string } | null;
  quoteId?: string | null;
  poll?: WebPoll | null;
};

export function WebConvoSurface({
  conversationId,
  items,
  principal,
  typingNames,
  receiptOf,
  onSend,
  onTyping,
  onQuote,
  onVote,
  onTogglePoll,
  showPollCompose,
  isGroup,
}: {
  conversationId: string;
  items: Item[];
  principal?: string;
  typingNames: string[];
  receiptOf: (id: string) => "sent" | "delivered" | "read" | "pending";
  onSend: (text: string) => void;
  onTyping: (text: string) => void;
  onQuote: (id: string) => void;
  onVote?: (messageId: string, optionId: string) => void;
  onTogglePoll?: () => void;
  showPollCompose?: boolean;
  isGroup?: boolean;
}): null {
  const sendRef = useRef(onSend);
  const typingRef = useRef(onTyping);
  const quoteRef = useRef(onQuote);
  const receiptRef = useRef(receiptOf);
  const voteRef = useRef(onVote);
  const pollRef = useRef(onTogglePoll);
  sendRef.current = onSend;
  typingRef.current = onTyping;
  quoteRef.current = onQuote;
  receiptRef.current = receiptOf;
  voteRef.current = onVote;
  pollRef.current = onTogglePoll;

  useEffect(() => {
    if (typeof document === "undefined") return;
    let host = document.getElementById("clique-web-convo");
    if (!host) {
      host = document.createElement("div");
      host.id = "clique-web-convo";
      document.body.appendChild(host);
    }
    Object.assign(host.style, {
      position: "fixed",
      top: "64px",
      left: "0",
      right: "0",
      bottom: "0",
      overflow: "auto",
      background: "#fff",
      zIndex: "9999",
    });
    if (!document.getElementById("clique-web-bubbles")) {
      host.innerHTML = `<div id="clique-web-bubbles"></div>
        <div id="clique-web-typing"></div>
        <div style="display:flex;gap:8px;padding:8px">
          <textarea data-testid="sm-convo-input" style="flex:1;min-height:40px"></textarea>
          <button type="button" data-testid="sm-convo-send">↑</button>
          <button type="button" data-testid="sm-convo-attach">＋</button>
          <button type="button" data-testid="sm-poll-toggle">Poll</button>
        </div>`;
      const input = host.querySelector('[data-testid="sm-convo-input"]') as HTMLTextAreaElement;
      const send = host.querySelector('[data-testid="sm-convo-send"]') as HTMLButtonElement;
      input.addEventListener("input", () => typingRef.current(input.value));
      send.addEventListener("click", () => {
        const text = input.value;
        if (text.trim()) sendRef.current(text);
        input.value = "";
      });
      const pollBtn = host.querySelector('[data-testid="sm-poll-toggle"]') as HTMLButtonElement;
      pollBtn.addEventListener("click", () => pollRef.current?.());
    }
    const pollBtn = document.querySelector('[data-testid="sm-poll-toggle"]') as HTMLButtonElement | null;
    if (pollBtn) pollBtn.style.display = isGroup ? "" : "none";
    host.setAttribute("data-conversation", conversationId);
    host.setAttribute("data-poll-compose", showPollCompose ? "open" : "closed");
  }, [conversationId, isGroup, showPollCompose]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const box = document.getElementById("clique-web-bubbles");
    if (!box) return;
    box.innerHTML = items
      .map((msg) => {
        const mine = msg.authorId === principal;
        const text = msg.tombstoned ? "This message was deleted" : msg.body || msg.caption || "";
        const receipt = mine ? receiptRef.current(msg.id) : "";
        const quote = msg.quote
          ? `<button type="button" data-testid="sm-convo-quote-preview">${escapeHtml(msg.quote.senderName)}: ${escapeHtml(msg.quote.excerpt)}</button>`
          : "";
        return `<article data-testid="sm-convo-bubble" id="${escapeAttr(msg.id)}" style="display:block;padding:8px;margin:8px 0;background:#eef">
          ${quote}
          ${msg.tombstoned ? `<span data-testid="sm-convo-tombstone">${escapeHtml(text)}</span>` : `<div>${escapeHtml(msg.poll ? msg.poll.question : text)}</div>`}
          ${pollHtml(msg.poll)}
          ${mine ? `<span data-testid="sm-convo-receipt" data-value="${receipt}" data-state="${receipt}" aria-valuetext="${receipt}">${receipt}</span>` : ""}
          <button type="button" data-testid="sm-convo-quote" data-qid="${escapeAttr(msg.id)}">Reply</button>
        </article>`;
      })
      .join("");
    box.querySelectorAll('[data-testid="sm-convo-quote"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).getAttribute("data-qid");
        if (id) quoteRef.current(id);
      });
    });
    box.querySelectorAll('[data-testid="sm-poll-option"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLElement;
        const mid = el.getAttribute("data-mid");
        const oid = el.getAttribute("data-oid") ?? el.getAttribute("aria-valuetext");
        if (mid && oid) voteRef.current?.(mid, oid);
      });
    });
  }, [
    items
      .map((i) => {
        const poll = i.poll
          ? `${i.poll.question}:${i.poll.options.map((o) => `${o.id}:${o.count}:${o.mine}:${o.pending}`).join(",")}`
          : "";
        return `${i.id}:${i.body}:${i.tombstoned}:${poll}`;
      })
      .join("|"),
    principal,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("clique-web-typing");
    if (!el) return;
    el.innerHTML = typingNames.length
      ? `<div data-testid="sm-convo-typing">${escapeHtml(typingNames.join(", "))} typing</div>`
      : "";
  }, [typingNames.join(",")]);

  return null;
}

function pollHtml(poll: WebPoll | null | undefined): string {
  if (!poll) return "";
  const options = poll.options
    .map((opt) => {
      const selected = opt.mine ? "true" : "false";
      const pending = opt.pending ? "true" : "false";
      return `<button type="button" data-testid="sm-poll-option" data-mid="${escapeAttr(poll.messageId)}" data-oid="${escapeAttr(opt.id)}" aria-valuetext="${escapeAttr(opt.id)}" aria-selected="${selected}" aria-pressed="${selected}" data-selected="${selected}" aria-busy="${pending}" data-pending="${pending}" style="display:flex;justify-content:space-between;width:100%;margin:4px 0;padding:8px;border:1px solid ${opt.mine ? "#4f46e5" : "#d4d4d8"};background:#fff">
        <span>${escapeHtml(opt.label)}</span>
        <span data-testid="sm-poll-tally" aria-valuetext="${String(opt.count)}">${opt.count}</span>
      </button>`;
    })
    .join("");
  return `<div data-testid="sm-poll" style="margin-top:8px">
    ${options}
    <div data-testid="sm-poll-total" aria-valuetext="${String(poll.total)}">${poll.total} ${poll.total === 1 ? "vote" : "votes"}</div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
