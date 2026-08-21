import {
  type AssetDiagnostic,
  type AssetUrlEmptyState,
  type AssetUrlHookState,
  type AssetImageDelivery,
  type AssetImageState,
  type AssetFileLike,
  type AssetUrlState,
  type AssetTaskSnapshot,
  type AssetUploadTask,
  type MediaHookState,
  type MediaRef,
  useSnapbackAssetImage,
  useSnapbackAssetUrl,
  useSnapbackAssetUpload,
  useSnapbackMedia,
} from './index.mjs';

declare const file: AssetFileLike;

const upload = useSnapbackAssetUpload({ upload: 'avatarUpload' });
const task: AssetUploadTask = upload.start(file, {
  declaredFilename: 'avatar.png',
  declaredContentType: 'image/png',
});

task.subscribe((snapshot) => {
  snapshot.status.toUpperCase();
  snapshot.assetId?.toUpperCase();
});
task.done.then((snapshot: AssetTaskSnapshot) => snapshot.integrityBasis.toUpperCase());

const resumed: AssetUploadTask | null = upload.resumePersisted({
  assetId: 'asset-1',
  file,
});
resumed?.done.then((snapshot) => snapshot.status.toUpperCase());

const cancelled: Promise<AssetTaskSnapshot> = upload.cancel({ discardAsset: true });
const retried: Promise<AssetUploadTask> = upload.retry();
void cancelled;
void retried;

const issuedUrl: AssetUrlState = useSnapbackAssetUrl('asset-1', {
  variant: 'chat',
  widthPx: 640,
  ttlMs: 30_000,
});
issuedUrl.url?.toUpperCase();
const issuedDiagnostic: AssetDiagnostic | null = issuedUrl.diagnostic;
const refreshed: Promise<void> = issuedUrl.refresh();
void issuedDiagnostic;
void refreshed;
const absentAssetId: string | null | undefined = null;
const emptyIssuedUrl: AssetUrlState = useSnapbackAssetUrl(absentAssetId);
if (emptyIssuedUrl.status === 'empty') {
  const emptyStatus: 'empty' = emptyIssuedUrl.status;
  void emptyStatus;
}
void useSnapbackAssetUrl(undefined).refresh();
// @ts-expect-error issued URL status is a closed controller state union.
const invalidIssuedStatus: AssetUrlState['status'] = 'pending';
void invalidIssuedStatus;
// @ts-expect-error signed URL width must be numeric.
useSnapbackAssetUrl('asset-1', { widthPx: '640' });

export function OptionalAsset({ assetId }: { assetId: string | null | undefined }) {
  const state = useSnapbackAssetUrl(assetId);
  if (state.status === 'empty' || state.status === 'issuing') return null;
  if (state.status === 'ready' || state.status === 'refreshing') {
    return { src: state.url, alt: 'Optional asset' };
  }
  return { retry: () => state.refresh() };
}

const profileImage: MediaRef<'image'> = { assetId: 'asset-1', kind: 'image' };
const mediaState: MediaHookState<'image'> = useSnapbackMedia(profileImage, {
  widthPx: 640,
});
if (mediaState.status === 'ready' || mediaState.status === 'refreshing') {
  mediaState.url.toUpperCase();
  mediaState.rendition.toUpperCase();
}
const emptyMedia: MediaHookState<'image'> = useSnapbackMedia(null);
void emptyMedia.refresh();
// @ts-expect-error the empty spelling is null/undefined, never an empty string.
useSnapbackMedia('');
// @ts-expect-error media kinds are a closed generated/runtime union.
const forgedMediaKind: MediaRef = { assetId: 'asset-1', kind: 'thumbnail' };
void forgedMediaKind;

export function ProfileMedia({ media }: { media: MediaRef<'image'> | null }) {
  const state = useSnapbackMedia(media, { widthPx: 640 });
  if (state.status === 'empty' || state.status === 'issuing') return null;
  if (state.status === 'ready' || state.status === 'refreshing') {
    return { src: state.url, alt: 'Profile' };
  }
  if (state.status === 'unavailable') {
    return { retry: () => state.refresh() };
  }
  return null;
}

declare const weakFile: {
  size: number;
  slice(start: number, end?: number): unknown;
};
// @ts-expect-error upload files must provide arrayBuffer-capable slices.
upload.start(weakFile);

const imageState: AssetImageState = useSnapbackAssetImage({ assetId: 'asset-1' });
imageState.strictSrc?.toUpperCase();
if (imageState.delivery === 'pending') {
  imageState.placeholderSrc?.startsWith('data:');
}
const delivery: AssetImageDelivery | null = imageState.delivery;
void delivery;
// @ts-expect-error asset image delivery is a closed set, not an arbitrary string.
const invalidDelivery: AssetImageDelivery = 'arbitrary';
void invalidDelivery;
