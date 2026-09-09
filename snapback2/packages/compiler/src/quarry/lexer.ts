import type { QuarryDiagnostic, Site } from "./ast";

export type TokenKind = "word" | "number" | "string" | "symbol" | "newline" | "indent" | "dedent" | "eof";
export type Token = Site & { kind: TokenKind; value: string };

const TWO_CHARACTER = new Set(["<-", "->", "<=", ">=", "!=", "??"]);
const SYMBOLS = new Set(":(),[]{}.?!+-~*/%=<>");
const HYPHENATED_WORDS = ["until-revoked", "delivered-history"];

export function lex(file: string, source: string): { tokens: Token[]; diagnostics: QuarryDiagnostic[] } {
  const tokens: Token[] = [];
  const diagnostics: QuarryDiagnostic[] = [];
  const report = (site: Site, message: string) => diagnostics.push({
    ...site,
    code: "E_QUARRY_SYNTAX",
    message,
    rewrite: "fix this Quarry line and rerun snapback2 check",
    guide: "quarry/grammar",
  });
  const indents = [0];
  let grouping = 0;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex]!;
    const line = lineIndex + 1;
    if (/^\s*--/.test(raw) || /^\s*$/.test(raw)) continue;
    const leading = raw.match(/^[ \t]*/)?.[0] ?? "";
    if (leading.includes("\t")) report({ file, line, col: 1 }, "tabs are not valid indentation; use spaces");
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
        if (offset !== indents.at(-1)) report({ file, line, col: 1 }, "indentation does not match an enclosing block");
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
        if (!closed) report(site, "unterminated string literal");
        tokens.push({ ...site, kind: "string", value });
        emitted = true;
        continue;
      }
      if (/[0-9]/.test(char)) {
        const match = raw.slice(offset).match(/^\d+(?:\.\d+)?/)![0];
        tokens.push({ ...site, kind: "number", value: match });
        offset += match.length;
        emitted = true;
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        // Retention words are reserved tokens everywhere; the parser owns their context.
        const hyphenated = HYPHENATED_WORDS.find((word) => raw.startsWith(word, offset)
          && !/[A-Za-z0-9_-]/.test(raw[offset + word.length] ?? ""));
        const match = hyphenated ?? raw.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_]*/)![0];
        tokens.push({ ...site, kind: "word", value: match });
        offset += match.length;
        emitted = true;
        continue;
      }
      if (SYMBOLS.has(char)) {
        tokens.push({ ...site, kind: "symbol", value: char });
        if ("([{".includes(char)) grouping += 1;
        if (")]}".includes(char)) grouping -= 1;
        if (grouping < 0) {
          report(site, `unexpected ${char}`);
          grouping = 0;
        }
        offset += 1;
        emitted = true;
        continue;
      }
      report(site, `unexpected character ${JSON.stringify(char)}`);
      offset += 1;
    }
    if (emitted && grouping === 0) tokens.push(token(file, line, raw.length + 1, "newline", "<newline>"));
  }
  if (grouping !== 0) report({ file, line: lines.length, col: 1 }, "unclosed grouping delimiter");
  while (indents.length > 1) {
    indents.pop();
    tokens.push(token(file, lines.length, 1, "dedent", "<dedent>"));
  }
  tokens.push(token(file, lines.length, 1, "eof", "<eof>"));
  return { tokens, diagnostics };
}

function token(file: string, line: number, col: number, kind: TokenKind, value: string): Token {
  return { file, line, col, kind, value };
}
