export interface CoterieComposerMediaOption {
  id: string;
  label: string;
  kind: 'image' | 'video';
  mediaRef: string;
  url: string;
}

// Every non-avatar artifact in the shared social-messenger media manifest.
// Provider-facing refs and browser/native preview URLs intentionally remain
// paired here so the picker and memory-provider validation cannot drift.
export const COTERIE_COMPOSER_MEDIA_OPTIONS: readonly CoterieComposerMediaOption[] = [
  { id: 'img-01', label: 'Image 1', kind: 'image', mediaRef: 'media/img-01.png', url: '/assets/fixtures/img-01.png' },
  { id: 'img-02', label: 'Image 2', kind: 'image', mediaRef: 'media/img-02.png', url: '/assets/fixtures/img-02.png' },
  { id: 'img-03', label: 'Image 3', kind: 'image', mediaRef: 'media/img-03.png', url: '/assets/fixtures/img-03.png' },
  { id: 'img-04', label: 'Image 4', kind: 'image', mediaRef: 'media/img-04.png', url: '/assets/fixtures/img-04.png' },
  { id: 'img-05', label: 'Image 5', kind: 'image', mediaRef: 'media/img-05.png', url: '/assets/fixtures/img-05.png' },
  { id: 'img-06', label: 'Image 6', kind: 'image', mediaRef: 'media/img-06.png', url: '/assets/fixtures/img-06.png' },
  { id: 'vid-01', label: 'Video 1', kind: 'video', mediaRef: 'media/vid-01.mp4', url: '/assets/fixtures/vid-01.mp4' },
];

export const COTERIE_IMAGE_URLS = new Map<string, string>(
  COTERIE_COMPOSER_MEDIA_OPTIONS
    .filter((option) => option.kind === 'image')
    .map((option) => [option.mediaRef, option.url]),
);

export const COTERIE_VIDEO_URLS = new Map<string, string>(
  COTERIE_COMPOSER_MEDIA_OPTIONS
    .filter((option) => option.kind === 'video')
    .map((option) => [option.mediaRef, option.url]),
);
