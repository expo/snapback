import { searchWords } from "./unicode";

export function splitMentionTokens(text: string): string[] {
  const tokens: string[] = [];
  let token = "";
  for (const character of text) {
    if (isMentionWhitespace(character.codePointAt(0)!)) {
      if (token.length > 0) tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  if (token.length > 0) tokens.push(token);
  return tokens;
}

// @ref LLP 1001#unicode-search-foundation — direct authoring calls use the same
// pinned Unicode normalization and token boundaries as compiled Words.
/** Authoring-time form of the evaluator's pinned Unicode Words builtin. */
export function words(value: string | null | undefined): string[] {
  const source = value ?? null;
  return searchWords(source, source?.length ?? 0);
}

function isMentionWhitespace(point: number): boolean {
  return (
    (point >= 0x0009 && point <= 0x000d) ||
    point === 0x0020 ||
    point === 0x0085 ||
    point === 0x00a0 ||
    point === 0x1680 ||
    (point >= 0x2000 && point <= 0x200a) ||
    point === 0x2028 ||
    point === 0x2029 ||
    point === 0x202f ||
    point === 0x205f ||
    point === 0x3000
  );
}
