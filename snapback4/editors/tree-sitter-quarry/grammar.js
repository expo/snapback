// @ref LLP 3000.041#2.3 — highlighting structure, never the parser of record.
// Hand-written structure. keywords.generated.js and src/keywords.generated.h
// hold generated lexical tables; regenerate them with scripts/generate-editor-grammar.mjs, not by hand.
const facts = require('./keywords.generated');
const words = values => token(choice(...values));
module.exports = grammar({
  name: 'quarry',
  externals: $ => [
    $._newline, $._indent, $._dedent, $._soft_newline,
    $._open_paren, $._close_paren, $._open_bracket, $._close_bracket,
    $._open_brace, $._close_brace, $._whitespace, $._hyphenated_keyword, $.missing_delimiter,
  ],
  extras: $ => [$._whitespace, $.comment, $._soft_newline],
  word: $ => $.identifier,
  rules: {
    // Excerpts in the published guide may start inside a table or operation.
    source_file: $ => repeat(choice($._line, $.block)),
    _line: $ => choice($.declaration, $.table_line, $.statement),
    declaration: $ => prec.right(3, seq($.declaration_keyword, optional(field('name', $.declaration_name)), optional($.expression), $._newline, optional($.block))),
    declaration_name: $ => prec(4, $._word),
    table_line: $ => prec.right(2, seq($.table_keyword, optional($.expression), $._newline, optional($.block))),
    statement: $ => prec.right(seq($.expression, $._newline, optional($.block))),
    block: $ => seq($._indent, repeat1($._line), $._dedent),
    // Expressions retain groups, reads, calls, shapes and fields. Operand/type
    // validity, arity, operator precedence and keyword context belong to Rust.
    expression: $ => repeat1($._atom),
    _atom: $ => choice($._word, $.number, $.string, $.operator, $.property, $.call, $.index_read, $.parenthesized, $.list, $.shape),
    _word: $ => choice($.identifier, $.keyword, $.table_keyword, $.declaration_keyword, $.type, $.builtin),
    property: $ => prec(3, seq('.', field('name', $._word))),
    call: $ => prec(2, seq(field('function', $._word), $.parenthesized)),
    index_read: $ => prec(2, seq(field('table', $._word), $.list)),
    // A local EOF recovery node preserves groups/blocks. Highlight and fence
    // queries treat missing_delimiter exactly like a built-in MISSING node.
    parenthesized: $ => seq(alias($._open_paren, '('), optional($.expression), choice(alias($._close_paren, ')'), $.missing_delimiter)),
    list: $ => seq(alias($._open_bracket, '['), optional($.expression), choice(alias($._close_bracket, ']'), $.missing_delimiter)),
    shape: $ => seq(alias($._open_brace, '{'), optional($.expression), choice(alias($._close_brace, '}'), $.missing_delimiter)),
    declaration_keyword: _ => words(facts.declaration_words),
    table_keyword: _ => words(facts.table_words),
    keyword: $ => choice(words([...facts.binding_words, ...facts.duration_units]), $._hyphenated_keyword),
    type: _ => words(facts.type_words),
    builtin: _ => words(facts.builtin_words),
    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
    number: _ => /[0-9]+(\.[0-9]+)?/,
    string: _ => choice(/"([^"\\\r\n]|\\[^\r\n])*"/, /'([^'\\\r\n]|\\[^\r\n])*'/),
    comment: _ => token(seq(facts.comment, /[^\r\n]*/)),
    operator: _ => choice('...', '..', ...facts.two_character_symbols, ...[...facts.symbols].filter(c => !'()[]{}'.includes(c))),
  },
});
