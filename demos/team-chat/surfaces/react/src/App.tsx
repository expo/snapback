import { useEffect, useMemo, useState } from 'react';
import {
  useSnapbackMutation,
  useSnapbackQuery,
} from '../../../../../packages/snapback-react/index.mjs';

import type { GeneratedApi, GeneratedDataModel } from '../../../snapback/generated/api';
import runtimeApi from '../../../snapback/generated/api.mjs';
import { queryTeamChat } from './provider';

const api = runtimeApi as GeneratedApi;
type Room = GeneratedDataModel['rooms'];
type Participant = GeneratedDataModel['roomParticipants'];
type Message = GeneratedDataModel['messages'];
type Delivery = GeneratedDataModel['deliveries'];

export interface Persona {
  id: string;
  userId: string;
  name: string;
  initials: string;
}

export const PERSONAS: Persona[] = [
  { id: 'owner', userId: 'user_owner', name: 'Owner', initials: 'OW' },
  { id: 'member', userId: 'user_member_01', name: 'Member 01', initials: 'M1' },
  { id: 'outsider', userId: 'user_unrelated', name: 'Outsider', initials: 'OS' },
];

export function App({ initialUserId }: { initialUserId: string }) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const persona = PERSONAS.find((candidate) => candidate.userId === initialUserId) ?? PERSONAS[0];
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          type="button"
          className="brand"
          data-testid="home"
          onClick={() => setSelectedRoomId(null)}
        >
          <span>SB</span>
          <strong>Team Chat</strong>
          <small>local pressure profile</small>
        </button>
        <nav aria-label="Development personas" data-testid="persona-switcher">
          {PERSONAS.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={candidate.userId === persona.userId ? 'persona active' : 'persona'}
              data-testid={`persona-${candidate.id}`}
              onClick={() => {
                const url = new URL(location.href);
                url.searchParams.set('user', candidate.id);
                url.pathname = '/';
                location.assign(url);
              }}
            >
              {candidate.initials}
              <span>{candidate.name}</span>
            </button>
          ))}
        </nav>
      </header>
      <main key={persona.userId}>
        {selectedRoomId === null ? (
          <RoomList persona={persona} onOpen={setSelectedRoomId} />
        ) : (
          <RoomView
            persona={persona}
            roomId={selectedRoomId}
            onBack={() => setSelectedRoomId(null)}
          />
        )}
      </main>
    </div>
  );
}

function Connection({ value }: { value: string | null }) {
  const rendered = value ?? 'connecting';
  return <span className={`connection ${rendered}`} data-testid="connection">● {rendered}</span>;
}

function RoomList({
  persona,
  onOpen,
}: {
  persona: Persona;
  onOpen(roomId: string): void;
}) {
  const rooms = useSnapbackQuery(api.listMyRooms, {});
  const createRoom = useSnapbackMutation(api.createRoom);
  const acceptInvite = useSnapbackMutation(api.acceptInvite);
  const roomRows = rooms.data ?? [];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!title.trim()) return;
    setError(null);
    try {
      const roomId = await createRoom({ title: title.trim(), displayName: persona.name });
      onOpen(String(roomId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'room creation failed');
    }
  };
  return (
    <section className="room-list-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Signed in locally as {persona.name}</p>
          <h1>Your rooms</h1>
          <p>Protected conversations with explicit membership and recipient-owned unread state.</p>
        </div>
        <Connection value={rooms.connection} />
      </div>
      <button
        type="button"
        className="primary"
        data-testid="new-room"
        onClick={() => setCreating((value) => !value)}
      >
        {creating ? 'Cancel' : '+ New room'}
      </button>
      {creating && (
        <form
          className="create-room"
          data-testid="create-room-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label>
            Room title
            <input
              autoFocus
              data-testid="create-room-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Compiler Club"
            />
          </label>
          <button type="submit" className="primary" data-testid="create-room-submit">
            Create protected room
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
      <div className="room-grid" data-testid="room-list">
        {rooms.status === 'pending' && <p className="empty">Loading rooms…</p>}
        {rooms.status !== 'pending' && roomRows.length === 0 && (
          <p className="empty" data-testid="rooms-empty">No rooms yet.</p>
        )}
        {roomRows.map((participant: Participant) => (
          <article className="room-card" key={participant._id} data-testid={`room-card-${participant.roomId}`}>
            <div className="room-glyph">#</div>
            <div>
              <h2>{participant.displayName === persona.name ? 'Your protected room' : 'Room invitation'}</h2>
              <span className={`status ${participant.status}`} data-testid="room-status">
                {participant.status}
              </span>
            </div>
            {participant.status === 'invited' ? (
              <button
                type="button"
                className="primary"
                data-testid="accept-invite"
                onClick={async () => {
                  await acceptInvite({ roomId: participant.roomId });
                  onOpen(participant.roomId);
                }}
              >
                Accept invitation
              </button>
            ) : participant.status === 'left' ? (
              <span className="muted">Waiting for another invitation</span>
            ) : (
              <button
                type="button"
                className="secondary"
                data-testid="open-room"
                onClick={() => onOpen(participant.roomId)}
              >
                Open room
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function RoomView({
  persona,
  roomId,
  onBack,
}: {
  persona: Persona;
  roomId: string;
  onBack(): void;
}) {
  const roomRef = roomId as Room['_id'];
  const memberPrincipal = PERSONAS[1].userId as Room['createdBy'];
  const room = useSnapbackQuery(api.roomDetails, { roomId: roomRef });
  const messages = useSnapbackQuery(api.roomMessages, { roomId: roomRef });
  const unread = useSnapbackQuery(api.unreadDeliveries, {});
  const inviteMember = useSnapbackMutation(api.inviteMember);
  const leaveRoom = useSnapbackMutation(api.leaveRoom);
  const ownerRemoveMember = useSnapbackMutation(api.ownerRemoveMember);
  const sendMessage = useSnapbackMutation(api.sendMessage);
  const markRoomRead = useSnapbackMutation(api.markRoomRead);
  const roomRows = room.data ?? [];
  const messageRows = messages.data ?? [];
  const unreadRows = unread.data ?? [];
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const selectedUnread = useMemo(
    () => unreadRows.filter((delivery: Delivery) => delivery.roomId === roomId),
    [roomId, unreadRows],
  );
  useEffect(() => {
    if (room.status === 'ready' && roomRows.length === 0) onBack();
  }, [onBack, roomRows.length, room.status]);
  useEffect(() => {
    setHistory([]);
    setHistoryCursor(null);
    setHistoryLoaded(false);
    setHistoryError(null);
  }, [persona.userId, roomId]);
  const details = roomRows[0] as Room | undefined;
  if (!details) return <p className="empty">Opening protected room…</p>;
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft('');
    try {
      await sendMessage({ roomId: roomRef, body });
    } catch (cause) {
      setDraft(body);
      setError(cause instanceof Error ? cause.message : 'message failed');
    }
  };
  const invite = async () => {
    setError(null);
    try {
      await inviteMember({
        roomId: roomRef,
        userId: memberPrincipal,
        displayName: PERSONAS[1].name,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'invitation failed');
    }
  };
  const loadHistory = async (after: string | null) => {
    setHistoryError(null);
    try {
      const page = after === null
        ? await queryTeamChat<Message>(api.firstRoomMessagePage, { roomId }, persona.userId)
        : await queryTeamChat<Message>(
          api.nextRoomMessagePage,
          { roomId, after },
          persona.userId,
        );
      setHistory((rows) => after === null ? page.rows : [...rows, ...page.rows]);
      setHistoryCursor(page.cursor);
      setHistoryLoaded(true);
    } catch (cause) {
      setHistory([]);
      setHistoryCursor(null);
      setHistoryError(cause instanceof Error ? cause.message : 'history page failed');
    }
  };
  return (
    <section className="room-page" data-testid="room-view" data-room-id={roomId}>
      <aside className="room-sidebar">
        <button type="button" className="back" data-testid="back" onClick={onBack}>← Rooms</button>
        <div className="room-mark">#</div>
        <p className="eyebrow">Protected room</p>
        <h1 data-testid="room-title">{details.title}</h1>
        <Connection value={messages.connection} />
        <div className="sidebar-actions">
          {details.createdBy === persona.userId && (
            <>
              <button type="button" className="secondary" data-testid="invite-member" onClick={() => void invite()}>
                Invite Member 01
              </button>
              <button
                type="button"
                className="danger"
                data-testid="remove-member"
                onClick={async () => {
                  setError(null);
                  try {
                    await ownerRemoveMember({
                      roomId: roomRef,
                      targetPrincipal: memberPrincipal,
                    });
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : 'member removal failed');
                  }
                }}
              >
                Remove Member 01
              </button>
            </>
          )}
          {details.createdBy !== persona.userId && (
            <button
              type="button"
              className="danger"
              data-testid="leave-room"
              onClick={async () => {
                await leaveRoom({ roomId: roomRef });
                onBack();
              }}
            >
              Leave room
            </button>
          )}
        </div>
        {error && <p className="error" role="alert" data-testid="room-error">{error}</p>}
      </aside>
      <div className="conversation">
        <header className="conversation-header">
          <div>
            <strong>#{details.title.toLowerCase().replaceAll(' ', '-')}</strong>
            <span>32-recipient admitted local cohort</span>
          </div>
          <button
            type="button"
            className="unread"
            data-testid="unread-count"
            onClick={() => void markRoomRead({ roomId: roomRef })}
          >
            {selectedUnread.length} unread
          </button>
        </header>
        <div className="messages" data-testid="message-list">
          {messageRows.length === 0 && <p className="empty">No messages yet. Say hello.</p>}
          {messageRows.map((message: Message) => (
            <article className="message" key={message._id}>
              <div className="avatar">{message.authorName.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{message.authorName}</strong>
                <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                <p>{message.body}</p>
              </div>
            </article>
          ))}
        </div>
        <section className="history" data-testid="room-history">
          <div>
            <strong>Bounded room history</strong>
            <span data-testid="history-count">{history.length} historical messages</span>
          </div>
          {!historyLoaded ? (
            <button
              type="button"
              className="secondary"
              data-testid="history-first"
              onClick={() => void loadHistory(null)}
            >
              Load first page
            </button>
          ) : historyCursor !== null ? (
            <button
              type="button"
              className="secondary"
              data-testid="history-next"
              onClick={() => void loadHistory(historyCursor)}
            >
              Load next page
            </button>
          ) : (
            <span className="muted" data-testid="history-terminal">End of history</span>
          )}
          {historyError && <p className="error" role="alert" data-testid="history-error">{historyError}</p>}
        </section>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="message">Message #{details.title}</label>
          <input
            id="message"
            data-testid="message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Message #${details.title.toLowerCase().replaceAll(' ', '-')}`}
          />
          <button type="submit" className="primary" data-testid="message-send">Send</button>
        </form>
      </div>
    </section>
  );
}
