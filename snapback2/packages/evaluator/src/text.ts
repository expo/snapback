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
