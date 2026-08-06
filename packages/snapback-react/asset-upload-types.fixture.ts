import {
  type AssetFileLike,
  type AssetTaskSnapshot,
  type AssetUploadTask,
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

declare const weakFile: {
  size: number;
  slice(start: number, end?: number): unknown;
};
// @ts-expect-error upload files must provide arrayBuffer-capable slices.
upload.start(weakFile);
