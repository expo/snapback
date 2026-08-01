// Type surface of thumbhash.mjs (ThumbHash decode half; LLP 0044
// §Declarative processing). Keep in sync with the vendored implementation.

/** Decode a ThumbHash to raw RGBA pixels (width and height are ≤ 32). */
export function thumbHashToRGBA(hash: Uint8Array): {
  w: number;
  h: number;
  rgba: Uint8Array;
};

/** The hash's approximate aspect ratio (width / height). */
export function thumbHashToApproximateAspectRatio(hash: Uint8Array): number;

/**
 * Encode raw RGBA pixels as an uncompressed PNG data URL — no canvas, no
 * DOM, so the same path serves React DOM and React Native `Image`.
 */
export function rgbaToDataURL(
  w: number,
  h: number,
  rgba: Uint8Array | readonly number[],
): string;

/** Decode a ThumbHash straight to a PNG data URL. */
export function thumbHashToDataURL(hash: Uint8Array): string;

/** Decode the `thumbhash.v1` placeholder field value (base64). */
export function placeholderToDataURL(value: string | Uint8Array): string;
