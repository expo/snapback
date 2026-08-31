// Assembles per-arm prompt files from tasks.md + the briefs.
// Usage: node assemble.mjs   (writes prompts/{A,B,C}-T##.md next to this file)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");

const tsApi = read("ts-api.md");
const tsPolicy = read("ts-policy.md");
const quarrySpec = read("quarry-spec.md");
const tasksDoc = read("tasks.md");

const HEADER = `You are an expert backend engineer. Below is the complete reference for the
data-program system this app is built on, followed by one task. This is a
one-shot exercise: you cannot run a compiler, look anything up, or ask
questions — your first attempt is graded exactly as written.
`;

const OUT_TS = `## Output

Reply with exactly one \`\`\`ts code block containing a complete,
self-contained module: first the given schema declarations (copied verbatim),
then any schema additions you need (tables, maintained aggregates; note added
indexes in comments), then your exported program(s). At most three sentences
of prose outside the block.`;

const OUT_QUARRY = `## Output

Reply with exactly one fenced code block containing a complete,
self-contained module: first the given schema (copied verbatim), then any
top-level additions you need (\`index\`, \`unique\`, \`maintain\`), then your
program(s). At most three sentences of prose outside the block.`;

// --- parse tasks.md ---
const tasks = [];
const parts = tasksDoc.split(/^## (T\d\d) — /m).slice(1);
for (let i = 0; i < parts.length; i += 2) {
  const id = parts[i];
  const body = parts[i + 1];
  const title = body.slice(0, body.indexOf("\n")).trim();
  const statement = body.match(/### statement\n([\s\S]*?)\n### /)[1].trim();
  const tsSchema = body.match(/### ts-schema\n```ts\n([\s\S]*?)```/)[1].trimEnd();
  const quarrySchema = body.match(/### quarry-schema\n```\n([\s\S]*?)```/)[1].trimEnd();
  tasks.push({ id, title, statement, tsSchema, quarrySchema });
}
if (tasks.length !== 10) throw new Error(`expected 10 tasks, parsed ${tasks.length}`);

const promptDir = join(here, "prompts");
mkdirSync(promptDir, { recursive: true });

const taskSection = (t, schema, lang) => `# The app: ${t.title}

## Given schema

\`\`\`${lang}
${schema}
\`\`\`

## Task

${t.statement}

${lang === "ts" ? OUT_TS : OUT_QUARRY}
`;

for (const t of tasks) {
  writeFileSync(
    join(promptDir, `A-${t.id}.md`),
    [HEADER, tsApi, taskSection(t, t.tsSchema, "ts")].join("\n\n"),
  );
  writeFileSync(
    join(promptDir, `B-${t.id}.md`),
    [HEADER, tsApi, tsPolicy, taskSection(t, t.tsSchema, "ts")].join("\n\n"),
  );
  writeFileSync(
    join(promptDir, `C-${t.id}.md`),
    [HEADER, quarrySpec, taskSection(t, t.quarrySchema, "")].join("\n\n"),
  );
}
console.log(`wrote ${tasks.length * 3} prompts to ${promptDir}`);
