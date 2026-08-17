// Same-file helper sharing for inline handlers (LLP 0118 option 1a; LLP 0115
// CV-7; 0127 decision 6). The two motivating diary shapes are replicated as
// fixtures: Streak Lab's civil-date parser/inverse written once and used by
// both its query and mutation (Diary 0032), and Relay Board's indexed board
// reader shared by its view and summary queries (Diary 0033) — the latter a
// context-reader helper receiving `ctx.db`, admitted per 0127 decision 6 with
// declared reads/writes remaining evidence, not enforced ceilings.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const roots = [];
const backend = (schemaSource) => {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-inline-helper-'));
  roots.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schemaSource);
  return dir;
};

const streakSchema = `
  import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
  export default defineSchema({
    checkins: defineTable({ day: v.integer() }).visibility({ kind: 'public-read' }).sync(),
  });
`;

const relaySchema = `
  import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
  export default defineSchema({
    cards: defineTable({
      board: v.string(),
      title: v.string(),
      done: v.boolean(),
    }).visibility({ kind: 'public-read' }).sync(),
  });
`;

const todoSchema = `
  import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
  export default defineSchema({
    todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
  });
`;

// The Streak Lab shape: three calendar helpers, written once. The query
// reaches civilFromDay (and transitively daysInMonth); the mutation reaches
// dayNumber (and transitively daysInMonth). No helper text is duplicated in
// the authored file.
const streakFunctions = (marker = '') => `
  import { defineJsMutation, defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
  function daysInMonth(year, month) {
    if (month === 2) {
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      return leap ? 29 : 28;
    }
    if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
    return 31;${marker === 'daysInMonth' ? ' void 0;' : ''}
  }
  function dayNumber(year, month, day) {
    let total = 0;
    for (let y = 1970; y < year; y += 1) {
      total += daysInMonth(y, 2) === 29 ? 366 : 365;
    }
    for (let m = 1; m < month; m += 1) total += daysInMonth(year, m);
    return total + (day - 1);${marker === 'dayNumber' ? ' void 0;' : ''}
  }
  function civilFromDay(day) {
    let remaining = day;
    let year = 1970;
    while (remaining >= (daysInMonth(year, 2) === 29 ? 366 : 365)) {
      remaining -= daysInMonth(year, 2) === 29 ? 366 : 365;
      year += 1;
    }
    let month = 1;
    while (remaining >= daysInMonth(year, month)) {
      remaining -= daysInMonth(year, month);
      month += 1;
    }
    const dayOfMonth = remaining + 1;
    const monthText = month < 10 ? '0' + month : '' + month;
    const dayText = dayOfMonth < 10 ? '0' + dayOfMonth : '' + dayOfMonth;
    return year + '-' + monthText + '-' + dayText;${marker === 'civilFromDay' ? ' void 0;' : ''}
  }
  export const streakView = defineJsQuery({
    args: {},
    reads: ['checkins'],
    result: results.records(v.object({ day: v.integer(), civil: v.string() })),
    handler: async (ctx) => {
      const rows = await ctx.db.query('checkins').collect();
      return rows.map((row) => ({ day: row.day, civil: civilFromDay(row.day) }));
    },
  });
  export const checkIn = defineJsMutation({
    args: { year: v.integer(), month: v.integer(), day: v.integer() },
    writes: ['checkins'],
    result: results.value(v.id('checkins')),
    handler: async (ctx, args) => ctx.db.insert('checkins', {
      day: dayNumber(args.year, args.month, args.day),
    }),
  });
`;

// The Relay Board shape: one context-reader helper receiving ctx.db, shared
// by the view query, the summary query, and a live query.
const relayFunctions = `
  import { defineJsLiveQuery, defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
  async function boardCards(db, board) {
    const rows = await db.query('cards').collect();
    return rows.filter((row) => row.board === board);
  }
  export const boardView = defineJsQuery({
    args: { board: v.string() },
    reads: ['cards'],
    result: results.documents('cards'),
    handler: async (ctx, args) => boardCards(ctx.db, args.board),
  });
  export const boardSummary = defineJsQuery({
    args: { board: v.string() },
    reads: ['cards'],
    result: results.records(v.object({ board: v.string(), total: v.integer() })),
    handler: async (ctx, args) => {
      const rows = await boardCards(ctx.db, args.board);
      return [{ board: args.board, total: rows.length }];
    },
  });
  export const watchBoard = defineJsLiveQuery({
    args: { board: v.string() },
    reads: ['cards'],
    result: results.documents('cards'),
    handler: async (ctx, args) => boardCards(ctx.db, args.board),
  });
`;

const manifestOf = (dir) => JSON.parse(
  readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
);
const fnEntry = (manifest, name) => manifest.functions.find((fn) => fn.name === name);
const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

try {
  // --- Streak Lab: helper written once, used by query and mutation ----------
  {
    const dir = backend(streakSchema);
    writeFileSync(join(dir, 'functions.mjs'), streakFunctions());
    let generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const manifestPath = join(dir, 'generated', 'functions.manifest.json');
    const firstBytes = readFileSync(manifestPath, 'utf8');
    const first = JSON.parse(firstBytes);
    const query = fnEntry(first, 'streakView');
    const mutation = fnEntry(first, 'checkIn');
    assert.equal(query.handlerForm, 'inline');
    assert.equal(mutation.handlerForm, 'inline');

    // Each operation's emitted artifact contains exactly its own reachable
    // helper subset, one copy of each helper.
    const querySource = query.runtime.IbexModule.source;
    const mutationSource = mutation.runtime.IbexModule.source;
    assert.equal(countOccurrences(querySource, 'function civilFromDay'), 1);
    assert.equal(countOccurrences(querySource, 'function daysInMonth'), 1);
    assert.equal(
      countOccurrences(querySource, 'function dayNumber'),
      0,
      'the query does not reach dayNumber, so its module must not carry it',
    );
    assert.equal(countOccurrences(mutationSource, 'function dayNumber'), 1);
    assert.equal(countOccurrences(mutationSource, 'function daysInMonth'), 1);
    assert.equal(countOccurrences(mutationSource, 'function civilFromDay'), 0);
    assert.doesNotMatch(querySource, /\bexport\b/u);
    assert.doesNotMatch(mutationSource, /\bexport\b/u);
    assert.match(query.implementationHash, /^sha256:[0-9a-f]{64}$/u);
    assert(query.requiredCapabilities.includes('inline_handler_v1'));

    // Deterministic regeneration stays byte-identical.
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    assert.equal(readFileSync(manifestPath, 'utf8'), firstBytes);

    // Exact per-operation invalidation: editing civilFromDay re-hashes only
    // the query; editing dayNumber re-hashes only the mutation; editing the
    // shared transitive helper re-hashes both.
    writeFileSync(join(dir, 'functions.mjs'), streakFunctions('civilFromDay'));
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const afterCivil = manifestOf(dir);
    assert.notEqual(fnEntry(afterCivil, 'streakView').implementationHash, query.implementationHash);
    assert.equal(fnEntry(afterCivil, 'checkIn').implementationHash, mutation.implementationHash);

    writeFileSync(join(dir, 'functions.mjs'), streakFunctions('dayNumber'));
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const afterDayNumber = manifestOf(dir);
    assert.equal(fnEntry(afterDayNumber, 'streakView').implementationHash, query.implementationHash);
    assert.notEqual(fnEntry(afterDayNumber, 'checkIn').implementationHash, mutation.implementationHash);

    writeFileSync(join(dir, 'functions.mjs'), streakFunctions('daysInMonth'));
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const afterShared = manifestOf(dir);
    assert.notEqual(fnEntry(afterShared, 'streakView').implementationHash, query.implementationHash);
    assert.notEqual(fnEntry(afterShared, 'checkIn').implementationHash, mutation.implementationHash);
  }

  // --- Relay Board: a context-reader helper shared by three operations ------
  {
    const dir = backend(relaySchema);
    writeFileSync(join(dir, 'functions.mjs'), relayFunctions);
    const generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const manifest = manifestOf(dir);
    for (const name of ['boardView', 'boardSummary', 'watchBoard']) {
      const entry = fnEntry(manifest, name);
      assert.equal(entry.handlerForm, 'inline', name);
      assert.equal(countOccurrences(entry.runtime.IbexModule.source, 'function boardCards'), 1, name);
      // Declared reads stay evidence exactly as authored (basis: 'declared');
      // admitting the context-reader helper adds no enforcement change.
      assert.deepEqual(entry.readSetSummary.tables, ['cards'], name);
    }
    assert.equal(fnEntry(manifest, 'watchBoard').kind, 'LiveQuery');
  }

  // --- Helpers used only at definition time are not admitted or analyzed ----
  {
    const dir = backend(todoSchema);
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      function makeArgs() {
        return { title: v.string() };
      }
      export const listTodos = defineJsQuery({
        args: makeArgs(),
        reads: ['todos'],
        result: results.documents('todos'),
        handler: async (ctx) => ctx.db.query('todos').collect(),
      });
    `);
    const generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const manifest = manifestOf(dir);
    assert.equal(
      countOccurrences(fnEntry(manifest, 'listTodos').runtime.IbexModule.source, 'makeArgs'),
      0,
      'a definition-time-only helper must not be spliced into the runtime module',
    );
  }

  // --- The 2026-07-28 adversarial refusals hold across the helper boundary --
  {
    const dir = backend(todoSchema);
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results } from ${JSON.stringify(defineUrl)};
      function ok() { return 1; }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.documents('todos'),
        handler: async (ctx) => { ok(); return ctx.db.query('todos').collect(); },
      });
    `);
    let generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const manifestPath = join(dir, 'generated', 'functions.manifest.json');
    const lastGood = readFileSync(manifestPath, 'utf8');

    for (const [label, body] of [
      ['helper static constructor reflection', `return Object.constructor('return []')();`],
      ['helper computed concatenation', `const Ctor = Object['con' + 'structor']; return Ctor('return []')();`],
      ['helper dynamic computed key', `const key = ['con', 'structor'].join(''); const Ctor = Object[key]; return Ctor('return []')();`],
      ['helper destructured constructor', `const { constructor: Ctor } = async () => {}; return Ctor('return []')();`],
      ['helper destructuring assignment constructor', `let Ctor; ({ constructor: Ctor } = async () => {}); return Ctor('return []')();`],
      ['helper prototype reflection', `const proto = Object.getPrototypeOf(async () => {}); return proto.constructor('return []')();`],
      ['helper argument laundering', 'return input.constructor;'],
      ['helper eval', `return eval('[]');`],
      ['helper dynamic import', `return import('./x.mjs');`],
      ['helper class syntax', 'class Hidden {} return new Hidden();'],
      ['helper ambient this', 'return this.secret;'],
    ]) {
      writeFileSync(join(dir, 'functions.mjs'), `
        import { defineJsQuery, results } from ${JSON.stringify(defineUrl)};
        function laundry(input) { ${body} }
        export const listTodos = defineJsQuery({
          args: {},
          reads: ['todos'],
          result: results.documents('todos'),
          handler: async (ctx) => { laundry(ctx); return ctx.db.query('todos').collect(); },
        });
      `);
      generated = await generate(dir);
      assert.equal(generated.ok, false, `${label} unexpectedly generated`);
      assert(generated.diagnostics.some(
        ({ code, helper }) => (
          code === 'SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN' && helper === 'laundry'
        ),
      ), `${label} must refuse at the helper with the helper-scoped code`);
      assert.equal(readFileSync(manifestPath, 'utf8'), lastGood, label);
    }

    // Top-level const laundering stays closed: a const is not a spliceable
    // helper, so the handler refusal names the channel precisely.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results } from ${JSON.stringify(defineUrl)};
      const Ctor = Object.constructor;
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.documents('todos'),
        handler: async () => { Ctor('return []')(); return []; },
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, false);
    assert(generated.diagnostics.some(
      ({ code, identifiers, message }) => (
        code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
        && identifiers?.includes('Ctor')
        && /top-level const/u.test(message)
      ),
    ), 'a top-level const must stay outside the handler graph, with a precise hint');
    assert.equal(readFileSync(manifestPath, 'utf8'), lastGood);
  }

  // --- Precise inadmissibility diagnostics: cycles, non-function references,
  // --- duplicates, and self-recursion staying admitted ----------------------
  {
    const dir = backend(todoSchema);

    // Mutual recursion across the helper boundary refuses with the cycle path.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results } from ${JSON.stringify(defineUrl)};
      function pingPong(n) { return n <= 0 ? 0 : pongPing(n - 1); }
      function pongPing(n) { return n <= 0 ? 1 : pingPong(n - 1); }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.documents('todos'),
        handler: async (ctx) => { pingPong(2); return ctx.db.query('todos').collect(); },
      });
    `);
    let generated = await generate(dir);
    assert.equal(generated.ok, false);
    assert(generated.diagnostics.some(
      ({ code, helpers }) => (
        code === 'SNAPBACK_INLINE_HELPER_CYCLE'
        && Array.isArray(helpers)
        && helpers.includes('pingPong')
        && helpers.includes('pongPing')
      ),
    ), 'a mutual-recursion cycle must refuse and name its members');

    // Self-recursion is a local reference, not a cycle edge.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }
      export const factorial = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: fact(5) }],
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    assert.equal(
      countOccurrences(
        fnEntry(manifestOf(dir), 'factorial').runtime.IbexModule.source,
        'function fact',
      ),
      1,
    );

    // A helper referencing a top-level const refuses at the helper with the
    // declaration kind named.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      const BASE = 10;
      function scaled(n) { return n * BASE; }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: scaled(2) }],
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, false);
    assert(generated.diagnostics.some(
      ({ code, helper, identifiers, message }) => (
        code === 'SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER'
        && helper === 'scaled'
        && identifiers?.includes('BASE')
        && /top-level const/u.test(message)
      ),
    ), 'a helper reaching a top-level const must refuse with the TDZ/laundering hint');

    // A handler referencing a top-level let keeps the stable free-identifier
    // code and gains the precise non-function hint.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      let counter = 0;
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: counter }],
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, false);
    assert(generated.diagnostics.some(
      ({ code, identifiers, message }) => (
        code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
        && identifiers?.includes('counter')
        && /top-level let/u.test(message)
      ),
    ));

    // Duplicate top-level declarations of a referenced helper are inadmissible.
    writeFileSync(join(dir, 'functions.mjs'), `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      function dup() { return 1; }
      function dup() { return 2; }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: dup() }],
      });
    `);
    generated = await generate(dir);
    assert.equal(generated.ok, false);
    assert(generated.diagnostics.some(
      ({ code, reference }) => (
        code === 'SNAPBACK_INLINE_HELPER_INADMISSIBLE' && reference === 'dup'
      ),
    ), 'duplicate helper declarations must refuse with the inadmissible-helper code');
  }

  // --- Capability rescan over the spliced bytes, mapped to authored spans ---
  {
    const dir = backend(todoSchema);
    const source = `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      function stamp() {
        return Date.now();
      }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: stamp() }],
      });
    `;
    writeFileSync(join(dir, 'functions.mjs'), source);
    const generated = await generate(dir);
    assert.equal(generated.ok, false);
    const expectedLine = source.slice(0, source.indexOf('Date.now')).split('\n').length;
    const issue = generated.diagnostics.find(({ code }) => code === 'BUNDLE_UNSUPPORTED_TIME');
    assert(issue, 'an ambient clock read inside a spliced helper must refuse');
    assert.equal(issue.helper, 'stamp');
    assert.equal(issue.sourceSpan.file, 'functions.mjs');
    assert.equal(
      issue.sourceSpan.line,
      expectedLine,
      'the refusal must map to the helper’s authored line, not the rendered module',
    );
  }

  // --- Export stripping and content identity across an export toggle -------
  {
    const dir = backend(todoSchema);
    const withExport = (exported) => `
      import { defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
      ${exported ? 'export ' : ''}function shared(n) { return n + 1; }
      export const listTodos = defineJsQuery({
        args: {},
        reads: ['todos'],
        result: results.records(v.object({ value: v.integer() })),
        handler: async () => [{ value: shared(1) }],
      });
    `;
    writeFileSync(join(dir, 'functions.mjs'), withExport(true));
    let generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const exportedEntry = fnEntry(manifestOf(dir), 'listTodos');
    assert.doesNotMatch(exportedEntry.runtime.IbexModule.source, /\bexport\b/u);
    assert.equal(countOccurrences(exportedEntry.runtime.IbexModule.source, 'function shared'), 1);

    writeFileSync(join(dir, 'functions.mjs'), withExport(false));
    generated = await generate(dir);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    assert.equal(
      fnEntry(manifestOf(dir), 'listTodos').implementationHash,
      exportedEntry.implementationHash,
      'toggling export on a helper must not change the operation’s content identity',
    );
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('inline helper sharing tests passed');
