#!/usr/bin/env node
// Rosetta record checks (LLP 0186 W2 amendment, OQ6 mechanism): validates
// guide/rosetta/records/*.json — the canonical per-journey records the
// Coming-from-Convex/Supabase hub page and its feature-page backlinks are
// checked against, so the competitor-vocabulary tier can't silently drift
// the way hand-maintained "Rosetta stone" tables do elsewhere.
// @ref LLP 0186#amendment-2026-08-06-w2-rosetta-section--worked-example-tier — the mechanism this implements.
//
// Usage: node scripts/check-rosetta.mjs [--check]
// (no flags and --check behave identically; --check is accepted so
// check-guide.mjs can invoke this the same way it invokes
// generate-control-catalog.mjs --check.)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCapabilityIndex, repoRoot } from './guide-lib.mjs';

const ROSETTA_DIR = 'guide/rosetta/records';
const HUB_PAGE = 'guide/recipes/coming-from-convex-and-supabase.md';
// The published authoring skill embeds a compact projection of these records
// (LLP 0186 W2: "the skill should embed the generated compact projection of
// each record rather than independently drafting its own translations") —
// checked here so the skill and the guide cannot drift apart.
const SKILL_PAGE = 'skills/snapback-authoring/SKILL.md';
const SKILL_BLOCK_BEGIN = '<!-- rosetta:begin -->';
const SKILL_BLOCK_END = '<!-- rosetta:end -->';
const REQUIRED_FIELDS = [
  'id', 'title', 'anchor', 'capabilities', 'aliases', 'competitor',
  'snapbackSources', 'backlinkPages', 'lastVerified', 'reviewBy',
];
const COMPETITOR_FIELDS = ['provider', 'version', 'sourceUrl', 'retrievedAt'];

function main() {
  const root = repoRoot();
  const errors = [];
  const dir = join(root, ROSETTA_DIR);

  if (!existsSync(dir)) {
    console.log(`check-rosetta: ${ROSETTA_DIR} does not exist yet — nothing to check`);
    return;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.log('check-rosetta: ok — 0 records, 0 errors');
    return;
  }

  const capIndexErrors = [];
  const capIndex = parseCapabilityIndex(root, capIndexErrors);
  errors.push(...capIndexErrors);

  const hubPath = join(root, HUB_PAGE);
  const hubExists = existsSync(hubPath);
  if (!hubExists) {
    errors.push(`${HUB_PAGE} does not exist but ${files.length} rosetta record(s) reference it`);
  }
  const hubBody = hubExists ? readFileSync(hubPath, 'utf8') : '';

  const seenIds = new Set();
  const records = [];
  for (const file of files) {
    const path = join(dir, file);
    const rel = `${ROSETTA_DIR}/${file}`;
    let record;
    try {
      record = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      errors.push(`${rel}: invalid JSON (${error.message})`);
      continue;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in record)) errors.push(`${rel}: missing required field "${field}"`);
    }
    if (!record.id) continue;
    if (`${record.id}.json` !== file) {
      errors.push(`${rel}: filename must match id ("${record.id}.json")`);
    }
    if (seenIds.has(record.id)) errors.push(`${rel}: duplicate id "${record.id}"`);
    seenIds.add(record.id);
    records.push(record);

    const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
    for (const capId of capabilities) {
      if (!capIndex.capabilities.has(capId)) {
        errors.push(`${rel}: capability "${capId}" not found in guide/capabilities.md`);
      }
    }

    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) {
      const routed = capabilities.some((capId) => {
        const cap = capIndex.capabilities.get(capId);
        return cap && cap.aliases.includes(alias);
      });
      if (!routed) {
        errors.push(
          `${rel}: alias "${alias}" does not appear in guide/capabilities.md's Aliases column for any ` +
          `of its listed capabilities (${capabilities.join(', ') || 'none'}) — an agent grepping this term ` +
          'is never routed anywhere near this journey',
        );
      }
    }

    for (const src of Array.isArray(record.snapbackSources) ? record.snapbackSources : []) {
      if (!existsSync(join(root, src))) {
        errors.push(`${rel}: snapbackSources entry does not exist: ${src}`);
      }
    }

    const anchorTarget = record.anchor ? `coming-from-convex-and-supabase.md#${record.anchor}` : null;
    for (const page of Array.isArray(record.backlinkPages) ? record.backlinkPages : []) {
      const pagePath = join(root, page);
      if (!existsSync(pagePath)) {
        errors.push(`${rel}: backlinkPages entry does not exist: ${page}`);
        continue;
      }
      const body = readFileSync(pagePath, 'utf8');
      if (anchorTarget && !body.includes(anchorTarget)) {
        errors.push(
          `${rel}: ${page} does not link to ${anchorTarget} — a reader following the capability's own ` +
          'feature page never sees the competitor-vocabulary journey exists',
        );
      }
    }

    if (hubExists && record.anchor) {
      const anchorMarker = `id="${record.anchor}"`;
      if (!hubBody.includes(anchorMarker)) {
        errors.push(
          `${rel}: ${HUB_PAGE} has no anchor matching \`${anchorMarker}\` — add ` +
          `<a id="${record.anchor}"></a> immediately before the journey's heading`,
        );
      }
    }

    const reviewBy = Date.parse(record.reviewBy);
    if (record.reviewBy && Number.isNaN(reviewBy)) {
      errors.push(`${rel}: reviewBy "${record.reviewBy}" is not a valid date`);
    } else if (record.reviewBy && reviewBy < Date.now()) {
      errors.push(
        `${rel}: reviewBy (${record.reviewBy}) has passed — re-verify the competitor side against current ` +
        'docs, then bump lastVerified/reviewBy, or file a drift ticket instead of leaving it stale',
      );
    }

    for (const competitor of Array.isArray(record.competitor) ? record.competitor : []) {
      for (const field of COMPETITOR_FIELDS) {
        if (!competitor[field]) {
          errors.push(`${rel}: competitor entry ${JSON.stringify(competitor.provider ?? '?')} missing "${field}"`);
        }
      }
    }
  }

  checkSkillProjection(root, records, errors);

  if (errors.length > 0) {
    console.error(`check-rosetta: ${errors.length} error(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-rosetta: ok — ${files.length} record(s), 0 errors`);
}

// The authoring skill's "Coming from Convex or Supabase" block must be a
// projection of the records, never an independent drafting: every record
// appears (id, title, aliases, hub anchor link), and every journey the block
// names is backed by a record.
function checkSkillProjection(root, records, errors) {
  const skillPath = join(root, SKILL_PAGE);
  if (!existsSync(skillPath)) {
    errors.push(
      `${SKILL_PAGE} does not exist but ${records.length} rosetta record(s) expect its embedded projection`,
    );
    return;
  }
  const body = readFileSync(skillPath, 'utf8');
  const begin = body.indexOf(SKILL_BLOCK_BEGIN);
  const end = body.indexOf(SKILL_BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) {
    errors.push(
      `${SKILL_PAGE}: missing \`${SKILL_BLOCK_BEGIN}\` … \`${SKILL_BLOCK_END}\` markers around the embedded rosetta projection`,
    );
    return;
  }
  const block = body.slice(begin + SKILL_BLOCK_BEGIN.length, end);

  const listedIds = [];
  for (const line of block.split('\n')) {
    const match = line.match(/^- `([a-z0-9-]+)`/);
    if (match) listedIds.push(match[1]);
  }
  const recordIds = new Set(records.map((record) => record.id));
  for (const id of listedIds) {
    if (!recordIds.has(id)) {
      errors.push(
        `${SKILL_PAGE}: rosetta block names journey "${id}" but ${ROSETTA_DIR}/${id}.json does not exist — ` +
        'the skill is advertising a journey the guide does not carry',
      );
    }
  }

  const listed = new Set(listedIds);
  for (const record of records) {
    if (!listed.has(record.id)) {
      errors.push(
        `${SKILL_PAGE}: rosetta block is missing journey "${record.id}" — add its \`- \`id\` — …\` line so ` +
        'the skill projects every record',
      );
      continue;
    }
    if (record.title && !block.includes(record.title)) {
      errors.push(
        `${SKILL_PAGE}: rosetta block does not carry the title of "${record.id}" ("${record.title}") — ` +
        'the projection drifted from the record',
      );
    }
    if (record.anchor) {
      const anchorLink = `coming-from-convex-and-supabase.md#${record.anchor}`;
      if (!block.includes(anchorLink)) {
        errors.push(
          `${SKILL_PAGE}: rosetta block does not link "${record.id}" to ${anchorLink} — a skill reader ` +
          'never reaches the canonical worked journey',
        );
      }
    }
    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) {
      if (!block.includes(alias)) {
        errors.push(
          `${SKILL_PAGE}: rosetta block for "${record.id}" does not mention alias "${alias}" — the ` +
          'competitor vocabulary the record routes is missing from the skill projection',
        );
      }
    }
  }
}

main();
