#!/usr/bin/env node
// FirstReadProfileV1 checks (LLP 0259 Rung A): steering byte budgets, the
// packet/stub transclusion identity between guide/start pages and template
// AGENTS.md, and the negative-vocabulary fence over first-read steering.
// @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends —
// maxBytes counts steering bytes actually delivered; edit targets are
// listed, never charged; transcluded packet bytes count once.
//
// Usage: node scripts/check-first-read.mjs [--check] [--write]
//   --write regenerates each template AGENTS.md (wrapper + transcluded
//   packet + digest comment) and the digests in first-read-profiles.json
//   from the canonical guide/start pages, then re-checks.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './guide-lib.mjs';

const STEERING_CEILING_BYTES = 16384; // 16 KiB hard ceiling per profile
const PACKET_CAP_BYTES = 6144; // full start packet <= 6 KiB
const STUB_CAP_BYTES = 1024; // stub <= 1 KiB
const MENTAL_MODEL_CAP_BYTES = 3072; // shared mental-model page <= 3 KiB
const SKILL_CAP_BYTES = 10240; // always-loaded skill body <= 10 KiB

const PROFILES_PATH = 'guide/start/first-read-profiles.json';
const MENTAL_MODEL_PATH = 'guide/start/mental-model.md';
const SKILL_PATHS = [
  'skills/snapback-authoring/SKILL.md',
  'packages/snapback-cli/skills/snapback-authoring/SKILL.md',
];

const root = repoRoot();
const write = process.argv.includes('--write');
const errors = [];

const read = (path) => readFileSync(join(root, path), 'utf8');
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The transclusion delivers the packet outside the guide tree, so relative
// corpus links are rewritten to served-guide paths — the same deterministic
// transform idea as renderScaffoldAuthoringSkill for the packaged skill.
function toDeliveredForm(packet) {
  return packet
    .replaceAll('](./', '](/_snapback/guide/start/')
    .replaceAll('](../', '](/_snapback/guide/')
    // Template-owned repo links become scaffold-relative without rewriting prose.
    .replaceAll(
      /\]\(repo:packages\/snapback-cli\/templates\/[^/]+\/([^)]+)\)/gu,
      '](./$1)',
    );
}

function extractPacket(source, template, path) {
  const begin = new RegExp(
    `<!-- start-packet:begin ${template}( digest=sha256:([0-9a-f]{64}))? -->\\n`,
    'u',
  );
  const match = begin.exec(source);
  if (!match) {
    errors.push(`${path}: missing '<!-- start-packet:begin ${template} -->' marker`);
    return null;
  }
  const start = match.index + match[0].length;
  const end = source.indexOf('<!-- start-packet:end -->', start);
  if (end < 0) {
    errors.push(`${path}: missing '<!-- start-packet:end -->' marker`);
    return null;
  }
  return { content: source.slice(start, end), digest: match[2] ?? null };
}

function stripStopFences(text) {
  // YAML frontmatter (the skill's trigger description, page metadata) is
  // alias/trigger vocabulary, not path steering — competitor spellings there
  // are deliberate grep vocabulary (LLP 0186 W2), so the fence skips it.
  const body = text.startsWith('---\n')
    ? text.slice(text.indexOf('\n---\n', 4) + 5)
    : text;
  return body.replaceAll(
    /<!-- llp0259:stop-fence -->[\s\S]*?<!-- \/llp0259:stop-fence -->/gu,
    '',
  );
}

// @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends —
// the negative-vocabulary fence: Familiar query()/useQuery may appear in
// first-read steering only inside an explicit stop fence.
const NEGATIVE_VOCABULARY = [
  { pattern: /\buseQuery\b/u, label: 'Familiar useQuery' },
  { pattern: /(?<![.\w])query\(/u, label: 'Familiar query()' },
  { pattern: /capability index first/iu, label: "retired 'capability index first' steering" },
  { pattern: /guide-flat/u, label: 'bulk flat projection steering' },
];

function checkVocabulary(path, text, { allowFamiliar = false } = {}) {
  const fenced = stripStopFences(text);
  for (const { pattern, label } of NEGATIVE_VOCABULARY) {
    if (allowFamiliar && label.startsWith('Familiar ')) continue;
    if (pattern.test(fenced)) {
      errors.push(`${path}: ${label} appears outside an llp0259:stop-fence`);
    }
  }
}

function wrapperFor(template) {
  return [
    '## Operate it',
    '',
    '`snapback mcp` serves read-only Guide resources; `snapback mcp-control` adds',
    'typed control tools with local admin authority. Preview setup with',
    '`snapback agent setup --print <client> --server mcp-control`. With the dev',
    'server running this packet is served at',
    `\`http://127.0.0.1:4287/_snapback/guide/start/${template}.md\` (replace the`,
    'origin if startup selected another port); `snapback guide <query>` is the',
    'budgeted lookup channel.',
    '',
    'This app ships the `snapback-authoring` agent skill at',
    '`.claude/skills/snapback-authoring/SKILL.md` (mirrored under `.agents/`,',
    '`.cursor/`, and `.opencode/`); it repeats this packet-first contract.',
    '',
  ].join('\n');
}

function renderAgents(template, delivered, digest) {
  return [
    '# Building this Snapback app',
    '',
    '<!-- @ref LLP 0259#1-first-read-contract — the transcluded start packet is the whole required first read; escalate one page at a time, never a linear capability-index read. -->',
    `<!-- start-packet:begin ${template} digest=sha256:${digest} -->`,
    delivered.trimEnd(),
    '<!-- start-packet:end -->',
    '',
    wrapperFor(template),
  ].join('\n');
}

let profiles;
try {
  profiles = JSON.parse(read(PROFILES_PATH));
} catch (error) {
  console.error(`[first-read] error: ${PROFILES_PATH}: ${error.message}`);
  process.exit(1);
}
if (profiles.schemaVersion !== 'snapback.first-read-profile.v1') {
  errors.push(`${PROFILES_PATH}: unexpected schemaVersion ${profiles.schemaVersion}`);
}
const templates = Object.keys(profiles.profiles ?? {}).sort();
const shipped = ['crud-dashboard', 'expo-chat', 'familiar-react', 'media-feed', 'react', 'todo-contract'];
if (JSON.stringify(templates) !== JSON.stringify(shipped)) {
  errors.push(`${PROFILES_PATH}: profiles must cover exactly the shipped templates (${shipped.join(', ')})`);
}

for (const skillPath of SKILL_PATHS) {
  const size = bytes(read(skillPath));
  if (size > SKILL_CAP_BYTES) {
    errors.push(`${skillPath}: always-loaded skill body ${size} > ${SKILL_CAP_BYTES} bytes`);
  }
}
const mentalModelBytes = bytes(read(MENTAL_MODEL_PATH));
if (mentalModelBytes > MENTAL_MODEL_CAP_BYTES) {
  errors.push(`${MENTAL_MODEL_PATH}: mental-model page ${mentalModelBytes} > ${MENTAL_MODEL_CAP_BYTES} bytes`);
}

const profilesRaw = profiles;
let profilesDirty = false;
for (const template of templates) {
  const profile = profilesRaw.profiles[template];
  const pagePath = `guide/start/${template}.md`;
  const agentsPath = `packages/snapback-cli/templates/${template}/AGENTS.md`;
  if (!existsSync(join(root, pagePath))) {
    errors.push(`${pagePath}: missing start ${profile.depth} page`);
    continue;
  }
  const packet = extractPacket(read(pagePath), template, pagePath);
  if (!packet) continue;
  const delivered = toDeliveredForm(packet.content);
  const digest = sha256(delivered);

  if (write) {
    writeFileSync(join(root, agentsPath), renderAgents(template, delivered, digest));
    if (profile.digest !== `sha256:${digest}`) {
      profile.digest = `sha256:${digest}`;
      profilesDirty = true;
    }
  }

  const cap = profile.depth === 'packet' ? PACKET_CAP_BYTES : STUB_CAP_BYTES;
  const deliveredBytes = bytes(delivered);
  if (deliveredBytes > cap) {
    errors.push(`${pagePath}: ${profile.depth} ${deliveredBytes} > ${cap} bytes`);
  }
  if (profile.digest !== `sha256:${digest}`) {
    errors.push(`${PROFILES_PATH}: ${template} digest does not match the ${profile.depth} content — run --write`);
  }

  const agents = read(agentsPath);
  const transcluded = extractPacket(agents, template, agentsPath);
  if (transcluded) {
    if (transcluded.content.trimEnd() !== delivered.trimEnd()) {
      errors.push(`${agentsPath}: transcluded ${profile.depth} differs from ${pagePath} — run --write`);
    }
    if (transcluded.digest !== digest) {
      errors.push(`${agentsPath}: digest comment does not match the transcluded content — run --write`);
    }
  }
  // @ref LLP 0203#p5-the-first-hop-funnels-to-the-strongest-surface — carrier
  // wrappers keep both MCP authority postures and the agent setup preview
  // visible; packets never have to repeat them.
  for (const required of [
    '`snapback mcp` serves read-only Guide resources',
    '`snapback mcp-control` adds',
    'snapback agent setup --print',
    'snapback guide <query>',
    'snapback-authoring',
  ]) {
    if (!agents.includes(required)) {
      errors.push(`${agentsPath}: wrapper must keep '${required}'`);
    }
  }

  for (const target of profile.editTargets ?? []) {
    if (!existsSync(join(root, `packages/snapback-cli/templates/${template}/${target}`))) {
      errors.push(`${PROFILES_PATH}: ${template} editTargets names missing file ${target}`);
    }
  }
  if ((profile.editTargets ?? []).length === 0) {
    errors.push(`${PROFILES_PATH}: ${template} must list its edit targets (they are listed, not charged)`);
  }

  // Deduped steering aggregate: always-loaded skill + the AGENTS.md carrier
  // (its transcluded packet counts once — the contract says read AGENTS.md
  // *or* the packet) + the mental-model page on the stub route.
  const aggregate = bytes(read(SKILL_PATHS[0]))
    + bytes(read(agentsPath))
    + (profile.depth === 'stub' ? mentalModelBytes : 0);
  if (typeof profile.maxBytes !== 'number' || profile.maxBytes > STEERING_CEILING_BYTES) {
    errors.push(`${PROFILES_PATH}: ${template} maxBytes must be <= ${STEERING_CEILING_BYTES}`);
  } else if (aggregate > profile.maxBytes) {
    errors.push(`${agentsPath}: deduped steering aggregate ${aggregate} > maxBytes ${profile.maxBytes}`);
  }

  const allowFamiliar = profile.authoringProfile === 'familiar';
  checkVocabulary(agentsPath, agents, { allowFamiliar });
  checkVocabulary(pagePath, read(pagePath), { allowFamiliar });
}

if (write && profilesDirty) {
  writeFileSync(join(root, PROFILES_PATH), `${JSON.stringify(profilesRaw, null, 2)}\n`);
}

for (const path of [...SKILL_PATHS, MENTAL_MODEL_PATH, 'guide/start/index.md']) {
  checkVocabulary(path, read(path));
}

for (const line of errors) console.error(`[first-read] error: ${line}`);
console.log(`[first-read] ${errors.length === 0 ? 'ok' : 'FAILED'} — ${templates.length} profiles checked`);
process.exit(errors.length === 0 ? 0 : 1);
