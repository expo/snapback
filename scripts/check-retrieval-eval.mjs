#!/usr/bin/env node
// Static routing checks for the retrieval-eval seed corpus
// (guide/retrieval-eval.md) — the deterministic half of the eval. For each
// seed case it verifies (1) every expected page exists in the guide corpus
// and (2) at least one of the case's route terms gives a grep-navigating
// agent a lexical path to an expected page: the term appears in
// guide/capabilities.md's Aliases column on a row pointing at an expected
// page, or in an expected page's title, a heading, or the body. It also
// cross-checks (3) that every Rosetta record alias
// (guide/rosetta/records/*.json) is mirrored as a seed-case route term.
// It does NOT run agents: actual cold-agent navigation within the
// ~15-tool-use budget stays the manual/W1-instrument protocol.
// @ref LLP 0186#amendment-2026-08-06-w2-rosetta-section--worked-example-tier — alias-tier terms must be mirrored as retrieval-eval seed cases.
//
// Usage: node scripts/check-retrieval-eval.mjs [--check]
// (no flags and --check behave identically; --check is accepted so
// check-guide.mjs can invoke this the same way it invokes
// check-rosetta.mjs --check.)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCapabilityIndex, parseFrontmatter, repoRoot } from './guide-lib.mjs';

const EVAL_PAGE = 'guide/retrieval-eval.md';
const ROSETTA_DIR = 'guide/rosetta/records';

// Parse the numbered cases out of the "## Seed intents" section. Each case
// is a numbered `**Label:**` list item whose final lines are the two
// machine-parsed markers: `Expected pages:` (backticked guide-relative
// paths) followed by `Route terms:` (double-quoted grep vocabulary). Cases may
// also carry `Required guidance:` and `Rejected guidance:` markers; those bind
// a repaired page to semantic wording instead of letting any route-term
// occurrence masquerade as the requested repair.
function parseSeedCases(text, errors) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## Seed intents'));
  if (start === -1) {
    errors.push(`${EVAL_PAGE}: no "## Seed intents" section found`);
    return [];
  }
  let end = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  end = end === -1 ? lines.length : start + 1 + end;

  const cases = [];
  let current = null;
  for (const line of lines.slice(start + 1, end)) {
    const open = line.match(/^(\d+)\.\s+\*\*(.+?):?\*\*/);
    if (open) {
      current = { number: Number(open[1]), label: open[2].trim(), text: line };
      cases.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += `\n${line}`;
    } else {
      current = null; // blank line or unindented paragraph ends the item
    }
  }
  if (cases.length === 0) {
    errors.push(`${EVAL_PAGE}: "## Seed intents" contains no parseable numbered cases`);
    return cases;
  }

  const seen = new Set();
  for (const seed of cases) {
    const who = `${EVAL_PAGE}: case ${seed.number} (${seed.label})`;
    if (seen.has(seed.number)) errors.push(`${who}: duplicate case number`);
    seen.add(seed.number);
    const pagesAt = seed.text.indexOf('Expected pages:');
    const termsAt = seed.text.indexOf('Route terms:');
    if (pagesAt === -1) errors.push(`${who}: missing "Expected pages:" marker line`);
    if (termsAt === -1) errors.push(`${who}: missing "Route terms:" marker line`);
    if (pagesAt === -1 || termsAt === -1) continue;
    if (termsAt < pagesAt) {
      errors.push(`${who}: "Route terms:" must come after "Expected pages:"`);
      continue;
    }
    const requiredAt = seed.text.indexOf('Required guidance:');
    const rejectedAt = seed.text.indexOf('Rejected guidance:');
    const markerEnd = (start, candidates) => Math.min(
      ...candidates.filter((value) => value > start),
      seed.text.length,
    );
    const termsEnd = markerEnd(termsAt, [requiredAt, rejectedAt]);
    seed.expectedPages = [...seed.text.slice(pagesAt, termsAt).matchAll(/`([^`]+)`/g)]
      .map((m) => m[1]);
    seed.terms = [...seed.text.slice(termsAt, termsEnd).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    seed.requiredGuidance = requiredAt === -1
      ? []
      : [...seed.text.slice(requiredAt, markerEnd(requiredAt, [rejectedAt])).matchAll(/"([^"]+)"/g)]
        .map((m) => m[1]);
    seed.rejectedGuidance = rejectedAt === -1
      ? []
      : [...seed.text.slice(rejectedAt).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (seed.expectedPages.length === 0) errors.push(`${who}: "Expected pages:" lists no backticked pages`);
    if (seed.terms.length === 0) errors.push(`${who}: "Route terms:" lists no quoted terms`);
  }
  return cases;
}

// A term routes to an expected page when a grep for it lands there: via the
// capability index's Aliases column (row whose Page cell names the expected
// page), or via the page's own title/heading/body.
function findRoutes(term, expectedPages, capIndex, pageTexts) {
  const needle = term.toLowerCase();
  const routes = [];
  for (const cap of capIndex.capabilities.values()) {
    if (!cap.aliases.toLowerCase().includes(needle)) continue;
    const page = expectedPages.find((p) => cap.page.includes(p));
    if (page) routes.push(`Aliases[${cap.id}] -> ${page}`);
  }
  for (const page of expectedPages) {
    const info = pageTexts.get(page);
    if (!info) continue;
    if ((info.title ?? '').toLowerCase().includes(needle)) {
      routes.push(`title of ${page}`);
    } else if (info.headings.some((h) => h.toLowerCase().includes(needle))) {
      routes.push(`heading in ${page}`);
    } else if (info.body.toLowerCase().includes(needle)) {
      routes.push(`body of ${page}`);
    }
  }
  return routes;
}

const normalizeGuidance = (value) => value
  .replace(/[`*_]/gu, '')
  .replace(/\s+/gu, ' ')
  .trim()
  .toLowerCase();

function main() {
  const root = repoRoot();
  const errors = [];
  const notes = [];
  const reports = [];

  const evalPath = join(root, EVAL_PAGE);
  if (!existsSync(evalPath)) {
    console.error(`check-retrieval-eval: ${EVAL_PAGE} does not exist`);
    process.exitCode = 1;
    return;
  }
  const cases = parseSeedCases(readFileSync(evalPath, 'utf8'), errors);

  const capIndexErrors = [];
  const capIndex = parseCapabilityIndex(root, capIndexErrors);
  errors.push(...capIndexErrors);

  // (1) Every expected page exists; load each for lexical matching.
  const pageTexts = new Map();
  for (const seed of cases) {
    for (const page of seed.expectedPages ?? []) {
      const path = join(root, 'guide', page);
      if (!existsSync(path)) {
        errors.push(
          `${EVAL_PAGE}: case ${seed.number} (${seed.label}): expected page guide/${page} does not exist`,
        );
        continue;
      }
      if (!pageTexts.has(page) && page.endsWith('.md')) {
        const raw = readFileSync(path, 'utf8');
        const { frontmatter, body } = parseFrontmatter(raw, `guide/${page}`, []);
        pageTexts.set(page, {
          title: frontmatter?.title ?? '',
          headings: body.split('\n').filter((line) => /^#{1,6}\s/.test(line)),
          body,
        });
      }
    }
  }

  // (2) Each case must have at least one lexical route to an expected page.
  for (const seed of cases) {
    if (!seed.terms || !seed.expectedPages) continue;
    let routed = false;
    for (const term of seed.terms) {
      const routes = findRoutes(term, seed.expectedPages, capIndex, pageTexts);
      if (routes.length > 0) {
        routed = true;
        reports.push(`case ${seed.number} (${seed.label}): "${term}" -> ${routes[0]}`);
      } else {
        notes.push(
          `case ${seed.number} (${seed.label}): route term "${term}" matched nothing (dead vocabulary?)`,
        );
      }
    }
    if (!routed) {
      errors.push(
        `${EVAL_PAGE}: case ${seed.number} (${seed.label}) has NO lexical route: none of its route terms ` +
        `(${seed.terms.map((t) => `"${t}"`).join(', ')}) appear in guide/capabilities.md's Aliases column for ` +
        `a row pointing at an expected page, nor in an expected page's title/heading/body — a grep-navigating ` +
        'agent cannot reach the paved road; add the missing alias or fix the terms',
      );
    }

    const expectedText = seed.expectedPages
      .map((page) => pageTexts.get(page)?.body ?? '')
      .join('\n');
    const normalizedExpectedText = normalizeGuidance(expectedText);
    for (const guidance of seed.requiredGuidance ?? []) {
      if (!normalizedExpectedText.includes(normalizeGuidance(guidance))) {
        errors.push(
          `${EVAL_PAGE}: case ${seed.number} (${seed.label}) is missing required guidance `
          + `"${guidance}" from its expected page(s)`,
        );
      }
    }
    for (const guidance of seed.rejectedGuidance ?? []) {
      if (normalizedExpectedText.includes(normalizeGuidance(guidance))) {
        errors.push(
          `${EVAL_PAGE}: case ${seed.number} (${seed.label}) still contains rejected guidance `
          + `"${guidance}" in its expected page(s)`,
        );
      }
    }
  }

  // (3) Every Rosetta record alias is mirrored as a seed case (route term
  // match, or the alias appears verbatim in a case's text).
  const rosettaDir = join(root, ROSETTA_DIR);
  let recordCount = 0;
  if (existsSync(rosettaDir)) {
    for (const file of readdirSync(rosettaDir).filter((f) => f.endsWith('.json')).sort()) {
      let record;
      try {
        record = JSON.parse(readFileSync(join(rosettaDir, file), 'utf8'));
      } catch {
        continue; // check-rosetta.mjs owns the malformed-JSON diagnostic
      }
      recordCount += 1;
      for (const alias of Array.isArray(record.aliases) ? record.aliases : []) {
        const needle = alias.toLowerCase();
        const covered = cases.some(
          (seed) =>
            (seed.terms ?? []).some((t) => t.toLowerCase() === needle) ||
            seed.text.toLowerCase().includes(needle),
        );
        if (!covered) {
          errors.push(
            `${ROSETTA_DIR}/${file}: alias "${alias}" is not mirrored as a retrieval-eval seed case — ` +
            `add it to a case's Route terms in ${EVAL_PAGE} (LLP 0186 W2 amendment: alias-tier terms are ` +
            'mirrored as eval seed cases)',
          );
        }
      }
    }
  }

  for (const line of reports) console.log(`check-retrieval-eval: ${line}`);
  for (const line of notes) console.log(`check-retrieval-eval: note: ${line}`);
  if (errors.length > 0) {
    console.error(`check-retrieval-eval: ${errors.length} error(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-retrieval-eval: ok — ${cases.length} case(s), ${recordCount} rosetta record(s), 0 errors`,
  );
}

main();
