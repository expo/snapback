import { useRef, useState } from 'react';
import {
  useSnapbackAssetUpload,
  useSnapbackConnection,
  useSnapbackQueries,
} from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';
import { client, publicPhotoUrl } from './snapback';

const activeUploadStates = new Set(['creating', 'uploading', 'finalizing']);

type UploadSnapshot = {
  assetId: string | null;
  status: string;
  bytesTransferred: number;
  totalBytes: number;
  diagnostic?: { message?: string; diagnostic?: { message?: string } } | null;
};

type UploadController = {
  state: UploadSnapshot;
  start: (file: File, options: {
    previewUrl: string;
    declaredFilename: string;
    declaredContentType: string;
  }) => { done: Promise<UploadSnapshot> };
};

export function App() {
  const workspace = useSnapbackQueries({
    photos: { ref: api.listPhotos, args: {} },
  });
  const upload = useSnapbackAssetUpload({ upload: api.photoUpload }) as UploadController;
  const connection = useSnapbackConnection();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const query = workspace.queries.photos;
  const photos = query.status === 'ready' || query.status === 'refreshing'
    ? query.data
    : [];
  const uploading = activeUploadStates.has(upload.state.status);
  const progress = upload.state.totalBytes > 0
    ? Math.round((upload.state.bytesTransferred / upload.state.totalBytes) * 100)
    : 0;

  async function addPhoto(file: File) {
    setError(null);
    const previewUrl = URL.createObjectURL(file);
    try {
      const task = upload.start(file, {
        previewUrl,
        declaredFilename: file.name,
        declaredContentType: file.type,
      });
      const finished = await task.done;
      if (finished.status !== 'ready' || !finished.assetId) {
        throw new Error(
          finished.diagnostic?.diagnostic?.message
            ?? finished.diagnostic?.message
            ?? 'Snapback could not finish this upload.',
        );
      }
      await client.mutate(api.createPhoto, {
        args: { title: file.name, assetId: finished.assetId },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      URL.revokeObjectURL(previewUrl);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Snapback + React</p>
          <h1>Snapdrop</h1>
          <p className="lede">
            Drop in a photo. Snapback uploads, finalizes, stores, and publishes it
            to every open gallery.
          </p>
        </div>
        <span className={`connection connection--${connection.status}`}>
          <i /> {connection.status}
        </span>
      </header>

      <section className="drop-card" aria-label="Photo uploader">
        <input
          ref={inputRef}
          id="photo-file"
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void addPhoto(file);
          }}
        />
        <label className="drop-target" htmlFor="photo-file">
          <span className="plus">+</span>
          <strong>{uploading ? `Uploading ${progress}%` : 'Choose a photo'}</strong>
          <span>JPEG or PNG · up to 10 MB</span>
        </label>
        {uploading ? (
          <div className="progress" aria-label={`Upload ${progress}% complete`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      <section className="gallery-section">
        <div className="gallery-heading">
          <div>
            <p className="eyebrow">Live gallery</p>
            <h2>{photos.length === 0 ? 'Your photos will appear here' : `${photos.length} photo${photos.length === 1 ? '' : 's'}`}</h2>
          </div>
          <span className="live-pill"><i /> live</span>
        </div>

        {photos.length === 0 ? (
          <div className="empty-state">
            <span>↗</span>
            <p>Pick the first photo to see the full upload pipeline in action.</p>
          </div>
        ) : (
          <div className="gallery">
            {[...photos].reverse().map((photo) => (
              <figure key={photo._id} className="photo-card">
                <img src={publicPhotoUrl(photo.image)} alt={photo.title} />
                <figcaption title={photo.title}>{photo.title}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
