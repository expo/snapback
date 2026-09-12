import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  api,
  type OperationSnapshot,
  type ResultOf,
  type SnapbackClient,
} from "snapback3/client";
import { useClientState, useQuery } from "snapback3/react";
import type { Cursor } from "snapback3";
import { BrandMark, Icon } from "./icons";
import { EMPTY_DRAFT, useDrafts, type Draft } from "./drafts";

type Conversation = NonNullable<
  ResultOf<typeof api.conversations.list>[number]["conversation"]
>;
type Message = ResultOf<typeof api.messages.page>[number];
const people = { alice: "Alice Kim", bob: "Bob Chen", erin: "Erin Walsh" };
const initials = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const displayPerson = (value: string) =>
  people[value.replace(/^dev:/, "") as keyof typeof people] ??
  value.replace(/^dev:/, "");
const time = (value: number) =>
  new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

export function App({ client }: { client: SnapbackClient }) {
  const connection = useClientState();
  const [starting, setStarting] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void client.ready
      .then(async () => {
        if (!client.getSnapshot().principal) await client.auth.persona("alice");
        if (active) setStarting(false);
      })
      .catch((reason) => {
        if (active) {
          setError(reason.message);
          setStarting(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client]);
  async function switchPersona(name: string) {
    setSwitching(true);
    setError("");
    try {
      await client.auth.persona(name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitching(false);
    }
  }
  if (starting || !connection.principal)
    return (
      <div className="welcome">
        <div className="brand-mark large">
          <BrandMark />
        </div>
        <p className="eyebrow">A LITTLE SPACE, TOGETHER</p>
        <h1>Welcome to Commonroom.</h1>
        <p>{error || "Finding your conversations…"}</p>
        {error && (
          <button
            className="primary-button"
            onClick={() => void switchPersona("alice")}
          >
            Try again
          </button>
        )}
      </div>
    );
  return (
    <div className="application">
      <Workspace
        key={connection.principal.id}
        client={client}
        switchPersona={switchPersona}
      />
      {error && (
        <div className="global-error" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {switching && (
        <div className="switching" role="status">
          <span className="spinner" /> Opening your conversations…
        </div>
      )}
    </div>
  );
}

function Workspace({
  client,
  switchPersona,
}: {
  client: SnapbackClient;
  switchPersona(name: string): Promise<void>;
}) {
  const connection = useClientState();
  const [listCursor, setListCursor] = useState<Cursor | null>(null);
  const list = useQuery(api.conversations.list, { c: listCursor });
  const conversations = useMemo(
    () =>
      (list.data ?? [])
        .flatMap((item) => (item.conversation ? [item.conversation] : []))
        .sort(
          (a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title),
        ),
    [list.data],
  );
  const [selectedId, setSelectedId] = useState("studio");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showDetails, setShowDetails] = useState(
    () => window.innerWidth >= 1180,
  );
  const selected =
    conversations.find((room) => room.id === selectedId) ?? conversations[0];
  const principal = connection.principal!;
  const draftShelf = useDrafts(principal.id);
  const persona = principal.id.replace(/^dev:/, "");
  const online = connection.status === "online";
  const pending = connection.pending.filter((operation) =>
    ["persisting", "queued", "sending", "observing"].includes(operation.status),
  );
  const visible = conversations.filter((room) =>
    `${room.title} ${room.topic}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <main
      className={`workspace ${showSidebar ? "sidebar-open" : ""} ${showDetails ? "details-open" : ""}`}
    >
      {showSidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close conversations"
          onClick={() => setShowSidebar(false)}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div>
            Commonroom<span>A place for good company</span>
          </div>
          <button
            className="icon-button close-sidebar"
            aria-label="Close conversations"
            onClick={() => setShowSidebar(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="workspace-card">
          <span className="workspace-avatar">S</span>
          <div>
            <strong>The studio</strong>
            <span>Your shared corner of the world</span>
          </div>
          <span className="workspace-dot" />
        </div>
        <label className="search">
          <Icon name="search" size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find in your conversations"
            aria-label="Find in these conversations"
          />
          <kbd>⌕</kbd>
        </label>
        <div className="sidebar-section">
          <span>YOUR CONVERSATIONS</span>
          <span>
            {conversations.length}
            {list.next ? "+" : ""}
          </span>
        </div>
        <div className="filter-tabs" aria-label="Conversation filter">
          <button
            className={!unreadOnly ? "active" : ""}
            onClick={() => setUnreadOnly(false)}
          >
            All
          </button>
          <button
            className={unreadOnly ? "active" : ""}
            onClick={() => setUnreadOnly(true)}
          >
            Unread
          </button>
        </div>
        <nav className="conversation-list" aria-label="Conversations">
          {visible.map((room) => (
            <ConversationRow
              key={room.id}
              room={room}
              active={selected?.id === room.id}
              unreadOnly={unreadOnly}
              onSelect={() => {
                setSelectedId(room.id);
                setShowSidebar(false);
              }}
            />
          ))}
          {list.status === "loading" && !list.data && (
            <p className="list-note">Finding your conversations…</p>
          )}
          {list.error && (
            <p className="list-note" role="status">
              Conversations are unavailable.{" "}
              {online ? "Try reconnecting." : "Go online to load them."}
            </p>
          )}
          {list.complete && visible.length === 0 && (
            <p className="list-note">No conversations match “{search}”.</p>
          )}
        </nav>
        {(list.next || listCursor) && (
          <div className="list-pagination">
            {listCursor && (
              <button onClick={() => setListCursor(null)}>First page</button>
            )}
            {list.next && (
              <button onClick={() => setListCursor(list.next as Cursor)}>
                Next conversations <Icon name="chevron" size={13} />
              </button>
            )}
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="small-note">
            <span className="sun">✳</span>
            <p>
              Good things happen
              <br />
              in good company.
            </p>
          </div>
          <div className="persona">
            <Avatar name={displayPerson(principal.id)} size="small" />
            <div>
              <label htmlFor="persona">YOU’RE HERE AS</label>
              <select
                id="persona"
                value={persona}
                disabled={!online || Boolean(draftShelf.error)}
                title={
                  draftShelf.error
                    ? "Save your draft before switching people"
                    : !online
                      ? "Go online to switch people"
                      : "Try another person's conversations"
                }
                onChange={(event) => void switchPersona(event.target.value)}
              >
                {Object.entries(people).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
                {!(persona in people) && (
                  <option value={persona}>{displayPerson(principal.id)}</option>
                )}
              </select>
            </div>
            <Icon name="down" size={14} />
          </div>
        </div>
      </aside>
      {selected ? (
        <ChatRoom
          key={selected.id}
          room={selected}
          client={client}
          draft={
            Object.hasOwn(draftShelf.drafts, selected.id)
              ? draftShelf.drafts[selected.id]
              : EMPTY_DRAFT
          }
          setDraft={(draft) => draftShelf.update(selected.id, draft)}
          draftError={draftShelf.error}
          retryDraft={draftShelf.retry}
          openSidebar={() => setShowSidebar(true)}
          toggleDetails={() => setShowDetails((value) => !value)}
        />
      ) : (
        <section className="empty-conversation">
          <button
            className="icon-button mobile-menu"
            aria-label="Open conversations"
            onClick={() => setShowSidebar(true)}
          >
            <Icon name="menu" />
          </button>
          <BrandMark />
          <h2>
            {list.status === "loading"
              ? "Make yourself at home."
              : "A quiet corner, for now."}
          </h2>
          <p>
            {list.status === "loading"
              ? "Your conversations will be here in a moment."
              : "You’ll see conversations here when you’re a member."}
          </p>
        </section>
      )}
      {selected && showDetails && (
        <Details
          room={selected}
          online={online}
          pending={pending.length}
          connectionStatus={connection.status}
          toggleOnline={() => client.setOnline(!online)}
          close={() => setShowDetails(false)}
        />
      )}
    </main>
  );
}

function ConversationRow({
  room,
  active,
  unreadOnly,
  onSelect,
}: {
  room: Conversation;
  active: boolean;
  unreadOnly: boolean;
  onSelect(): void;
}) {
  const summary = useQuery(api.conversations.unread, {
    conversationId: room.id,
  });
  if (unreadOnly && summary.complete && summary.data?.unread === 0) return null;
  return (
    <button
      className={`conversation ${active ? "selected" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
    >
      <span className={`room-avatar ${room.color}`}>
        {room.kind === "group" ? "#" : initials(room.title.replace(" & ", " "))}
      </span>
      <span className="conversation-copy">
        <span className="conversation-title">{room.title}</span>
        <span className="conversation-preview">
          {room.kind === "direct"
            ? "A little more personal"
            : room.topic.split(".")[0]}
        </span>
      </span>
      {summary.complete && summary.data && summary.data.unread > 0 && (
        <span
          className="unread-badge"
          aria-label={`${summary.data.unread} unread messages${summary.fresh ? "" : " when last connected"}`}
        >
          {summary.data.unread > 99 ? "99+" : summary.data.unread}
        </span>
      )}
    </button>
  );
}

function ChatRoom({
  room,
  client,
  draft,
  setDraft,
  draftError,
  retryDraft,
  openSidebar,
  toggleDetails,
}: {
  room: Conversation;
  client: SnapbackClient;
  draft: Draft;
  setDraft(draft: Draft): boolean;
  draftError: string;
  retryDraft(): void;
  openSidebar(): void;
  toggleDetails(): void;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const page = useQuery(api.messages.page, {
    conversationId: room.id,
    c: cursor,
  });
  const summary = useQuery(api.conversations.unread, {
    conversationId: room.id,
  });
  const members = useQuery(api.conversations.members, {
    conversationId: room.id,
  });
  const connection = useClientState();
  const [persisting, setPersisting] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(
    document.visibilityState === "visible",
  );
  const [notice, setNotice] = useState<{
    text: string;
    recover?: Draft;
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const marked = useRef<string | null>(null);
  const followMessages = useRef(true);
  const messages = useMemo(() => [...(page.data ?? [])].reverse(), [page.data]);
  const newest = cursor === null ? messages.at(-1) : undefined;
  const online = connection.status === "online";
  const pending = connection.pending.filter(
    (operation) =>
      operation.op === "messages.send" &&
      operation.args.conversationId === room.id &&
      ["persisting", "queued", "sending", "observing"].includes(
        operation.status,
      ),
  );
  const needsAttention = connection.pending.filter(
    (operation) =>
      ["messages.send", "messages.edit"].includes(operation.op) &&
      operation.args.conversationId === room.id &&
      ["rejected", "conflict", "parked"].includes(operation.status),
  );
  useEffect(() => {
    const list = listRef.current;
    if (list && cursor === null && followMessages.current)
      list.scrollTop = list.scrollHeight;
  }, [newest?.id, pending.length, cursor]);
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (
      !newest ||
      !page.complete ||
      !online ||
      !atBottom ||
      !visible ||
      marked.current === newest.id
    )
      return;
    const id = newest.id;
    const timer = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      marked.current = id;
      const operation = client.mutate(api.conversations.markRead, {
        conversationId: room.id,
        through: id,
      });
      void operation.durable.catch(() => {
        marked.current = null;
      });
      void operation.settled.catch(() => {
        marked.current = null;
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [newest?.id, page.complete, online, atBottom, visible, room.id, client]);
  useEffect(() => {
    if (composer.current) {
      composer.current.style.height = "auto";
      composer.current.style.height = `${Math.min(composer.current.scrollHeight, 144)}px`;
    }
  }, [draft.body]);
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.body.trim();
    if (!body || persisting) return;
    followMessages.current = true;
    const submittedDraft = draft;
    const saved = { ...draft, body };
    setPersisting(true);
    setNotice(null);
    try {
      const operation = saved.edit
        ? client.mutate(api.messages.edit, {
            conversationId: room.id,
            messageId: saved.edit.id,
            baseBody: saved.edit.baseBody,
            body,
          })
        : client.mutate(api.messages.send, { conversationId: room.id, body });
      void operation.settled.catch((reason) =>
        setNotice({
          text: reason.message || "This message needs your attention.",
          recover: saved,
        }),
      );
      await operation.durable;
      if (currentDraft.current === submittedDraft) setDraft(EMPTY_DRAFT);
      if (saved.edit && !online)
        setNotice({
          text: "Your edit is saved on this device. It will send when you reconnect.",
        });
      setCursor(null);
    } catch (reason) {
      setNotice({
        text:
          reason instanceof Error
            ? reason.message
            : "Your message is still in the composer. Please try again.",
      });
    } finally {
      setPersisting(false);
      composer.current?.focus();
    }
  }
  function edit(message: Message) {
    if (draft.body || draft.edit) {
      setNotice({
        text: "Finish or clear your current draft before editing another message.",
      });
      composer.current?.focus();
      return;
    }
    setDraft({
      body: message.body,
      edit: { id: message.id, baseBody: message.body },
    });
    composer.current?.focus();
  }
  async function restore(operation: OperationSnapshot) {
    try {
      const recovered: Draft = { body: String(operation.args.body) };
      if (operation.op === "messages.edit") {
        const message = await client.query(api.messages.get, {
          conversationId: room.id,
          messageId: String(operation.args.messageId),
        });
        recovered.edit = { id: message.id, baseBody: message.body };
      }
      if (currentDraft.current.body || currentDraft.current.edit) {
        setNotice({
          text: "Finish or clear your current draft first. The saved operation is still available.",
        });
        return;
      }
      if (!setDraft(recovered)) return;
      await client.dismissOperation(operation.id);
    } catch (reason) {
      setNotice({
        text:
          reason instanceof Error
            ? reason.message
            : "The original saved operation is still available.",
      });
    }
    composer.current?.focus();
  }
  const countText =
    summary.complete && summary.data
      ? `${summary.fresh ? "" : "Last known: "}${summary.data.unread > 0 ? `${summary.data.unread} unread` : "All caught up"}`
      : "Unread count unavailable";
  return (
    <section className="chat">
      <header className="chat-header">
        <button
          className="icon-button mobile-menu"
          aria-label="Open conversations"
          onClick={openSidebar}
        >
          <Icon name="menu" />
        </button>
        <div className={`header-room-icon ${room.color}`}>
          {room.kind === "group" ? "#" : <Icon name="lock" size={21} />}
        </div>
        <div className="chat-heading">
          <div className="chat-title-line">
            <h1>{room.title}</h1>
            <span className="room-kind">
              {room.kind === "group" ? "GROUP" : "DIRECT"}
            </span>
          </div>
          <p>
            {members.data ? `${members.data.length} people · ` : ""}
            {room.kind === "group"
              ? "A good place to make things together"
              : "Just between you"}
          </p>
        </div>
        <div
          className={`connection-pill ${online ? "is-online" : "is-offline"}`}
        >
          <span />
          {online
            ? "Connected"
            : connection.status === "offline"
              ? "Offline"
              : "Connecting"}
        </div>
        <button
          className="icon-button info-toggle"
          aria-label="Conversation details"
          onClick={toggleDetails}
        >
          <Icon name="info" size={21} />
        </button>
      </header>
      <div className="conversation-strip">
        <span>
          <span className="tiny-spark">✳</span>{" "}
          {room.kind === "group"
            ? "A little room for your next good idea."
            : "Some conversations deserve their own room."}
        </span>
        <span
          className={`read-status ${summary.data?.unread ? "has-unread" : ""}`}
        >
          <Icon
            name={
              summary.complete && summary.data?.unread === 0 ? "check" : "clock"
            }
            size={13}
          />
          {countText}
        </span>
      </div>
      <div
        className="message-scroll"
        ref={listRef}
        aria-label="Messages"
        aria-live="polite"
        onScroll={(event) => {
          const list = event.currentTarget;
          const nearBottom =
            list.scrollHeight - list.scrollTop - list.clientHeight < 80;
          followMessages.current = nearBottom;
          setAtBottom(nearBottom);
        }}
      >
        <div className="message-inner">
          {cursor && (
            <button
              className="latest-button"
              onClick={() => {
                followMessages.current = true;
                setCursor(null);
              }}
            >
              Back to latest messages <Icon name="down" size={14} />
            </button>
          )}
          {page.next && (
            <button
              className="earlier-button"
              onClick={() => setCursor(page.next as Cursor)}
            >
              View earlier messages
            </button>
          )}
          {messages.length > 0 && (
            <div className="date-divider">
              <span />
              {new Date(messages[0].at).toLocaleDateString([], {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              <span />
            </div>
          )}
          {page.status === "loading" && !page.data && (
            <div className="message-placeholder">
              <span className="spinner" />
              <p>Opening the conversation…</p>
            </div>
          )}
          {page.error && (
            <div className="inline-notice" role="status">
              {page.status === "denied"
                ? "You’re no longer a member of this conversation."
                : "These messages aren’t available yet."}{" "}
              {!online && "Go online to load this part of the conversation."}
            </div>
          )}
          {page.complete && messages.length === 0 && (
            <div className="conversation-beginning">
              <span className={`room-avatar large ${room.color}`}>#</span>
              <h2>A fresh conversation.</h2>
              <p>
                A thought, a question, a simple hello.
                <br />
                This is a good place to start.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              own={message.author === connection.principal?.id}
              grouped={
                index > 0 &&
                messages[index - 1].author === message.author &&
                Math.abs(message.at - messages[index - 1].at) < 300_000
              }
              onEdit={() => edit(message)}
            />
          ))}
          {pending.map((operation) => (
            <div className="message pending-message" key={operation.id}>
              <Avatar name={displayPerson(connection.principal!.id)} />
              <div className="message-content">
                <div className="message-byline">
                  <strong>{displayPerson(connection.principal!.id)}</strong>
                  <span className="you-label">YOU</span>
                </div>
                <p>{String(operation.args.body)}</p>
                <span className="pending-label">
                  <Icon name="clock" size={12} />
                  {operation.status === "persisting"
                    ? "Saving on this device…"
                    : operation.status === "sending"
                      ? "Sending…"
                      : operation.status === "observing"
                        ? "Sent · updating conversation…"
                        : "Saved on this device · waiting to send"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="compose-area">
        {!atBottom && cursor === null && (
          <button
            className="latest-button"
            onClick={() => {
              followMessages.current = true;
              listRef.current?.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            Jump to latest <Icon name="down" size={14} />
          </button>
        )}
        {draftError && (
          <div className="composer-notice" role="alert">
            <span>{draftError}</span>
            <button onClick={retryDraft}>Retry saving draft</button>
          </div>
        )}
        {needsAttention.map((operation) => (
          <div className="composer-notice" role="status" key={operation.id}>
            <span>
              {operation.status === "parked"
                ? "A saved message needs attention before it can continue."
                : operation.status === "conflict"
                  ? "This message changed while you were editing. Restore your words to review them against the latest message."
                  : "This message couldn’t be saved to the conversation. Your words are still saved."}
              {operation.receipt?.reason && ` ${operation.receipt.reason}`}
            </span>
            {operation.status !== "parked" && (
              <button
                disabled={Boolean(draft.body || draft.edit)}
                title={
                  draft.body || draft.edit
                    ? "Finish or clear the current draft first"
                    : "Put your saved words back in the composer"
                }
                onClick={() => void restore(operation)}
              >
                Restore draft
              </button>
            )}
          </div>
        ))}
        {notice && (
          <div className="composer-notice" role="status">
            <span>{notice.text}</span>
            {notice.recover && (
              <button
                disabled={Boolean(draft.body || draft.edit)}
                title={draft.body || draft.edit ? "Finish or clear the current draft first" : "Restore your saved words"}
                onClick={() => {
                  if (setDraft(notice.recover!)) setNotice(null);
                  composer.current?.focus();
                }}
              >
                Restore draft
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        <form
          className={`composer ${draft.edit ? "editing" : ""}`}
          onSubmit={(event) => void send(event)}
        >
          {draft.edit && (
            <>
              <div className="editing-label">
                <Icon name="edit" size={14} />
                <span>Editing your message</span>
                <button type="button" onClick={() => setDraft(EMPTY_DRAFT)}>
                  Cancel
                </button>
              </div>
              <div className="editing-base">
                <span>CURRENT MESSAGE</span>
                <p>{draft.edit.baseBody}</p>
              </div>
            </>
          )}
          <div className="composer-input">
            <textarea
              ref={composer}
              value={draft.body}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
              maxLength={2000}
              rows={1}
              placeholder={`Message ${room.title}…`}
              aria-label={
                draft.edit ? "Edit your message" : `Message ${room.title}`
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              disabled={!draft.body.trim() || persisting}
              aria-label={draft.edit ? "Save edit" : "Send message"}
            >
              {persisting ? (
                <span className="spinner" />
              ) : (
                <Icon name={draft.edit ? "check" : "arrow"} size={20} />
              )}
            </button>
          </div>
        </form>
        <div className="composer-footer">
          <span>
            {online ? (
              <>
                <kbd>↵</kbd> to send <span className="footer-dot">·</span>{" "}
                <kbd>shift ↵</kbd> for a new line
              </>
            ) : (
              <>
                <Icon name="offline" size={12} /> Your messages will send when
                you reconnect
              </>
            )}
          </span>
          <span>
            {draft.body.length > 1800 ? (
              `${draft.body.length}/2000`
            ) : (
              <>
                <Icon name="lock" size={11} /> Members only
              </>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

function MessageRow({
  message,
  own,
  grouped,
  onEdit,
}: {
  message: Message;
  own: boolean;
  grouped: boolean;
  onEdit(): void;
}) {
  const name = message.sender?.displayName ?? displayPerson(message.author);
  return (
    <article className={`message ${grouped ? "grouped" : ""}`}>
      {!grouped ? <Avatar name={name} /> : <div className="avatar-spacer" />}
      <div className="message-content">
        {!grouped && (
          <div className="message-byline">
            <strong>{name}</strong>
            {own && <span className="you-label">YOU</span>}
            <time dateTime={new Date(message.at).toISOString()}>
              {time(message.at)}
            </time>
          </div>
        )}
        <p>{message.body}</p>
        {message.editedAt && <span className="edited-label">edited</span>}
      </div>
      {own && (
        <button
          className="message-edit icon-button"
          aria-label={`Edit message: ${message.body.slice(0, 45)}`}
          onClick={onEdit}
        >
          <Icon name="edit" size={14} />
        </button>
      )}
    </article>
  );
}

function Details({
  room,
  online,
  pending,
  connectionStatus,
  toggleOnline,
  close,
}: {
  room: Conversation;
  online: boolean;
  pending: number;
  connectionStatus: string;
  toggleOnline(): void;
  close(): void;
}) {
  const members = useQuery(api.conversations.members, {
    conversationId: room.id,
  });
  return (
    <aside className="details">
      <div className="details-heading">
        <span>THE ROOM</span>
        <button
          className="icon-button"
          aria-label="Close conversation details"
          onClick={close}
        >
          <Icon name="close" size={17} />
        </button>
      </div>
      <div className="room-profile">
        <div className={`room-avatar room-profile-icon ${room.color}`}>
          {room.kind === "group" ? "#" : <Icon name="users" size={29} />}
        </div>
        <h2>{room.title}</h2>
        <span>
          {room.kind === "group"
            ? "A shared conversation"
            : "A direct conversation"}
        </span>
      </div>
      <section className="details-section">
        <h3>ABOUT THIS SPACE</h3>
        <p>{room.topic}</p>
      </section>
      <section className="details-section members">
        <h3>THE PEOPLE {members.data && <span>{members.data.length}</span>}</h3>
        {members.data?.map((member) => (
          <div className="member" key={member.principal}>
            <Avatar name={member.displayName} size="small" />
            <div>
              <strong>{member.displayName}</strong>
              <span>{member.role}</span>
            </div>
          </div>
        ))}
        {!members.data && (
          <p>People will appear when this information is available.</p>
        )}
      </section>
      <section className={`connection-card ${online ? "" : "offline-card"}`}>
        <span className="connection-card-icon">
          <Icon name={online ? "wifi" : "offline"} size={22} />
        </span>
        <h3>{online ? "A connection you can leave." : "Still your space."}</h3>
        <p>
          {online
            ? "Step away from the network. Keep your thoughts moving."
            : "Your saved messages stay on this device until you reconnect."}
        </p>
        {pending > 0 && (
          <div className="queue-count">
            <span />
            {pending}{" "}
            {pending === 1 ? "message or update" : "messages or updates"}{" "}
            waiting
          </div>
        )}
        <button onClick={toggleOnline}>
          {online ? "Try working offline" : "Go back online"}
          <Icon name={online ? "offline" : "wifi"} size={15} />
        </button>
        <span className="connection-caption">
          {online
            ? "NETWORK CONNECTED"
            : connectionStatus === "offline"
              ? "OFFLINE MODE"
              : "RECONNECTING"}
        </span>
      </section>
      <div className="details-footer">
        <BrandMark />
        <span>
          Made with Snapback 3<br />
          <span>An independent experiment</span>
        </span>
      </div>
    </aside>
  );
}

function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "small" | "normal";
}) {
  const color = name.startsWith("Alice")
    ? "sage"
    : name.startsWith("Bob")
      ? "sky"
      : "clay";
  return (
    <span
      className={`avatar ${color} ${size === "small" ? "avatar-small" : ""}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
