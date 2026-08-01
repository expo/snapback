// Party Wall — the browser wall. One screen: sign in, pick or create an
// event, watch the wall live, post photos with optimistic previews.
// The asset hooks do the heavy lifting: useSnapbackAssetUpload owns the
// capture task (preview → progress → ready, retry keeps the asset id), and
// SnapbackAssetImage walks preview → server ThumbHash → best-width rendition.

import { useEffect, useMemo, useState } from 'react';

// @ts-ignore untyped .mjs workspace module
import {
  SnapbackAssetImage,
  useSnapbackAssetUpload,
  useSnapbackQuery,
  // @ts-ignore untyped .mjs workspace module
} from '../../../../../packages/snapback-react/index.mjs';
// @ts-ignore generated module
import apiModule from '../../../snapback/generated/api.mjs';

const api: any = (apiModule as any).default ?? apiModule;

type Session = {
  client: any;
  coordinator: any;
  credential: any;
  provider: any;
};

function Wall({ session, eventId }: { session: Session; eventId: string }) {
  const wall = useSnapbackQuery(api.eventWall, { eventId });
  const upload = useSnapbackAssetUpload({ upload: api.photoUpload });
  const snapshot: any = upload.snapshot;
  const [caption, setCaption] = useState('');

  async function post(file: File) {
    const task: any = upload.start(file, { previewUrl: URL.createObjectURL(file) });
    const finished = await task.done;
    if (finished.status !== 'ready') return;
    await session.client.mutate(api.createPost, {
      args: {
        eventId,
        caption: caption || file.name,
        authorName: session.credential.session.userId.slice(0, 12),
        assetId: finished.assetId,
      },
      authorityCapture: session.coordinator.capture(),
    });
    setCaption('');
  }

  const rows: any[] = (wall as any)?.rows ?? (wall as any)?.data ?? [];
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, margin: '1rem 0' }}>
        <input
          placeholder="caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <label style={{ border: '1px solid #6d5bd0', padding: '4px 10px', borderRadius: 6 }}>
          {snapshot?.status === 'uploading'
            ? `uploading ${snapshot.bytesTransferred ?? 0}b…`
            : '📷 post a photo'}
          <input
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && post(e.target.files[0])}
          />
        </label>
      </div>
      {snapshot?.previewUrl && snapshot.status !== 'ready' ? (
        <img src={snapshot.previewUrl} width={96} style={{ opacity: 0.6, borderRadius: 8 }} />
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {rows.map((post) => (
          <figure key={post._id} style={{ margin: 0 }}>
            {post.photo ? (
              <SnapbackAssetImage
                assetId={post.photo}
                maxWidth={320}
                alt={post.caption}
                style={{ width: '100%', borderRadius: 8 }}
              />
            ) : null}
            <figcaption style={{ fontSize: 12, opacity: 0.8 }}>
              {post.caption} — {post.authorName}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function App({
  signIn,
  baseUrl,
  SnapbackProvider,
}: {
  signIn: (email: string) => Promise<Session>;
  baseUrl: string;
  SnapbackProvider: any;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('ada@example.com');
  const [eventId, setEventId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function createEvent() {
    const created = await session!.client.mutate(api.createEvent, {
      args: { title: 'Party Wall', emoji: '🎉', startsAt: Date.now(), hostName: email.split('@')[0] },
      authorityCapture: session!.coordinator.capture(),
    });
    setEventId(created.result);
  }

  if (!session) {
    return (
      <div>
        <h1>🎉 Party Wall</h1>
        <p>Sessions-mode sign-in (dev mailbox; trusted-local demo).</p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <button
          onClick={() =>
            signIn(email).then(setSession, (e) => setError(String(e?.message ?? e)))
          }
        >
          Sign in
        </button>
        {error ? <p style={{ color: '#ff7a76' }}>{error}</p> : null}
        <p style={{ fontSize: 12, opacity: 0.7 }}>Server: {baseUrl}</p>
      </div>
    );
  }

  return (
    <SnapbackProvider provider={session.provider}>
      <h1>🎉 Party Wall</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="event id (or create one)"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
        />
        <button onClick={createEvent}>New event</button>
      </div>
      {eventId ? <Wall session={session} eventId={eventId} /> : <p>Join or create an event.</p>}
    </SnapbackProvider>
  );
}
