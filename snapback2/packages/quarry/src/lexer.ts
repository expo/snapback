import type { Site } from "./ast";
import { refuse } from "./diagnostics";

export type TokenKind = "word" | "number" | "string" | "symbol" | "newline" | "indent" | "dedent" | "eof";
export type Token = Site & { kind: TokenKind; value: string };

const TWO_CHARACTER = new Set(["<-", "->", "<=", ">=", "!=", "??", "+~"]);
const SYMBOLS = new Set(":(),[]{}.?!#+-~*/%=<>");

export function lex(file: string, source: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  let grouping = 0;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex]!;
    const line = lineIndex + 1;
    if (/^\s*--/.test(raw) || /^\s*$/.test(raw)) continue;
    const leading = raw.match(/^[ \t]*/)?.[0] ?? "";
    if (leading.includes("\t")) refuse({ file, line, col: 1 }, "tabs are not valid indentation; use spaces");
    let offset = leading.length;

    if (grouping === 0) {
      const current = indents.at(-1)!;
      if (offset > current) {
        indents.push(offset);
        tokens.push(token(file, line, 1, "indent", "<indent>"));
      } else if (offset < current) {
        while (offset < indents.at(-1)!) {
          indents.pop();
          tokens.push(token(file, line, 1, "dedent", "<dedent>"));
        }
        if (offset !== indents.at(-1)) refuse({ file, line, col: 1 }, "indentation does not match an enclosing block");
      }
    }

    let emitted = false;
    while (offset < raw.length) {
      const char = raw[offset]!;
      if (char === " " || char === "\t") {
        offset += 1;
        continue;
      }
      if (char === "-" && raw[offset + 1] === "-") break;
      const site = { file, line, col: offset + 1 };
      const pair = raw.slice(offset, offset + 2);
      if (TWO_CHARACTER.has(pair)) {
        tokens.push({ ...site, kind: "symbol", value: pair });
        offset += 2;
        emitted = true;
        continue;
      }
      if (char === "'" || char === '"') {
        const quote = char;
        let value = "";
        offset += 1;
        let closed = false;
        while (offset < raw.length) {
          const next = raw[offset]!;
          if (next === quote) {
            offset += 1;
            closed = true;
            break;
          }
          if (next === "\\") {
            const escaped = raw[offset + 1];
            if (escaped === undefined) break;
            value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
            offset += 2;
          } else {
            value += next;
            offset += 1;
          }
        }
        if (!closed) refuse(site, "unterminated string literal");
        tokens.push({ ...site, kind: "string", value });
        emitted = true;
        continue;
      }
      if (/[0-9]/.test(char)) {
        const match = raw.slice(offset).match(/^\d+/)![0];
        tokens.push({ ...site, kind: "number", value: match });
        offset += match.length;
        emitted = true;
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        const match = raw.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_]*/)![0];
        tokens.push({ ...site, kind: "word", value: match });
        offset += match.length;
        emitted = true;
        continue;
      }
      if (SYMBOLS.has(char)) {
        tokens.push({ ...site, kind: "symbol", value: char });
        if ("([{".includes(char)) grouping += 1;
        if (")]}".includes(char)) grouping -= 1;
        if (grouping < 0) refuse(site, `unexpected ${char}`);
        offset += 1;
        emitted = true;
        continue;
      }
      refuse(site, `unexpected character ${JSON.stringify(char)}`);
    }
    if (emitted && grouping === 0) tokens.push(token(file, line, raw.length + 1, "newline", "<newline>"));
  }
  if (grouping !== 0) refuse({ file, line: lines.length, col: 1 }, "unclosed grouping delimiter");
  while (indents.length > 1) {
    indents.pop();
    tokens.push(token(file, lines.length, 1, "dedent", "<dedent>"));
  }
  tokens.push(token(file, lines.length, 1, "eof", "<eof>"));
  return tokens;
}

function token(file: string, line: number, col: number, kind: TokenKind, value: string): Token {
  return { file, line, col, kind, value };
}
