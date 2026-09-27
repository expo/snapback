const encoder = new TextEncoder();
// Most persistence keys and serialized images are ASCII. Count those without
// allocating a byte buffer; preserve TextEncoder's surrogate handling otherwise.
export const utf8Size = (text: string): number => /[^\x00-\x7f]/.test(text) ? encoder.encode(text).byteLength : text.length;
