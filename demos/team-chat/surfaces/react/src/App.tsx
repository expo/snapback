import { useEffect, useMemo, useState } from 'react';
import { useSnapbackQuery } from '../../../../../packages/snapback-react/index.mjs';

import type { GeneratedApi, GeneratedDataModel } from '../../../snapback/generated/api';
import runtimeApi from '../../../snapback/generated/api.mjs';
import { teamChatProvider } from './provider';

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
  const [userId, setUserId] = useState(initialUserId);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const persona = PERSONAS.find((candidate) => candidate.userId === userId) ?? PERSONAS[0];
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
              className={candidate.userId === userId ? 'persona active' : 'persona'}
              data-testid={`persona-${candidate.id}`}
              onClick={() => {
                setUserId(candidate.userId);
                setSelectedRoomId(null);
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
  const rooms = useSnapbackQuery<Participant>({
    provider: teamChatProvider,
    query: api.listMyRooms,
    userId: persona.userId,
    authority: persona.userId,
  });
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (!title.trim()) return;
    setError(null);
    try {
      const roomId = await rooms.mutate<string>(
        api.createRoom,
        { title: title.trim(), displayName: persona.name },
      );
      onOpen(roomId);
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
        {rooms.status !== 'pending' && rooms.rows.length === 0 && (
          <p className="empty" data-testid="rooms-empty">No rooms yet.</p>
        )}
        {rooms.rows.map((participant) => (
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
                  await rooms.mutate(api.acceptInvite, { roomId: participant.roomId });
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
  const room = useSnapbackQuery<Room>({
    provider: teamChatProvider,
    query: api.roomDetails,
    args: { roomId },
    userId: persona.userId,
    authority: persona.userId,
  });
  const messages = useSnapbackQuery<Message>({
    provider: teamChatProvider,
    query: api.roomMessages,
    args: { roomId },
    userId: persona.userId,
    authority: persona.userId,
  });
  const unread = useSnapbackQuery<Delivery>({
    provider: teamChatProvider,
    query: api.unreadDeliveries,
    userId: persona.userId,
    authority: persona.userId,
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedUnread = useMemo(
    () => unread.rows.filter((delivery) => delivery.roomId === roomId),
    [roomId, unread.rows],
  );
  useEffect(() => {
    if (room.status === 'ready' && room.rows.length === 0) onBack();
  }, [onBack, room.rows.length, room.status]);
  const details = room.rows[0];
  if (!details) return <p className="empty">Opening protected room…</p>;
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft('');
    try {
      await messages.mutate(api.sendMessage, { roomId, body });
    } catch (cause) {
      setDraft(body);
      setError(cause instanceof Error ? cause.message : 'message failed');
    }
  };
  const invite = async () => {
    setError(null);
    try {
      await room.mutate(api.inviteMember, {
        roomId,
        userId: PERSONAS[1].userId,
        displayName: PERSONAS[1].name,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'invitation failed');
    }
  };
  return (
    <section className="room-page" data-testid="room-view">
      <aside className="room-sidebar">
        <button type="button" className="back" data-testid="back" onClick={onBack}>← Rooms</button>
        <div className="room-mark">#</div>
        <p className="eyebrow">Protected room</p>
        <h1 data-testid="room-title">{details.title}</h1>
        <Connection value={messages.connection} />
        <div className="sidebar-actions">
          {details.createdBy === persona.userId && (
            <button type="button" className="secondary" data-testid="invite-member" onClick={() => void invite()}>
              Invite Member 01
            </button>
          )}
          {details.createdBy !== persona.userId && (
            <button
              type="button"
              className="danger"
              data-testid="leave-room"
              onClick={async () => {
                await room.mutate(api.leaveRoom, { roomId });
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
            onClick={() => void unread.mutate(api.markRoomRead, { roomId })}
          >
            {selectedUnread.length} unread
          </button>
        </header>
        <div className="messages" data-testid="message-list">
          {messages.rows.length === 0 && <p className="empty">No messages yet. Say hello.</p>}
          {messages.rows.map((message) => (
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
