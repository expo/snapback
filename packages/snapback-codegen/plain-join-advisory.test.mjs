import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import { extractInlineHandlers } from './inline-handlers.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageDir, '..', '..');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dirs = [];
const advisoryCode = 'SNAPBACK_AUTHORING_PLAIN_JOIN_RELATIONAL_QUERY';

const baseSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const books = defineTable({
  title: v.string(),
  authorSlug: v.string(),
}).index('by_title', ['title']).visibility({ kind: 'public-read' }).sync();
export const authors = defineTable({
  slug: v.string(),
  name: v.string(),
}).index('by_slug', ['slug'], { unique: true }).visibility({ kind: 'public-read' }).sync();
export default defineSchema({ books, authors });
`;

const resultContract = `results.records(v.object({
  title: v.string(),
  authorName: v.union([v.null(), v.string()]),
  shelf: v.literal('fiction'),
  featured: v.literal(true),
  edition: v.literal(1),
  note: v.literal(null),
}), { minItems: 0, maxItems: 50 })`;

const positiveHandler = `async (ctx) => {
  const books = await ctx.db.query('books').withIndex('by_title').take(50).collect();
  const rows = [];
  for (const book of books) {
    const author = await ctx.db.query('authors').withIndex('by_slug').eq('slug', book.authorSlug).first();
    rows.push({
      title: book.title,
      authorName: author?.name ?? null,
      shelf: 'fiction',
      featured: true,
      edition: 1,
      note: null,
    });
  }
  return rows;
}`;

function jsDefinition({
  handler = positiveHandler,
  auth = "'public'",
  args = '{}',
  reads = "['books', 'authors']",
  result = resultContract,
  defaultLive = '',
} = {}) {
  return `
import { defineJsLiveQuery, results, v } from '${defineUrl}';
export const booksWithAuthors = defineJsLiveQuery({
  auth: ${auth},
  args: ${args},
  reads: ${reads},
  result: ${result},
  ${defaultLive}
  handler: ${handler},
});
`;
}

async function generateCase({ schema = baseSchema, functions }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-plain-join-advisory-'));
  dirs.push(dir);
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  return generate(dir);
}

function extractedCandidate(handler) {
  const extracted = extractInlineHandlers(jsDefinition({ handler }), {
    path: 'functions.mjs',
  });
  return extracted.handlers.get('booksWithAuthors')?.plainJoinCandidate ?? null;
}

try {
  // The positive fixture first proves that the exact target declaration is
  // admitted by the shipped builder. Only then does the equivalent inline
  // fixture earn the advisory.
  const relational = await generateCase({
    functions: `
import schema from './schema.mjs';
import { defineRelationalQuery } from '${defineUrl}';
export const booksWithAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'left',
  visibility: {
    root: { kind: 'public-read' },
    joined: { kind: 'public-read' },
    output: 'public-read',
  },
  projection: {
    title: { root: 'title' },
    authorName: { joined: 'name' },
    shelf: { literal: 'fiction' },
    featured: { literal: true },
    edition: { literal: 1 },
    note: { literal: null },
  },
  take: 50,
  rootIndex: 'by_title',
  joinedIndex: 'by_slug',
});
`,
  });
  assert.equal(relational.ok, true, JSON.stringify(relational.diagnostics));
  assert.equal(
    relational.diagnostics.some(({ code }) => code === advisoryCode),
    false,
    'the relational declaration never advises about itself',
  );

  const positive = await generateCase({ functions: jsDefinition() });
  assert.equal(positive.ok, true, JSON.stringify(positive.diagnostics));
  const advisory = positive.diagnostics.find(({ code }) => code === advisoryCode);
  assert(advisory, JSON.stringify(positive.diagnostics));
  assert.equal(advisory.severity, 'warning');
  assert.deepEqual(advisory.sourceSpan, { file: 'functions.mjs', line: 16, column: 12 });
  assert.deepEqual(
    {
      proof: advisory.details.proof,
      root: advisory.details.root,
      rootIndex: advisory.details.rootIndex,
      joined: advisory.details.joined,
      joinedIndex: advisory.details.joinedIndex,
      join: advisory.details.join,
      kind: advisory.details.kind,
      take: advisory.details.take,
      visibility: advisory.details.visibility,
    },
    {
      proof: 'defineRelationalQuery.left.public.v1',
      root: 'books',
      rootIndex: 'by_title',
      joined: 'authors',
      joinedIndex: 'by_slug',
      join: [{ root: 'authorSlug', joined: 'slug' }],
      kind: 'left',
      take: 50,
      visibility: {
        root: { kind: 'public-read' },
        joined: { kind: 'public-read' },
        output: 'public-read',
      },
    },
  );
  assert.deepEqual(
    advisory.details.remediations.map(({ kind, pageId, anchor }) => ({
      remediationKind: kind,
      pageId,
      anchor,
    })),
    [{
      remediationKind: 'guidePointer',
      pageId: 'backend.relational-queries',
      anchor: 'recognize-the-messaging-shape',
    }],
  );

  // Closed AST negatives: every construct the ticket excludes breaks the
  // syntax proof before schema facts can make it eligible.
  const astNegatives = new Map([
    ['residual root filter', positiveHandler.replace(
      ".withIndex('by_title').take(50)",
      ".withIndex('by_title').eq('title', 'A').take(50)",
    )],
    ['explicit root ordering', positiveHandler.replace(
      ".withIndex('by_title').take(50)",
      ".withIndex('by_title').order('title', 'desc').take(50)",
    )],
    ['ctx.db.get without a declared unique-index proof', positiveHandler.replace(
      "ctx.db.query('authors').withIndex('by_slug').eq('slug', book.authorSlug).first()",
      "ctx.db.get('authors', book.authorSlug)",
    )],
    ['missing-row behavior is not represented', positiveHandler.replace(
      'author?.name ?? null',
      'author.name',
    )],
    ['row-dependent branch', positiveHandler.replace(
      '    rows.push({',
      '    if (author === null) continue;\n    rows.push({',
    )],
    ['write', positiveHandler.replace(
      '    rows.push({',
      "    await ctx.db.patch('books', book._id, { title: book.title });\n    rows.push({",
    )],
    ['aggregation', positiveHandler.replace(
      '  const rows = [];',
      '  const rows = [];\n  const count = books.length;',
    )],
    ['helper call', positiveHandler.replace('title: book.title', 'title: String(book.title)')],
    ['extra table access', positiveHandler.replace(
      '  const rows = [];',
      "  const rows = [];\n  await ctx.db.query('notes').take(1).collect();",
    )],
    ['post-projection transform', positiveHandler.replace('return rows;', 'return rows.sort();')],
  ]);
  for (const [label, handler] of astNegatives) {
    assert.equal(extractedCandidate(handler), null, `${label} must not produce AST facts`);
  }

  // Schema/declaration negatives pair the same positive AST with one missing
  // non-AST fact. Generation remains admitted, but the warning stays silent.
  const schemaNegatives = [
    {
      label: 'authored args',
      functions: jsDefinition({ args: '{ unused: v.string() }' }),
    },
    {
      label: 'live delivery policy override',
      functions: jsDefinition({ defaultLive: 'defaultLive: false,' }),
    },
    {
      label: 'non-public visibility is not guessed',
      functions: jsDefinition({ auth: "'authenticated'" }),
    },
    {
      label: 'declared read closure has an extra table',
      schema: baseSchema.replace(
        'export default defineSchema({ books, authors });',
        "export const notes = defineTable({ body: v.string() }).visibility({ kind: 'public-read' });\nexport default defineSchema({ books, authors, notes });",
      ),
      functions: jsDefinition({ reads: "['books', 'authors', 'notes']" }),
    },
    {
      label: 'joined index is not unique',
      schema: baseSchema.replace(".index('by_slug', ['slug'], { unique: true })", ".index('by_slug', ['slug'])"),
      functions: jsDefinition(),
    },
    {
      label: 'unique index has a wider key than the lookup',
      schema: baseSchema.replace(".index('by_slug', ['slug'], { unique: true })", ".index('by_slug', ['slug', 'name'], { unique: true })"),
      functions: jsDefinition(),
    },
    {
      label: 'join key types differ',
      schema: baseSchema.replace('slug: v.string(),', 'slug: v.integer(),'),
      functions: jsDefinition(),
    },
    {
      label: 'root join key is optional',
      schema: baseSchema.replace('authorSlug: v.string(),', 'authorSlug: v.optional(v.string()),'),
      functions: jsDefinition(),
    },
    {
      label: 'projected root field is optional',
      schema: baseSchema.replace('title: v.string(),', 'title: v.optional(v.string()),'),
      functions: jsDefinition(),
    },
    {
      label: 'authored result contract differs from relational output',
      functions: jsDefinition({
        result: resultContract.replace(
          'authorName: v.union([v.null(), v.string()])',
          'authorName: v.string()',
        ),
      }),
    },
  ];
  for (const fixture of schemaNegatives) {
    const result = await generateCase({
      schema: fixture.schema ?? baseSchema,
      functions: fixture.functions,
    });
    assert.equal(result.ok, true, `${fixture.label}: ${JSON.stringify(result.diagnostics)}`);
    assert.equal(
      result.diagnostics.some(({ code }) => code === advisoryCode),
      false,
      `${fixture.label} must not advise`,
    );
  }

  const selfJoinHandler = positiveHandler
    .replace("query('authors').withIndex('by_slug')", "query('books').withIndex('by_author_slug')")
    .replace('author?.name ?? null', 'author?.title ?? null');
  const selfJoinSchema = baseSchema
    .replace(".index('by_title', ['title']).sync()", ".index('by_title', ['title']).index('by_author_slug', ['authorSlug'], { unique: true }).sync()");
  const selfJoin = await generateCase({
    schema: selfJoinSchema,
    functions: jsDefinition({ handler: selfJoinHandler, reads: "['books']" }),
  });
  assert.equal(selfJoin.ok, true, JSON.stringify(selfJoin.diagnostics));
  assert.equal(selfJoin.diagnostics.some(({ code }) => code === advisoryCode), false);

  // Preserve the falsification corpus from the ticket: every demo function
  // source plus every existing JS source named by the generated Guide is
  // scanned. Zero AST candidates is stronger than zero emitted warnings,
  // because no schema can promote a source that never crosses this seam.
  const corpus = new Set();
  const visitDemoFunctions = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'runtime-artifacts') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visitDemoFunctions(path);
      if (entry.isFile() && basename(path) === 'functions.mjs') corpus.add(path);
    }
  };
  visitDemoFunctions(join(repoRoot, 'demos'));
  const manifest = JSON.parse(readFileSync(
    join(repoRoot, 'guide', 'guide-manifest.generated.json'),
    'utf8',
  ));
  for (const page of Object.values(manifest.pages)) {
    for (const snippet of page.snippets ?? []) {
      if (
        typeof snippet.source !== 'string'
        || !['.js', '.mjs', '.cjs'].includes(extname(snippet.source))
      ) continue;
      const path = join(repoRoot, snippet.source);
      if (existsSync(path)) corpus.add(path);
    }
  }
  assert(corpus.size >= 112, `expected at least the ticket's 112-source corpus, found ${corpus.size}`);
  const corpusCandidates = [];
  for (const path of [...corpus].sort()) {
    const source = readFileSync(path, 'utf8');
    const extracted = extractInlineHandlers(source, { path: relative(repoRoot, path) });
    for (const handler of extracted.handlers.values()) {
      if (handler.plainJoinCandidate) {
        corpusCandidates.push(`${relative(repoRoot, path)}:${handler.name}`);
      }
    }
  }
  assert.deepEqual(corpusCandidates, [], `unexpected plain-join candidates: ${corpusCandidates.join(', ')}`);
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
