export interface CoteriePostBodySegment {
  id: string;
  text: string;
  href: string | null;
  testId: string | null;
}

const HTTP_URL = /https?:\/\/[^\s]+/giu;
const TRAILING_PUNCTUATION = /[),.!?;:]+$/u;

export function linkifyPostBody(body: string): CoteriePostBodySegment[] {
  const segments: CoteriePostBodySegment[] = [];
  let cursor = 0;
  let linkIndex = 0;
  for (const match of body.matchAll(HTTP_URL)) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      segments.push({
        id: `text-${cursor}`,
        text: body.slice(cursor, start),
        href: null,
        testId: null,
      });
    }
    const matched = match[0];
    const trailing = matched.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const href = trailing ? matched.slice(0, -trailing.length) : matched;
    if (href) {
      segments.push({
        id: `link-${linkIndex}`,
        text: href,
        href,
        testId: `sm-post-link-${linkIndex}`,
      });
      linkIndex += 1;
    }
    if (trailing) {
      segments.push({
        id: `text-${start + href.length}`,
        text: trailing,
        href: null,
        testId: null,
      });
    }
    cursor = start + matched.length;
  }
  if (cursor < body.length || segments.length === 0) {
    segments.push({
      id: `text-${cursor}`,
      text: body.slice(cursor),
      href: null,
      testId: null,
    });
  }
  return segments;
}
