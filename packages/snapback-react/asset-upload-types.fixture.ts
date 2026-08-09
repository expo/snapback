import {
  type AssetDiagnostic,
  type AssetImageDelivery,
  type AssetImageState,
  type AssetFileLike,
  type AssetUrlState,
  type AssetTaskSnapshot,
  type AssetUploadTask,
  useSnapbackAssetImage,
  useSnapbackAssetUrl,
  useSnapbackAssetUpload,
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
// @ts-expect-error issued URL status is a closed controller state union.
const invalidIssuedStatus: AssetUrlState['status'] = 'pending';
void invalidIssuedStatus;
// @ts-expect-error signed URL width must be numeric.
useSnapbackAssetUrl('asset-1', { widthPx: '640' });

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
