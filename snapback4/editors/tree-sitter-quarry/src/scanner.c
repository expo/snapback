// @ref LLP 3000.041#2.3 — layout and token boundaries; snapback4-lang is the parser of record.
#include "tree_sitter/parser.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "keywords.generated.h"

enum Token { NEWLINE, INDENT, DEDENT, SOFT_NEWLINE, OPEN_PAREN, CLOSE_PAREN,
             OPEN_BRACKET, CLOSE_BRACKET, OPEN_BRACE, CLOSE_BRACE, WHITESPACE, HYPHENATED_KEYWORD, MISSING_DELIMITER };
// Tree-sitter bounds serialized scanner state. Refuse an unrepresentable stack
// rather than silently truncating it. The Rust lexer has no such editor limit.
#define MAX_LEVELS ((TREE_SITTER_SERIALIZATION_BUFFER_SIZE - 20) / 4)
typedef struct {
  uint32_t levels[MAX_LEVELS];
  uint32_t count, grouping, target;
  // Column after the last logical newline, plus one (zero means unknown).
  // Tree-sitter resets columns only on LF; Quarry normalizes lone CR too.
  uint32_t line_start;
  // Keep completed layout across extras until the destination significant line
  // ends. In particular, an off-stack dedent must not re-open a rounded block.
  bool pending, laid_out;
} Scanner;
void *tree_sitter_quarry_external_scanner_create(void) {
  Scanner *s = calloc(1, sizeof(Scanner));
  s->count = 1;
  return s;
}
void tree_sitter_quarry_external_scanner_destroy(void *payload) { free(payload); }
unsigned tree_sitter_quarry_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *s = payload;
  uint32_t header[] = {s->count, s->grouping, s->target, s->pending | (s->laid_out << 1), s->line_start};
  memcpy(buffer, header, sizeof(header));
  memcpy(buffer + sizeof(header), s->levels, s->count * 4);
  return sizeof(header) + s->count * 4;
}
void tree_sitter_quarry_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *s = payload;
  memset(s, 0, sizeof(*s)); s->count = 1;
  if (length < 24) return;
  uint32_t header[5]; memcpy(header, buffer, sizeof(header));
  if (!header[0] || header[0] > MAX_LEVELS || length != 20 + header[0] * 4) return;
  s->count = header[0]; s->grouping = header[1]; s->target = header[2]; s->pending = header[3] & 1; s->laid_out = header[3] & 2; s->line_start = header[4];
  memcpy(s->levels, buffer + 20, s->count * 4);
}
static void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static bool eol(TSLexer *lexer) { return lexer->lookahead == '\n' || lexer->lookahead == '\r'; }
// lexer.rs uses str::trim_start before its spaces/tabs indentation count.
// Rust's Unicode White_Space property also makes these blank/comment prefixes
// ignorable. They are not whitespace between ordinary Quarry tokens.
static bool trim_space(int32_t c) {
  return c == ' ' || c == '\t' || c == 0x0b || c == 0x0c || c == 0x85 ||
         c == 0xa0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
         c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000;
}
static bool word_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '_' || c == '-';
}
static void skip_eol(TSLexer *lexer) {
  // lexer.rs::lex normalizes CRLF and lone CR to LF before inspecting lines.
  int32_t first = lexer->lookahead; advance(lexer);
  if (first == '\r' && lexer->lookahead == '\n') advance(lexer);
}
static bool layout(Scanner *s, TSLexer *lexer, const bool *valid) {
  uint32_t top = s->levels[s->count - 1];
  if (s->target > top) {
    if (!valid[INDENT] || s->count == MAX_LEVELS) return false;
    s->levels[s->count++] = s->target; s->pending = false; s->laid_out = true;
    lexer->result_symbol = INDENT; return true;
  }
  if (s->target < top) {
    if (!valid[DEDENT]) return false;
    --s->count;
    lexer->result_symbol = DEDENT; return true;
  }
  s->pending = false;
  return false;
}
bool tree_sitter_quarry_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid) {
  Scanner *s = payload;
  // Do not mutate state during Tree-sitter's all-symbols error recovery probe.
  if (valid[NEWLINE] && valid[INDENT] && valid[DEDENT]) return false;
  lexer->mark_end(lexer);
  if (s->pending && s->target != s->levels[s->count - 1]) return layout(s, lexer, valid);
  if (s->pending) s->laid_out = true;
  s->pending = false;
  bool line_start = lexer->get_column(lexer) == 0 || s->line_start == lexer->get_column(lexer) + 1;
  uint32_t leading = 0;
  bool other_space = false;
  while (trim_space(lexer->lookahead)) {
    // lexer.rs::lex: leading tabs diagnose; inline tabs are whitespace.
    other_space |= lexer->lookahead != ' ' && lexer->lookahead != '\t';
    ++leading; advance(lexer);
  }
  // lexer.rs checks blank/comment-only lines before diagnosing leading tabs.
  if (other_space && !line_start) return false;
  if (line_start && other_space && !lexer->eof(lexer) && !eol(lexer)) {
    lexer->mark_end(lexer);
    if (lexer->lookahead != '-') return false;
    advance(lexer);
    if (lexer->lookahead != '-') return false;
    lexer->result_symbol = WHITESPACE; return valid[WHITESPACE];
  }
  if (line_start && !s->laid_out && leading > s->levels[s->count - 1] && !s->grouping && valid[INDENT] && !lexer->eof(lexer) && !eol(lexer)) {
    if (lexer->lookahead == '-') {
      lexer->mark_end(lexer); advance(lexer);
      if (lexer->lookahead == '-') {
        lexer->result_symbol = WHITESPACE; return valid[WHITESPACE];
      }
    }
    s->target = leading; s->pending = true;
    return layout(s, lexer, valid);
  }
  if (leading && valid[WHITESPACE]) {
    lexer->mark_end(lexer); lexer->result_symbol = WHITESPACE; return true;
  }
  // lexer.rs::lex: ([{ increment grouping; )]} decrement it. Strings/comments
  // are internal whole tokens, so their delimiters never reach this branch.
  const char *brackets = "()[]{}";
  for (unsigned i = 0; i < 6; ++i) {
    if (lexer->lookahead != brackets[i] || !valid[OPEN_PAREN + i]) continue;
    if (i % 2 && !s->grouping) return false;
    if (i % 2) --s->grouping; else ++s->grouping;
    advance(lexer); lexer->mark_end(lexer);
    lexer->result_symbol = OPEN_PAREN + i; return true;
  }
  if (lexer->eof(lexer)) {
    if (s->grouping && valid[MISSING_DELIMITER]) {
      --s->grouping; lexer->result_symbol = MISSING_DELIMITER; return true;
    }
    // lexer.rs::lex: a significant final line gets Newline even without LF;
    // all outstanding blocks then Dedent before Eof, even after an unclosed group.
    // Let the parser insert its local missing delimiter while retaining layout.
    if (valid[NEWLINE]) { lexer->result_symbol = NEWLINE; return true; }
    if (s->count > 1 && valid[DEDENT]) {
      --s->count; lexer->result_symbol = DEDENT; return true;
    }
    return false;
  }
  if (valid[HYPHENATED_KEYWORD] && word_char(lexer->lookahead)) {
    // External lookahead enforces the Rust lexer's complete trailing boundary;
    // a failed candidate leaves ordinary words/minus operators to the lexer.
    for (unsigned i = 0; i < sizeof(hyphenated_words) / sizeof(*hyphenated_words); ++i) {
      const char *word = hyphenated_words[i];
      if (lexer->lookahead != *word) continue;
      for (; *word; ++word) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
      }
      if (word_char(lexer->lookahead)) return false;
      lexer->mark_end(lexer); lexer->result_symbol = HYPHENATED_KEYWORD; return true;
    }
  }
  if (!eol(lexer)) return false;
  skip_eol(lexer); lexer->mark_end(lexer);
  s->line_start = lexer->get_column(lexer) + 1;
  if (s->grouping) {
    // lexer.rs::lex: grouping != 0 suppresses newlines and indentation.
    lexer->result_symbol = SOFT_NEWLINE; return valid[SOFT_NEWLINE];
  }
  uint32_t indent = 0;
  bool dash = false;
  for (;;) {
    indent = 0;
    bool unicode_indent = false;
    while (trim_space(lexer->lookahead)) {
      unicode_indent |= lexer->lookahead != ' ' && lexer->lookahead != '\t'; ++indent; advance(lexer);
    }
    if (eol(lexer)) { skip_eol(lexer); continue; }
    // lexer.rs::lex: blank and trimmed -- lines are ignored for layout.
    // Look ahead but retain mark_end: comments remain visible named extras.
    if (lexer->lookahead == '-') {
      advance(lexer);
      if (lexer->lookahead != '-') { if (unicode_indent) return false; dash = true; break; }
      while (!lexer->eof(lexer) && !eol(lexer)) advance(lexer);
      if (!lexer->eof(lexer)) { skip_eol(lexer); continue; }
    }
    if (unicode_indent && !lexer->eof(lexer)) return false;
    break;
  }
  if (lexer->eof(lexer)) indent = 0;
  // lexer.rs::lex `continues`: deeper {, exact "and " or "or " removes
  // the preceding Newline and leaves the indentation stack unchanged.
  bool continues = !dash && lexer->lookahead == '{';
  if (!continues && !dash && (lexer->lookahead == 'a' || lexer->lookahead == 'o')) {
    const char *word = lexer->lookahead == 'a' ? "and " : "or ";
    continues = true;
    for (; *word; ++word) {
      if (lexer->lookahead != *word) { continues = false; break; }
      advance(lexer);
    }
  }
  if (continues && indent > s->levels[s->count - 1] && valid[NEWLINE]) {
    lexer->result_symbol = SOFT_NEWLINE; return valid[SOFT_NEWLINE];
  }
  if (valid[NEWLINE]) {
    // Rust emits dedents before diagnosing an off-stack indentation. It stops
    // at the nearest lower enclosing level, without introducing a new indent.
    if (indent < s->levels[s->count - 1]) {
      uint32_t level = s->count - 1;
      while (s->levels[level] > indent) --level;
      indent = s->levels[level];
    }
    s->target = indent; s->pending = true; s->laid_out = false;
    lexer->result_symbol = NEWLINE; return true;
  }
  lexer->result_symbol = SOFT_NEWLINE; return valid[SOFT_NEWLINE];
}
